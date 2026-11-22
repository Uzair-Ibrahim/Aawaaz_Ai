import crypto from 'node:crypto';
import type {
  CaseAnswerRecord,
  DocumentConflict,
  DocumentRecord,
  DocumentType,
} from '@awaaz/shared';
import type { AuditService } from '../../../core/audit/audit-service';
import type { AuthContext } from '../../../core/auth/auth-service';
import type { DataStore } from '../../../core/database/types';
import { AppError } from '../../../core/security/errors';
import type { PrivateStorageAdapter } from '../../../core/storage/storage';
import type { AIProvider } from '../../../integrations/ai/provider';

const ALLOWED_DOCUMENT_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
  'text/plain',
  'application/json',
]);

export function detectCrossFieldConflicts(
  answers: CaseAnswerRecord[],
  extractedFields: Record<string, unknown>,
): DocumentConflict[] {
  const conflicts: DocumentConflict[] = [];
  const answerMap = new Map(answers.map((a) => [a.field_name, a.field_value]));

  for (const [field, docVal] of Object.entries(extractedFields)) {
    if (docVal === null || docVal === undefined || docVal === '') continue;
    const appVal = answerMap.get(field as never);
    if (appVal === undefined || appVal === null || appVal === '') continue;

    if (field === 'monthly_income' && typeof appVal === 'number') {
      const numericDoc = Number(docVal);
      if (Number.isFinite(numericDoc) && Math.abs(numericDoc - appVal) > 500) {
        conflicts.push({
          field_name: field,
          application_value: appVal,
          document_value: numericDoc,
          severity: 'hard_review',
          message: `Reported monthly_income (${appVal}) differs from extracted document value (${numericDoc}).`,
        });
      }
    } else if (field === 'mock_identity_reference') {
      if (String(appVal).trim().toUpperCase() !== String(docVal).trim().toUpperCase()) {
        conflicts.push({
          field_name: field,
          application_value: appVal,
          document_value: docVal,
          severity: 'hard_review',
          message: `Reported mock_identity_reference (${String(appVal)}) does not match document (${String(docVal)}).`,
        });
      }
    } else if (field === 'full_name' || field === 'district') {
      if (String(appVal).trim().toLowerCase() !== String(docVal).trim().toLowerCase()) {
        conflicts.push({
          field_name: field,
          application_value: appVal,
          document_value: docVal,
          severity: 'warning',
          message: `Reported ${field} (${String(appVal)}) differs from extracted document value (${String(docVal)}).`,
        });
      }
    }
  }
  return conflicts;
}

export class DocumentService {
  constructor(
    private readonly store: DataStore,
    private readonly storage: PrivateStorageAdapter,
    private readonly aiProvider: AIProvider,
    private readonly audit: AuditService,
    private readonly maxUploadSizeBytes: number,
  ) {}

  async uploadDocument(
    auth: AuthContext,
    input: {
      caseId: string;
      documentType: DocumentType;
      fileName: string;
      mimeType: string;
      buffer: Buffer;
    },
  ): Promise<DocumentRecord> {
    if (!ALLOWED_DOCUMENT_MIME_TYPES.has(input.mimeType)) {
      throw new AppError(
        400,
        'UNSUPPORTED_DOCUMENT_TYPE',
        `File type '${input.mimeType}' is not allowed. Supported: PNG, JPEG, WEBP, PDF, TXT, JSON (synthetic demo documents only).`,
      );
    }
    if (input.buffer.length === 0) {
      throw new AppError(400, 'EMPTY_DOCUMENT', 'Uploaded document is empty.');
    }
    if (input.buffer.length > this.maxUploadSizeBytes) {
      throw new AppError(
        413,
        'DOCUMENT_TOO_LARGE',
        `Document exceeds maximum upload limit of ${Math.round(this.maxUploadSizeBytes / (1024 * 1024))} MB.`,
      );
    }

    const docKey = crypto.randomUUID();
    const storagePath = this.storage.buildTenantPath(
      auth.organizationId,
      input.caseId,
      docKey,
      input.fileName,
    );

    await this.storage.uploadPrivate(storagePath, input.buffer, input.mimeType);

    const record = await this.store.createDocument({
      organization_id: auth.organizationId,
      case_id: input.caseId,
      document_type: input.documentType,
      file_name: input.fileName,
      mime_type: input.mimeType,
      size_bytes: input.buffer.length,
      storage_path: storagePath,
      processing_status: 'UPLOADED',
      extraction_result: null,
      conflicts: [],
      review_status: 'PENDING',
    });

    await this.audit.log({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'document.uploaded',
      resourceType: 'document',
      resourceId: record.id,
      metadata: {
        case_id: input.caseId,
        document_type: input.documentType,
        mime_type: input.mimeType,
        size_bytes: input.buffer.length,
      },
    });

    return record;
  }

  async extractDocument(auth: AuthContext, documentId: string): Promise<DocumentRecord> {
    const doc = await this.store.getDocumentById(auth.organizationId, documentId);
    if (!doc) throw new AppError(404, 'DOCUMENT_NOT_FOUND', 'Document not found.');

    const fileBuffer = await this.storage.downloadPrivate(doc.storage_path);
    const answers = await this.store.listCaseAnswers(auth.organizationId, doc.case_id);

    // If Gemini is configured, perform AI multimodal extraction; otherwise honestly mark NEEDS_REVIEW
    // (or parse structured synthetic JSON/TXT explicitly labeled as non-AI synthetic parser)
    if (!this.aiProvider.isConfigured()) {
      const updated = await this.store.updateDocument(auth.organizationId, doc.id, {
        processing_status: 'NEEDS_REVIEW',
        review_status: 'PENDING',
        extraction_result: {
          ai_configured: false,
          note: 'GEMINI_API_KEY is not configured. Document stored privately and routed for manual human officer review.',
        },
      });
      await this.audit.log({
        organizationId: auth.organizationId,
        actorId: auth.userId,
        action: 'document.extraction_deferred_unconfigured_ai',
        resourceType: 'document',
        resourceId: doc.id,
        metadata: { case_id: doc.case_id },
      });
      return updated;
    }

    await this.store.updateDocument(auth.organizationId, doc.id, { processing_status: 'PROCESSING' });

    try {
      const extraction = await this.aiProvider.extractDocumentFields({
        fileBuffer,
        mimeType: doc.mime_type,
        expectedDocumentType: doc.document_type,
      });

      const conflicts = detectCrossFieldConflicts(answers, extraction.extracted_fields);
      const lowReadability = extraction.readability_score < 0.6;
      const processingStatus = lowReadability || conflicts.length > 0 ? 'NEEDS_REVIEW' : 'EXTRACTED';
      const reviewStatus = lowReadability || conflicts.length > 0 ? 'FLAGGED' : 'PENDING';

      const updated = await this.store.updateDocument(auth.organizationId, doc.id, {
        processing_status: processingStatus,
        review_status: reviewStatus,
        extraction_result: extraction as unknown as Record<string, unknown>,
        conflicts,
      });

      await this.store.createAiRun({
        organization_id: auth.organizationId,
        case_id: doc.case_id,
        model_provider: this.aiProvider.providerName,
        model_name: extraction.model_name,
        operation: 'document_extraction',
        input_reference: `document:${doc.id}:${doc.document_type}`,
        output: {
          detected_document_type: extraction.detected_document_type,
          readability_score: extraction.readability_score,
          conflicts_count: conflicts.length,
        },
        confidence: extraction.readability_score,
        explanation:
          conflicts.length > 0
            ? `Flagged ${conflicts.length} cross-field conflict(s) for human review.`
            : 'Document fields extracted for citizen confirmation and officer review.',
      });

      return updated;
    } catch (err) {
      // Never auto-reject on extraction failure — mark for human review
      await this.store.updateDocument(auth.organizationId, doc.id, {
        processing_status: 'NEEDS_REVIEW',
        review_status: 'FLAGGED',
        extraction_result: {
          error: err instanceof Error ? err.message : 'Extraction failed',
          note: 'Routed to human officer review; not auto-rejected.',
        },
      });
      throw err;
    }
  }

  async getSignedDownload(auth: AuthContext, documentId: string): Promise<{ document: DocumentRecord; signedUrl: string; expiresInSeconds: number }> {
    const doc = await this.store.getDocumentById(auth.organizationId, documentId);
    if (!doc) throw new AppError(404, 'DOCUMENT_NOT_FOUND', 'Document not found.');

    const signed = await this.storage.createSignedDownloadUrl(doc.storage_path, 120);
    await this.audit.log({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'document.signed_url_issued',
      resourceType: 'document',
      resourceId: doc.id,
      metadata: { case_id: doc.case_id, expires_in_seconds: signed.expiresInSeconds },
    });

    return {
      document: doc,
      signedUrl: signed.url,
      expiresInSeconds: signed.expiresInSeconds,
    };
  }
}
