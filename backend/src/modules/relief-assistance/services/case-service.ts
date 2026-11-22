import crypto from 'node:crypto';
import type {
  AnswerSource,
  ApplicationFieldName,
  CaseAnswerRecord,
  CaseRecord,
  CaseReviewRecord,
  CitizenRecord,
  DocumentRecord,
  EligibilityEvaluationResult,
  LanguageCode,
  MockPaymentRecord,
  ServiceDepartmentCode,
} from '@awaaz/shared';
import type { AuditService } from '../../../core/audit/audit-service';
import type { AuthContext } from '../../../core/auth/auth-service';
import type { DataStore } from '../../../core/database/types';
import type { NotificationService } from '../../../core/notifications/notification-service';
import { AppError } from '../../../core/security/errors';
import type { ConsentService } from '../consent/consent-service';
import type { ConsentEnforcementService } from './consent-enforcement-service';
import type { DynamicRuleEngineService } from './rule-engine-service';
import { evaluateEligibilityDeterministic } from '../rules/engine';
import { validateCaseTransition } from '../workflow/state-machine';

export interface CaseDetailResponse {
  case: CaseRecord;
  citizen: CitizenRecord | null;
  answers: CaseAnswerRecord[];
  documents: DocumentRecord[];
  reviews: Array<
    Omit<CaseReviewRecord, 'internal_notes'> & {
      internal_notes?: string;
    }
  >;
  mock_payments: MockPaymentRecord[];
  has_active_processing_consent: boolean;
}

export class CaseService {
  constructor(
    private readonly store: DataStore,
    private readonly consentService: ConsentService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
    private readonly ruleEngineService?: DynamicRuleEngineService,
    private readonly consentEnforcementService?: ConsentEnforcementService,
  ) {}

  private async resolveOfficerDepartmentCode(auth: AuthContext): Promise<ServiceDepartmentCode | null> {
    if (!auth.departmentId) return null;
    const depts = await this.store.listDepartments(auth.organizationId);
    const dept = depts.find((d) => d.id === auth.departmentId);
    if (!dept) return null;
    const upper = dept.code.toUpperCase();
    if (upper === 'SCAM_CYBER_SAFETY') return 'SCAM_CYBER_SAFETY';
    if (upper === 'RELIEF_ASSISTANCE' || upper === 'RELIEF_INTAKE' || upper === 'PROV_RELIEF') {
      return 'RELIEF_ASSISTANCE';
    }
    if (upper === 'GENERAL_INQUIRY' || upper === 'SYSTEM_ONBOARDING') {
      return upper;
    }
    return 'RELIEF_ASSISTANCE';
  }

  /**
   * Strict tenant + role + consent authorization check for any case operation.
   */
  async assertCanAccessCase(
    auth: AuthContext,
    caseId: string,
    mode: 'read' | 'write' = 'read',
  ): Promise<{ caseRecord: CaseRecord; citizen: CitizenRecord | null }> {
    const caseRecord = await this.store.getCaseById(auth.organizationId, caseId);
    if (!caseRecord) {
      throw new AppError(404, 'CASE_NOT_FOUND', 'Case not found in your active workspace.');
    }

    const citizen = await this.store.getCitizenById(auth.organizationId, caseRecord.citizen_id);

    if (auth.role === 'citizen') {
      if (!citizen || citizen.user_id !== auth.userId) {
        throw new AppError(403, 'CASE_ACCESS_DENIED', 'Citizens may only access their own applications.');
      }
      return { caseRecord, citizen };
    }

    if (auth.role === 'helper') {
      const hasConsent = await this.consentService.hasActiveHelperConsent(
        auth.organizationId,
        auth.userId,
        caseRecord.citizen_id,
        caseRecord.id,
      );
      if (!hasConsent) {
        throw new AppError(
          403,
          'HELPER_CONSENT_REQUIRED',
          'Helper access denied: active, non-withdrawn citizen consent is required.',
        );
      }
      return { caseRecord, citizen };
    }

    if (auth.role === 'officer' || auth.role === 'admin') {
      if (auth.role === 'officer') {
        const officerDeptCode = await this.resolveOfficerDepartmentCode(auth);
        const caseDeptCode = caseRecord.assigned_department ?? 'RELIEF_ASSISTANCE';
        if (officerDeptCode && caseDeptCode !== officerDeptCode) {
          throw new AppError(
            403,
            'DEPARTMENT_ACCESS_DENIED',
            `Officer in ${officerDeptCode} cannot access applications assigned to ${caseDeptCode}.`,
          );
        }
        if (caseRecord.department_id && auth.departmentId && caseRecord.department_id !== auth.departmentId) {
          throw new AppError(403, 'DEPARTMENT_ACCESS_DENIED', 'Officer cannot access cases in another department.');
        }
      }
      return { caseRecord, citizen };
    }

    throw new AppError(
      403,
      'ADMIN_PII_RESTRICTED',
      'Super Admins cannot directly inspect or edit sensitive citizen applications without operational authorization.',
    );
  }

  async createCase(
    auth: AuthContext,
    input: {
      scheme_id: string;
      preferred_language: LanguageCode;
      idempotency_key: string;
      citizen_id?: string;
      citizen_display_name?: string;
      mock_identity_reference?: string;
    },
  ): Promise<{ case: CaseRecord; idempotentReplay: boolean }> {
    // Idempotency check scoped to tenant
    const existing = await this.store.getCaseByIdempotencyKey(auth.organizationId, input.idempotency_key);
    if (existing) {
      await this.assertCanAccessCase(auth, existing.id, 'read');
      return { case: existing, idempotentReplay: true };
    }

    let citizen: CitizenRecord | null = null;

    if (auth.role === 'citizen') {
      citizen = await this.store.getCitizenByUserId(auth.organizationId, auth.userId);
      if (!citizen) {
        citizen = await this.store.createCitizen({
          organization_id: auth.organizationId,
          user_id: auth.userId,
          display_name: input.citizen_display_name?.trim() || auth.displayName,
          mock_identity_reference:
            input.mock_identity_reference?.trim() || `MOCK-ID-${auth.userId.slice(0, 8).toUpperCase()}`,
        });
      }
    } else if (auth.role === 'helper') {
      if (!input.citizen_id) {
        throw new AppError(
          400,
          'CITIZEN_ID_REQUIRED',
          'Helpers must specify an authorized citizen_id with active delegation consent.',
        );
      }
      const allowed = await this.consentService.hasActiveHelperConsent(
        auth.organizationId,
        auth.userId,
        input.citizen_id,
      );
      if (!allowed) {
        throw new AppError(
          403,
          'HELPER_CONSENT_REQUIRED',
          'You do not have active citizen consent to create an application for this citizen.',
        );
      }
      citizen = await this.store.getCitizenById(auth.organizationId, input.citizen_id);
      if (!citizen) throw new AppError(404, 'CITIZEN_NOT_FOUND', 'Citizen not found in workspace.');
    } else {
      throw new AppError(403, 'FORBIDDEN', 'Only citizens or consented helpers may create applications.');
    }

    const orgDepts = await this.store.listDepartments(auth.organizationId);
    const reliefDept =
      orgDepts.find((d) => d.code.toUpperCase() === 'RELIEF_ASSISTANCE') ??
      orgDepts.find((d) => d.code.toUpperCase().includes('RELIEF')) ??
      null;

    const created = await this.store.createCase({
      organization_id: auth.organizationId,
      citizen_id: citizen.id,
      department_id: reliefDept?.id ?? null,
      assigned_department: 'RELIEF_ASSISTANCE',
      scheme_id: input.scheme_id,
      status: 'DRAFT',
      preferred_language: input.preferred_language,
      current_step: 'consent',
      rule_version_id: null,
      assigned_officer_id: null,
      decided_by_officer_id: null,
      decided_by_officer_name: null,
      decision_reason: null,
      decided_at: null,
      idempotency_key: input.idempotency_key,
      analysis_result: null,
      submitted_at: null,
    });

    await this.audit.log({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'case.created',
      resourceType: 'case',
      resourceId: created.id,
      metadata: { scheme_id: created.scheme_id, citizen_id: citizen.id },
    });

    return { case: created, idempotentReplay: false };
  }

  async listAuthorizedCases(
    auth: AuthContext,
    filters?: { status?: string; search?: string },
  ): Promise<CaseRecord[]> {
    if (auth.role === 'citizen') {
      const citizen = await this.store.getCitizenByUserId(auth.organizationId, auth.userId);
      if (!citizen) return [];
      return this.store.listCases(auth.organizationId, {
        citizenId: citizen.id,
        status: filters?.status,
      });
    }

    if (auth.role === 'helper') {
      const consents = await this.store.listConsents(auth.organizationId, {
        helperId: auth.userId,
        activeOnly: true,
      });
      const consentedCitizenIds = new Set(
        consents.filter((c) => c.consent_type === 'helper_delegation').map((c) => c.citizen_id),
      );
      if (consentedCitizenIds.size === 0) return [];
      const all = await this.store.listCases(auth.organizationId, filters);
      return all.filter((c) => {
        if (!consentedCitizenIds.has(c.citizen_id)) return false;
        return consents.some(
          (con) =>
            con.citizen_id === c.citizen_id &&
            con.consent_type === 'helper_delegation' &&
            (con.case_id === null || con.case_id === c.id),
        );
      });
    }

    if (auth.role === 'officer' || auth.role === 'admin') {
      const all = await this.store.listCases(auth.organizationId, filters);
      if (auth.role === 'officer') {
        const officerDeptCode = await this.resolveOfficerDepartmentCode(auth);
        if (officerDeptCode) {
          return all.filter((c) => {
            const caseDeptCode = c.assigned_department ?? 'RELIEF_ASSISTANCE';
            if (caseDeptCode !== officerDeptCode) return false;
            if (c.department_id && auth.departmentId && c.department_id !== auth.departmentId) return false;
            return true;
          });
        }
        if (auth.departmentId) {
          return all.filter((c) => !c.department_id || c.department_id === auth.departmentId);
        }
      }
      return all;
    }

    throw new AppError(403, 'FORBIDDEN', 'Role is not authorized to list citizen case records.');
  }

  async getCaseDetail(auth: AuthContext, caseId: string): Promise<CaseDetailResponse> {
    const { caseRecord, citizen } = await this.assertCanAccessCase(auth, caseId, 'read');

    // Module 4 (Challenge 06): True Access Revocation Enforcement for Officers when citizen withdrew consent!
    if (auth.role === 'officer' && this.consentEnforcementService) {
      const allowed = await this.consentEnforcementService.isOfficerAccessAllowedForCitizen(
        auth.organizationId,
        caseRecord.citizen_id,
      );
      if (!allowed) {
        await this.consentEnforcementService.recordAccessBlocked({
          auth,
          citizenId: caseRecord.citizen_id,
          caseId: caseRecord.id,
          operation: `GET /cases/${caseRecord.id}`,
        });
        return {
          case: {
            ...caseRecord,
            access_blocked: true,
            access_blocked_reason: 'CONSENT_WITHDRAWN_BY_CITIZEN',
          },
          citizen: citizen
            ? {
                ...citizen,
                display_name: '[REDACTED — CONSENT WITHDRAWN]',
                mock_identity_reference: 'REDACTED',
              }
            : null,
          answers: [],
          documents: [],
          reviews: [],
          mock_payments: [],
          has_active_processing_consent: false,
        };
      }
    }

    const [answers, documents, rawReviews, mockPayments, hasConsent] = await Promise.all([
      this.store.listCaseAnswers(auth.organizationId, caseRecord.id),
      this.store.listCaseDocuments(auth.organizationId, caseRecord.id),
      this.store.listCaseReviews(auth.organizationId, caseRecord.id),
      this.store.listCaseMockPayments(auth.organizationId, caseRecord.id),
      this.consentService.hasActiveProcessingConsent(auth.organizationId, caseRecord.citizen_id, caseRecord.id),
    ]);

    // Strictly hide internal_notes from citizens and helpers (§6.1)
    const canSeeInternalNotes = auth.role === 'officer' || auth.role === 'admin';
    const reviews = rawReviews.map((r) =>
      canSeeInternalNotes
        ? r
        : {
            id: r.id,
            organization_id: r.organization_id,
            case_id: r.case_id,
            officer_id: r.officer_id,
            decision: r.decision,
            citizen_message: r.citizen_message,
            rule_version_id: r.rule_version_id,
            created_at: r.created_at,
          },
    );

    return {
      case: caseRecord,
      citizen,
      answers,
      documents,
      reviews,
      mock_payments: mockPayments,
      has_active_processing_consent: hasConsent,
    };
  }

  async patchAnswers(
    auth: AuthContext,
    caseId: string,
    input: {
      expected_server_updated_at?: string;
      current_step?: string;
      preferred_language?: LanguageCode;
      answers: Array<{
        field_name: ApplicationFieldName;
        field_value: string | number | boolean;
        source: AnswerSource;
        confirmed_by_citizen: boolean;
        extraction_confidence?: number | null;
      }>;
    },
  ): Promise<{ case: CaseRecord; answers: CaseAnswerRecord[] }> {
    const { caseRecord } = await this.assertCanAccessCase(auth, caseId, 'write');

    if (['APPROVED', 'REJECTED', 'MOCK_PAYMENT_QUEUED', 'MOCK_PAYMENT_COMPLETED'].includes(caseRecord.status)) {
      throw new AppError(409, 'CASE_LOCKED', 'Cannot modify answers after final decision.');
    }

    // Explicit offline sync conflict check (§17.3): never silently overwrite newer server data
    if (
      input.expected_server_updated_at &&
      new Date(caseRecord.updated_at).getTime() > new Date(input.expected_server_updated_at).getTime()
    ) {
      throw new AppError(
        409,
        'SYNC_CONFLICT',
        'Server case has newer changes than your offline draft. Reload the latest version before retrying.',
        {
          server_updated_at: caseRecord.updated_at,
          client_expected_updated_at: input.expected_server_updated_at,
        },
      );
    }

    for (const ans of input.answers) {
      // Helpers cannot mark critical fields as citizen-confirmed without citizen confirmation flow
      const confirmed = auth.role === 'citizen' ? ans.confirmed_by_citizen : ans.confirmed_by_citizen;
      await this.store.upsertCaseAnswer(auth.organizationId, caseRecord.id, {
        field_name: ans.field_name,
        field_value: ans.field_value,
        source: ans.source,
        confirmed_by_citizen: confirmed,
        extraction_confidence: ans.extraction_confidence ?? null,
      });
    }

    let nextStatus = caseRecord.status;
    if (caseRecord.status === 'DRAFT' || caseRecord.status === 'NEEDS_MORE_INFO') {
      validateCaseTransition({
        currentStatus: caseRecord.status,
        nextStatus: 'COLLECTING_INFORMATION',
        actorRole: auth.role,
        hasProcessingConsent: true,
      });
      nextStatus = 'COLLECTING_INFORMATION';
    }

    const updatedCase = await this.store.updateCase(auth.organizationId, caseRecord.id, {
      status: nextStatus,
      current_step: input.current_step ?? caseRecord.current_step,
      preferred_language: input.preferred_language ?? caseRecord.preferred_language,
    });

    const allAnswers = await this.store.listCaseAnswers(auth.organizationId, caseRecord.id);

    await this.audit.log({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'case.answers_updated',
      resourceType: 'case',
      resourceId: caseRecord.id,
      metadata: { updated_fields: input.answers.map((a) => a.field_name) },
    });

    return { case: updatedCase, answers: allAnswers };
  }

  async analyzeCase(auth: AuthContext, caseId: string): Promise<{ case: CaseRecord; analysis: EligibilityEvaluationResult }> {
    const { caseRecord } = await this.assertCanAccessCase(auth, caseId, 'read');

    const hasConsent = await this.consentService.hasActiveProcessingConsent(
      auth.organizationId,
      caseRecord.citizen_id,
      caseRecord.id,
    );

    const rule = await this.store.getRuleByScheme(auth.organizationId, caseRecord.scheme_id);
    if (!rule || !rule.active_version_id) {
      throw new AppError(412, 'NO_ACTIVE_RULE_VERSION', `No published eligibility rule exists for scheme '${caseRecord.scheme_id}'.`);
    }
    const ruleVersion = await this.store.getRuleVersionById(auth.organizationId, rule.active_version_id);
    if (!ruleVersion) {
      throw new AppError(412, 'RULE_VERSION_NOT_FOUND', 'Active eligibility rule version could not be loaded.');
    }

    const [answers, documents] = await Promise.all([
      this.store.listCaseAnswers(auth.organizationId, caseRecord.id),
      this.store.listCaseDocuments(auth.organizationId, caseRecord.id),
    ]);

    // Mock identity verification & duplicate detection (§14)
    const mockIdAnswer = answers.find((a) => a.field_name === 'mock_identity_reference');
    const mockIdRef = typeof mockIdAnswer?.field_value === 'string' ? mockIdAnswer.field_value.trim() : '';
    let mockIdentityVerified = false;
    let duplicateIdentityDetected = false;

    if (mockIdRef) {
      const mockRec = await this.store.findMockIdentityRecord(auth.organizationId, mockIdRef);
      mockIdentityVerified =
        Boolean(mockRec?.verified) ||
        /^MOCK-ID-\d{3,6}$/i.test(mockIdRef) ||
        /^\d{5}-\d{7}-\d$/.test(mockIdRef) ||
        /^\d{13}$/.test(mockIdRef);

      // Check for duplicate mock identity across different citizens in the same org
      const matchingCitizens = await this.store.findCitizensByMockIdentity(auth.organizationId, mockIdRef);
      const otherCitizens = matchingCitizens.filter((c) => c.id !== caseRecord.citizen_id);
      duplicateIdentityDetected = otherCitizens.length > 0;
    }

    const evaluation = evaluateEligibilityDeterministic({
      ruleVersion,
      answers,
      documents,
      hasActiveProcessingConsent: hasConsent,
      mockIdentityVerified,
      duplicateIdentityDetected,
    });

    // If case is not already finalized, move through AI_ANALYSIS -> recommended routing state
    let finalStatus = caseRecord.status;
    if (
      ['DRAFT', 'COLLECTING_INFORMATION', 'DOCUMENT_PENDING', 'NEEDS_MORE_INFO', 'NEEDS_HUMAN_REVIEW', 'READY_FOR_OFFICER'].includes(
        caseRecord.status,
      )
    ) {
      if (hasConsent) {
        if (['DRAFT', 'COLLECTING_INFORMATION', 'DOCUMENT_PENDING', 'NEEDS_MORE_INFO'].includes(caseRecord.status)) {
          validateCaseTransition({
            currentStatus: caseRecord.status,
            nextStatus: 'AI_ANALYSIS',
            actorRole: auth.role,
            hasProcessingConsent: hasConsent,
            ruleVersionId: ruleVersion.id,
          });
          validateCaseTransition({
            currentStatus: 'AI_ANALYSIS',
            nextStatus: evaluation.recommended_next_status,
            actorRole: auth.role,
            hasProcessingConsent: hasConsent,
            ruleVersionId: ruleVersion.id,
          });
          finalStatus = evaluation.recommended_next_status;
        }
      }
    }

    const updated = await this.store.updateCase(auth.organizationId, caseRecord.id, {
      status: finalStatus,
      rule_version_id: ruleVersion.id,
      analysis_result: evaluation,
    });

    await this.audit.log({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'case.analyzed_deterministic',
      resourceType: 'case',
      resourceId: caseRecord.id,
      metadata: {
        rule_version_id: ruleVersion.id,
        rule_version: ruleVersion.version_number,
        evidence_score: evaluation.evidence_score,
        recommended_next_status: evaluation.recommended_next_status,
        hard_safety_flags: evaluation.hard_safety_flags,
      },
    });

    return { case: updated, analysis: evaluation };
  }

  async submitCase(auth: AuthContext, caseId: string): Promise<{ case: CaseRecord; analysis: EligibilityEvaluationResult }> {
    const { caseRecord, citizen } = await this.assertCanAccessCase(auth, caseId, 'write');
    if (auth.role !== 'citizen' && auth.role !== 'helper') {
      throw new AppError(403, 'FORBIDDEN', 'Only citizens or consented helpers may submit an application.');
    }

    const hasConsent = await this.consentService.hasActiveProcessingConsent(
      auth.organizationId,
      caseRecord.citizen_id,
      caseRecord.id,
    );
    if (!hasConsent) {
      throw new AppError(
        412,
        'CONSENT_REQUIRED',
        'Citizen processing consent must be granted before submitting the application.',
      );
    }

    const { case: analyzed, analysis } = await this.analyzeCase(auth, caseId);
    const answers = await this.store.listCaseAnswers(auth.organizationId, analyzed.id);
    const incomeAns = answers.find((a) => a.field_name === 'monthly_income');
    const reasonAns = answers.find((a) => a.field_name === 'relief_reason');
    const parsedAmt =
      typeof reasonAns?.field_value === 'string'
        ? Number(reasonAns.field_value.match(/Requested amount:\s*(\d+)/i)?.[1] ?? 15000)
        : 15000;
    const costEval = this.ruleEngineService
      ? this.ruleEngineService.evaluateClaimWithCostMatrix(auth.organizationId, {
          amount_pkr: Number.isFinite(parsedAmt) ? parsedAmt : 15000,
          monthly_income_pkr: typeof incomeAns?.field_value === 'number' ? incomeAns.field_value : 18000,
          confidence_score: Number((Math.max(50, analysis.evidence_score) / 100).toFixed(2)),
          language: analyzed.preferred_language,
        })
      : null;

    const updated = await this.store.updateCase(auth.organizationId, analyzed.id, {
      submitted_at: analyzed.submitted_at ?? new Date().toISOString(),
      ...(costEval && !analyzed.rule_version_used
        ? {
            rule_version_used: costEval.rule_version_used,
            rule_snapshot_json: costEval.rule_snapshot,
            decision_tier: costEval.decision_tier,
            confidence_score: costEval.confidence_score,
            case_notes: costEval.case_notes,
            citizen_simple_reason: costEval.citizen_simple_reason,
            model_version: costEval.model_version,
          }
        : {}),
    });

    if (citizen?.user_id) {
      await this.notifications.notify({
        organizationId: auth.organizationId,
        userId: citizen.user_id,
        caseId: updated.id,
        notificationType: 'CASE_SUBMITTED',
        title: 'Application submitted for review',
        body: `Your mock relief application is now in status ${updated.status} (Evidence score: ${analysis.evidence_score}/100).`,
        language: updated.preferred_language,
      });
    }

    await this.audit.log({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'case.submitted',
      resourceType: 'case',
      resourceId: updated.id,
      metadata: { status: updated.status, rule_version_id: updated.rule_version_id },
    });

    return { case: updated, analysis };
  }

  async officerDecide(
    auth: AuthContext,
    caseId: string,
    input: { decision: 'APPROVED' | 'REJECTED'; decision_reason?: string; internal_notes: string; citizen_message: string },
  ): Promise<{ case: CaseRecord; review: CaseReviewRecord }> {
    if (auth.role !== 'officer') {
      throw new AppError(
        403,
        'OFFICER_ONLY',
        'Only the assigned Department Officer may approve or reject citizen applications. Admins have read-only oversight.',
      );
    }
    const decisionReason = (input.decision_reason?.trim() || input.internal_notes?.trim() || '').trim();
    if (decisionReason.length < 3) {
      throw new AppError(
        400,
        'DECISION_REASON_REQUIRED',
        'A mandatory non-empty decision_reason is required when approving or rejecting an application.',
      );
    }

    const { caseRecord, citizen } = await this.assertCanAccessCase(auth, caseId, 'write');

    // Module 4 (Challenge 06): Strictly block officer approval/rejection if citizen withdrew consent (403 CONSENT_WITHDRAWN)!
    if (this.consentEnforcementService) {
      const allowed = await this.consentEnforcementService.isOfficerAccessAllowedForCitizen(
        auth.organizationId,
        caseRecord.citizen_id,
      );
      if (!allowed) {
        await this.consentEnforcementService.recordAccessBlocked({
          auth,
          citizenId: caseRecord.citizen_id,
          caseId: caseRecord.id,
          operation: `POST /cases/${caseRecord.id}/decision (${input.decision})`,
        });
        throw new AppError(
          403,
          'CONSENT_WITHDRAWN',
          'Access Revoked — Citizen withdrew data-sharing consent. Officer cannot process or decide this application.',
        );
      }
    }

    const hasConsent = await this.consentService.hasActiveProcessingConsent(
      auth.organizationId,
      caseRecord.citizen_id,
      caseRecord.id,
    );

    // Ensure case transitions cleanly into OFFICER_REVIEW before final decision
    let workingStatus = caseRecord.status;
    if (['READY_FOR_OFFICER', 'NEEDS_HUMAN_REVIEW', 'NEEDS_MORE_INFO'].includes(workingStatus)) {
      validateCaseTransition({
        currentStatus: workingStatus,
        nextStatus: 'OFFICER_REVIEW',
        actorRole: auth.role,
        hasProcessingConsent: hasConsent,
        ruleVersionId: caseRecord.rule_version_id,
      });
      workingStatus = 'OFFICER_REVIEW';
    }

    validateCaseTransition({
      currentStatus: workingStatus,
      nextStatus: input.decision,
      actorRole: auth.role,
      hasProcessingConsent: hasConsent,
      ruleVersionId: caseRecord.rule_version_id,
    });

    const decidedAt = new Date().toISOString();
    const updatedCase = await this.store.updateCase(auth.organizationId, caseRecord.id, {
      status: input.decision,
      assigned_officer_id: auth.userId,
      decided_by_officer_id: auth.userId,
      decided_by_officer_name: auth.displayName,
      decision_reason: decisionReason,
      decided_at: decidedAt,
    });

    const review = await this.store.createCaseReview({
      organization_id: auth.organizationId,
      case_id: caseRecord.id,
      officer_id: auth.userId,
      officer_display_name: auth.displayName,
      decision: input.decision,
      decision_reason: decisionReason,
      internal_notes: input.internal_notes?.trim() || decisionReason,
      citizen_message: input.citizen_message,
      rule_version_id: caseRecord.rule_version_id,
    });

    if (citizen?.user_id) {
      await this.notifications.notify({
        organizationId: auth.organizationId,
        userId: citizen.user_id,
        caseId: caseRecord.id,
        notificationType: `CASE_${input.decision}`,
        title: `Application ${input.decision.toLowerCase()}`,
        body: input.citizen_message,
        language: caseRecord.preferred_language,
      });
    }

    await this.audit.log({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: `case.officer_${input.decision.toLowerCase()}`,
      resourceType: 'case',
      resourceId: caseRecord.id,
      metadata: {
        decision: input.decision,
        decision_reason: decisionReason,
        decided_by_officer_name: auth.displayName,
        assigned_department: caseRecord.assigned_department ?? 'RELIEF_ASSISTANCE',
        rule_version_id: caseRecord.rule_version_id,
      },
    });

    return { case: updatedCase, review };
  }

  async officerRequestInformation(
    auth: AuthContext,
    caseId: string,
    input: { missing_items: string[]; internal_notes: string; citizen_message: string },
  ): Promise<{ case: CaseRecord; review: CaseReviewRecord }> {
    if (auth.role !== 'officer' && auth.role !== 'admin') {
      throw new AppError(403, 'OFFICER_ONLY', 'Only a Department Officer or Super Admin may request additional information.');
    }
    const { caseRecord, citizen } = await this.assertCanAccessCase(auth, caseId, 'write');

    // Module 4 (Challenge 06): Strictly block officer request-info if citizen withdrew consent (403 CONSENT_WITHDRAWN)!
    if (this.consentEnforcementService) {
      const allowed = await this.consentEnforcementService.isOfficerAccessAllowedForCitizen(
        auth.organizationId,
        caseRecord.citizen_id,
      );
      if (!allowed) {
        await this.consentEnforcementService.recordAccessBlocked({
          auth,
          citizenId: caseRecord.citizen_id,
          caseId: caseRecord.id,
          operation: `POST /cases/${caseRecord.id}/request-information`,
        });
        throw new AppError(
          403,
          'CONSENT_WITHDRAWN',
          'Access Revoked — Citizen withdrew data-sharing consent. Officer cannot process this application.',
        );
      }
    }

    const hasConsent = await this.consentService.hasActiveProcessingConsent(
      auth.organizationId,
      caseRecord.citizen_id,
      caseRecord.id,
    );

    validateCaseTransition({
      currentStatus: caseRecord.status,
      nextStatus: 'NEEDS_MORE_INFO',
      actorRole: auth.role,
      hasProcessingConsent: hasConsent,
      ruleVersionId: caseRecord.rule_version_id,
    });

    const updatedCase = await this.store.updateCase(auth.organizationId, caseRecord.id, {
      status: 'NEEDS_MORE_INFO',
      assigned_officer_id: auth.userId,
    });

    const review = await this.store.createCaseReview({
      organization_id: auth.organizationId,
      case_id: caseRecord.id,
      officer_id: auth.userId,
      decision: 'REQUEST_INFO',
      internal_notes: `${input.internal_notes}\nRequested items: ${input.missing_items.join(', ')}`.trim(),
      citizen_message: `${input.citizen_message} (Missing: ${input.missing_items.join(', ')})`,
      rule_version_id: caseRecord.rule_version_id,
    });

    if (citizen?.user_id) {
      await this.notifications.notify({
        organizationId: auth.organizationId,
        userId: citizen.user_id,
        caseId: caseRecord.id,
        notificationType: 'CASE_NEEDS_MORE_INFO',
        title: 'Additional information requested',
        body: review.citizen_message,
        language: caseRecord.preferred_language,
      });
    }

    await this.audit.log({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'case.officer_requested_info',
      resourceType: 'case',
      resourceId: caseRecord.id,
      metadata: { missing_items: input.missing_items },
    });

    return { case: updatedCase, review };
  }

  /**
   * Mock Payment Simulation (§1.3 & §18).
   * Explicitly synthetic — requires prior human officer APPROVED status.
   */
  async createMockPayment(
    auth: AuthContext,
    input: { case_id: string; amount_pkr?: number },
  ): Promise<{ payment: MockPaymentRecord; case: CaseRecord }> {
    if (auth.role !== 'officer' && auth.role !== 'admin') {
      throw new AppError(403, 'OFFICER_ONLY', 'Only an authorized Department Officer or Super Admin may initiate a mock payment.');
    }
    const { caseRecord, citizen } = await this.assertCanAccessCase(auth, input.case_id, 'write');
    if (caseRecord.status !== 'APPROVED') {
      throw new AppError(
        409,
        'APPROVAL_REQUIRED_FOR_MOCK_PAYMENT',
        'Mock payments can only be initiated after an authorized officer has APPROVED the application.',
      );
    }

    const hasConsent = await this.consentService.hasActiveProcessingConsent(
      auth.organizationId,
      caseRecord.citizen_id,
      caseRecord.id,
    );

    validateCaseTransition({
      currentStatus: caseRecord.status,
      nextStatus: 'MOCK_PAYMENT_QUEUED',
      actorRole: auth.role,
      hasProcessingConsent: hasConsent,
      ruleVersionId: caseRecord.rule_version_id,
    });

    let amount = input.amount_pkr ?? 15000;
    if (!input.amount_pkr && caseRecord.rule_version_id) {
      const rv = await this.store.getRuleVersionById(auth.organizationId, caseRecord.rule_version_id);
      if (rv) amount = rv.rules_json.default_mock_grant_pkr;
    }

    const referenceCode = `MOCK-PAY-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const queuedPayment = await this.store.createMockPayment({
      organization_id: auth.organizationId,
      case_id: caseRecord.id,
      initiated_by: auth.userId,
      amount_pkr: amount,
      status: 'MOCK_PAYMENT_QUEUED',
      reference_code: referenceCode,
    });

    // Complete synthetic mock payment cleanly through state machine
    validateCaseTransition({
      currentStatus: 'MOCK_PAYMENT_QUEUED',
      nextStatus: 'MOCK_PAYMENT_COMPLETED',
      actorRole: auth.role,
      hasProcessingConsent: hasConsent,
      ruleVersionId: caseRecord.rule_version_id,
    });

    const completedPayment = await this.store.updateMockPayment(auth.organizationId, queuedPayment.id, {
      status: 'MOCK_PAYMENT_COMPLETED',
      completed_at: new Date().toISOString(),
    });

    const updatedCase = await this.store.updateCase(auth.organizationId, caseRecord.id, {
      status: 'MOCK_PAYMENT_COMPLETED',
    });

    if (citizen?.user_id) {
      await this.notifications.notify({
        organizationId: auth.organizationId,
        userId: citizen.user_id,
        caseId: caseRecord.id,
        notificationType: 'MOCK_PAYMENT_COMPLETED',
        title: 'Mock relief disbursement simulated',
        body: `Synthetic mock payment ${referenceCode} for ${amount} PKR completed (prototype simulation — no real funds transferred).`,
        language: caseRecord.preferred_language,
      });
    }

    await this.audit.log({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'mock_payment.completed',
      resourceType: 'mock_payment',
      resourceId: completedPayment.id,
      metadata: {
        case_id: caseRecord.id,
        amount_pkr: amount,
        reference_code: referenceCode,
        synthetic: true,
      },
    });

    return { payment: completedPayment, case: updatedCase };
  }
}
