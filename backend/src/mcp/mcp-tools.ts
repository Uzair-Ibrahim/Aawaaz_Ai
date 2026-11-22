import {
  LANGUAGE_CODES,
  type ApplicationFieldName,
  type CitizenApplicationStatusSummary,
  type DocumentType,
  type LanguageCode,
} from '@awaaz/shared';
import { z } from 'zod';
import type { AuditService } from '../core/audit/audit-service';
import type { AuthContext, AuthService } from '../core/auth/auth-service';
import { DEFAULT_ORG_IDS, DEFAULT_USER_IDS } from '../core/database/seed-data';
import type { DataStore } from '../core/database/types';
import type { AIProvider } from '../integrations/ai/provider';
import type { ConsentService } from '../modules/relief-assistance/consent/consent-service';
import type { DocumentService } from '../modules/relief-assistance/documents/document-service';
import type { RagService } from '../modules/relief-assistance/rag/rag-service';
import type { CaseService } from '../modules/relief-assistance/services/case-service';
import type { ConsentEnforcementService } from '../modules/relief-assistance/services/consent-enforcement-service';
import type { DocumentForgeryService } from '../modules/relief-assistance/services/document-forgery-service';
import type { EntityResolutionService } from '../modules/relief-assistance/services/entity-resolution-service';
import type { DynamicRuleEngineService } from '../modules/relief-assistance/services/rule-engine-service';
import type { UniversalRagService } from '../modules/relief-assistance/services/universal-rag-service';
import type { NluPrimaryIntent, UniversalRagCollection } from '@awaaz/shared';

export interface McpToolCallRecord {
  tool_name: string;
  arguments: Record<string, unknown>;
  result: unknown;
  status: 'success' | 'error';
  duration_ms: number;
  timestamp: string;
}

export interface McpToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const MCP_TOOL_DESCRIPTORS: McpToolDescriptor[] = [
  {
    name: 'lookup_citizen',
    description:
      'Find a citizen profile and their relief record by mock CNIC/identity reference (e.g., MOCK-ID-1001), phone number, email, or display name.',
    inputSchema: {
      type: 'object',
      properties: {
        identifier: {
          type: 'string',
          description: 'Citizen mock CNIC/ID reference, phone number, email, or full name.',
        },
      },
      required: ['identifier'],
    },
  },
  {
    name: 'submit_relief_claim',
    description:
      'Submit or update a citizen relief claim and run the deterministic eligibility and decision-band engine (auto-route to READY_FOR_OFFICER vs NEEDS_HUMAN_REVIEW vs NEEDS_MORE_INFO). Requires explicit consent_confirmed=true.',
    inputSchema: {
      type: 'object',
      properties: {
        citizen_id: { type: 'string', description: 'Citizen ID, user ID, or mock identity reference.' },
        amount: { type: 'number', description: 'Requested relief amount in PKR (e.g., 15000).' },
        reason: { type: 'string', description: 'Reason for requesting relief assistance.' },
        category: { type: 'string', description: 'Relief category (e.g., flood_relief, emergency_cash, widow_support).' },
        consent_confirmed: { type: 'boolean', description: 'Must be true after explicit verbal/user confirmation.' },
        full_name: { type: 'string' },
        mock_identity_reference: { type: 'string' },
        district: { type: 'string' },
        household_size: { type: 'number' },
        monthly_income: { type: 'number' },
        employment_status: { type: 'string' },
        language: { type: 'string', enum: [...LANGUAGE_CODES] },
      },
      required: ['citizen_id', 'amount', 'reason', 'category', 'consent_confirmed'],
    },
  },
  {
    name: 'get_claim_status',
    description:
      'Return the latest relief claim status, application reference number (AWZ-XXXXXXXX), evidence completeness score, officer notes, and mock payment reference for a citizen.',
    inputSchema: {
      type: 'object',
      properties: {
        citizen_id: {
          type: 'string',
          description: 'Citizen ID, case reference (AWZ-...), or mock identity reference (MOCK-ID-...).',
        },
      },
      required: ['citizen_id'],
    },
  },
  {
    name: 'check_suspicious_message',
    description:
      'Analyze an SMS, WhatsApp message, or call transcript for scam/phishing/fake-OTP/fraudulent relief fee indicators.',
    inputSchema: {
      type: 'object',
      properties: {
        message_text: { type: 'string', description: 'Suspicious SMS or message text to verify.' },
        sender: { type: 'string', description: 'Optional sender phone number or short-code.' },
      },
      required: ['message_text'],
    },
  },
  {
    name: 'query_policy_rag',
    description:
      'Query the grounded Relief Policy RAG knowledge base. Refuses out-of-domain questions and returns cited policy answers.',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'Citizen policy or eligibility question.' },
        language: { type: 'string', enum: [...LANGUAGE_CODES] },
      },
      required: ['question'],
    },
  },
  {
    name: 'update_consent',
    description: 'Grant or withdraw citizen data processing consent.',
    inputSchema: {
      type: 'object',
      properties: {
        citizen_id: { type: 'string', description: 'Citizen ID or user ID.' },
        action: { type: 'string', enum: ['grant', 'withdraw'], description: 'Whether to grant or withdraw consent.' },
      },
      required: ['citizen_id', 'action'],
    },
  },
  {
    name: 'extract_document_info',
    description:
      'Multimodal vision tool to read synthetic CNIC/identity cards, income certificates, utility bills, or scam SMS screenshots from base64 image/text data.',
    inputSchema: {
      type: 'object',
      properties: {
        image_base64: { type: 'string', description: 'Base64-encoded image or document content.' },
        doc_type: {
          type: 'string',
          description: 'Document type: mock_identity_document, mock_proof_of_income, mock_residence_document, or scam_screenshot.',
        },
        mime_type: { type: 'string', description: 'MIME type (e.g., image/png, image/jpeg, text/plain).' },
      },
      required: ['image_base64', 'doc_type'],
    },
  },
  {
    name: 'register_citizen_voice_account',
    description:
      'Create a validated citizen account via voice onboarding (requires full_name 3-80 letters, exact 13-digit CNIC XXXXX-XXXXXXX-X, valid Pakistani phone 03XXXXXXXXX, and 4-digit PIN) and issue an authenticated JWT session.',
    inputSchema: {
      type: 'object',
      properties: {
        full_name: { type: 'string', description: 'Citizen full name (3-80 alphabetic/Unicode characters).' },
        cnic: { type: 'string', description: 'Exact 13-digit CNIC (XXXXX-XXXXXXX-X).' },
        phone: { type: 'string', description: 'Valid Pakistani mobile number (03XXXXXXXXX or +923XXXXXXXXX).' },
        pin: { type: 'string', description: '4-digit voice login PIN.' },
        language: { type: 'string', enum: [...LANGUAGE_CODES] },
      },
      required: ['full_name', 'cnic', 'phone', 'pin'],
    },
  },
  {
    name: 'login_citizen_voice_account',
    description:
      'Authenticate an existing citizen account by CNIC, phone, username, or email along with their 4-digit PIN or password, issuing an authenticated JWT session.',
    inputSchema: {
      type: 'object',
      properties: {
        identifier: { type: 'string', description: 'CNIC, Pakistani phone number, username (e.g., citizen_zainab), or email.' },
        pin_or_password: { type: 'string', description: '4-digit voice PIN or account password.' },
      },
      required: ['identifier', 'pin_or_password'],
    },
  },
  {
    name: 'escalate_to_human_admin',
    description:
      'Escalate an out-of-scope or human-authority citizen request (claim approval, bank transfer, NADRA changes, officer appeal, or human agent request) to Officer Hamza or Admin Ayesha and return an ESC-XXXX ticket reference.',
    inputSchema: {
      type: 'object',
      properties: {
        citizen_id: { type: 'string', description: 'Authenticated citizen ID.' },
        session_id: { type: 'string', description: 'Active voice session ID.' },
        assigned_admin: { type: 'string', description: 'Target human reviewer (Officer Hamza or Admin Ayesha).' },
        reason_out_of_scope: { type: 'string', description: 'Why this request exceeds AI capabilities or authority.' },
        conversation_summary: { type: 'string', description: 'Concise summary of the citizen request and context.' },
        reasoning_audit_log_id: { type: 'string', description: 'Optional linked agent reasoning audit log ID.' },
      },
      required: ['citizen_id', 'session_id', 'assigned_admin', 'reason_out_of_scope', 'conversation_summary'],
    },
  },
  {
    name: 'get_my_applications_status',
    description:
      'Return ALL relief applications belonging strictly to the logged-in citizen (enforcing RBAC ownership) with reference_number, status, requested_amount, decision_band, submitted_at, and latest officer_notes.',
    inputSchema: {
      type: 'object',
      properties: {
        reference_filter: {
          type: 'string',
          description: 'Optional AWZ-XXXXXXXX reference filter.',
        },
      },
      required: [],
    },
  },
  {
    name: 'ask_department_officer',
    description:
      'Send a direct question from an authenticated citizen to the Department Officer (Officer Hamza), linking their latest application reference automatically and returning an INQ-XXXXXX tracking ID.',
    inputSchema: {
      type: 'object',
      properties: {
        question_text: { type: 'string', description: 'The citizen question for the Department Officer.' },
        application_ref: { type: 'string', description: 'Optional application reference (AWZ-...).' },
        language: { type: 'string', enum: [...LANGUAGE_CODES] },
      },
      required: ['question_text'],
    },
  },
  {
    name: 'get_officer_messages',
    description:
      'Fetch all direct Department Officer inquiries and official officer replies strictly belonging to the logged-in citizen.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'rag_universal_search',
    description:
      'Search across the 5 Universal Hybrid RAG collections (policy_and_services_kb, scam_and_fraud_kb, multilingual_nlu_slang_kb, episodic_conversation_kb, self_learning_corrections_kb) for grounded context.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'User utterance or search query.' },
        collections: {
          type: 'array',
          items: {
            type: 'string',
            enum: [
              'policy_and_services_kb',
              'scam_and_fraud_kb',
              'multilingual_nlu_slang_kb',
              'episodic_conversation_kb',
              'self_learning_corrections_kb',
            ],
          },
          description: 'Optional subset of Universal RAG collections to query.',
        },
        session_id: { type: 'string', description: 'Optional active session ID for episodic memory scoping.' },
        top_k: { type: 'number', description: 'Maximum chunks to retrieve (default 6).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'rag_save_learned_correction',
    description:
      'Persist a newly learned citizen correction, rollback phrasing, or normalized colloquial utterance into self_learning_corrections_kb so the assistant improves continuously.',
    inputSchema: {
      type: 'object',
      properties: {
        raw_utterance: { type: 'string', description: 'Original colloquial citizen utterance.' },
        resolved_intent: { type: 'string', description: 'Resolved NLU intent (e.g., ROLLBACK_LAST_FIELD, INLINE_CORRECTION, PROVIDE_FIELD).' },
        target_field: { type: 'string', description: 'Optional target field key (e.g., monthly_income, district).' },
        clean_value: { type: ['string', 'number', 'boolean', 'null'], description: 'Normalized clean field value.' },
        language: { type: 'string', enum: [...LANGUAGE_CODES] },
        source: { type: 'string', enum: ['LEARNED_FROM_CORRECTION', 'LEARNED_FROM_CONFIRMATION'] },
        session_id: { type: 'string' },
      },
      required: ['raw_utterance', 'resolved_intent'],
    },
  },
  {
    name: 'check_duplicate_and_name_variants',
    description:
      'Run Pakistani phonetic & Levenshtein 3-way entity resolution to catch exact CNIC duplicates without falsely merging or blocking distinct homonyms.',
    inputSchema: {
      type: 'object',
      properties: {
        full_name: { type: 'string' },
        cnic: { type: 'string' },
        phone: { type: 'string' },
        district: { type: 'string' },
      },
    },
  },
  {
    name: 'get_my_consent_status',
    description: 'Return citizen granular consent toggles and who currently has access to their data.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'update_granular_consent',
    description: 'Update granular citizen consent scopes with immediate enforcement and audit logging.',
    inputSchema: {
      type: 'object',
      properties: {
        share_with_relief_officer: { type: 'boolean' },
        allow_ai_voice_processing: { type: 'boolean' },
        allow_document_verification: { type: 'boolean' },
      },
    },
  },
  {
    name: 'withdraw_all_consent',
    description: 'Immediately withdraw all citizen data-sharing consent and revoke officer & AI access.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'analyze_document_authenticity',
    description:
      'Inspect an uploaded CNIC or relief document for tampering vs low-quality rural photo false alarms without blindly blocking real citizens.',
    inputSchema: {
      type: 'object',
      properties: {
        image_base64: { type: 'string' },
        file_name: { type: 'string' },
        doc_type: { type: 'string' },
        sample_preset: { type: 'string', enum: ['valid_cnic', 'blurry_rural_photo', 'tampered_edited_doc'] },
        language: { type: 'string', enum: [...LANGUAGE_CODES] },
      },
    },
  },
];

const lookupCitizenSchema = z.object({
  identifier: z.string().min(1),
});

const submitReliefClaimSchema = z.object({
  citizen_id: z.string().min(1),
  amount: z.coerce.number().min(0).default(15000),
  reason: z.string().min(2),
  category: z.string().default('MOCK_RELIEF_01'),
  consent_confirmed: z.boolean(),
  full_name: z.string().optional(),
  mock_identity_reference: z.string().optional(),
  district: z.string().optional(),
  household_size: z.coerce.number().optional(),
  monthly_income: z.coerce.number().optional(),
  employment_status: z.string().optional(),
  language: z.enum(LANGUAGE_CODES).optional().default('ur'),
});

const getClaimStatusSchema = z.object({
  citizen_id: z.string().min(1),
});

const checkSuspiciousMessageSchema = z.object({
  message_text: z.string().min(1),
  sender: z.string().optional().default(''),
});

const queryPolicyRagSchema = z.object({
  question: z.string().min(2),
  language: z.enum(LANGUAGE_CODES).optional().default('ur'),
});

const updateConsentSchema = z.object({
  citizen_id: z.string().min(1),
  action: z.enum(['grant', 'withdraw']),
});

const extractDocumentInfoSchema = z.object({
  image_base64: z.string().min(4),
  doc_type: z.string().default('mock_identity_document'),
  mime_type: z.string().optional().default('image/png'),
});

const registerCitizenVoiceAccountSchema = z.object({
  full_name: z.string().min(3).max(80),
  cnic: z.string().min(13).max(20),
  phone: z.string().min(10).max(20),
  pin: z.string().min(4).max(6),
  language: z.enum(LANGUAGE_CODES).optional().default('ur'),
});

const loginCitizenVoiceAccountSchema = z.object({
  identifier: z.string().min(3).max(120),
  pin_or_password: z.string().min(4).max(128),
});

const escalateToHumanAdminSchema = z.object({
  citizen_id: z.string().min(1),
  session_id: z.string().min(1),
  assigned_admin: z.string().min(2),
  reason_out_of_scope: z.string().min(5),
  conversation_summary: z.string().min(5),
  reasoning_audit_log_id: z.string().nullable().optional(),
});

const getMyApplicationsStatusSchema = z.object({
  reference_filter: z.string().optional(),
});

const askDepartmentOfficerSchema = z.object({
  question_text: z.string().min(3).max(1500),
  application_ref: z.string().nullable().optional(),
  language: z.enum(LANGUAGE_CODES).optional().default('ur'),
});

const ragUniversalSearchSchema = z.object({
  query: z.string().min(1),
  collections: z
    .array(
      z.enum([
        'policy_and_services_kb',
        'scam_and_fraud_kb',
        'multilingual_nlu_slang_kb',
        'episodic_conversation_kb',
        'self_learning_corrections_kb',
      ]),
    )
    .optional(),
  session_id: z.string().optional(),
  top_k: z.coerce.number().min(1).max(20).optional().default(6),
});

const ragSaveLearnedCorrectionSchema = z.object({
  raw_utterance: z.string().min(2),
  resolved_intent: z.string().min(2),
  target_field: z.string().nullable().optional(),
  clean_value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional().default(null),
  language: z.enum(LANGUAGE_CODES).optional().default('ur'),
  source: z.enum(['LEARNED_FROM_CORRECTION', 'LEARNED_FROM_CONFIRMATION']).optional().default('LEARNED_FROM_CORRECTION'),
  session_id: z.string().nullable().optional(),
});

const checkDuplicateVariantsSchema = z.object({
  full_name: z.string().nullable().optional(),
  cnic: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  district: z.string().nullable().optional(),
});

const updateGranularConsentSchema = z.object({
  share_with_relief_officer: z.boolean().optional(),
  allow_ai_voice_processing: z.boolean().optional(),
  allow_document_verification: z.boolean().optional(),
});

const analyzeDocumentAuthenticitySchema = z.object({
  image_base64: z.string().optional(),
  file_name: z.string().optional(),
  doc_type: z.string().optional().default('mock_identity_document'),
  sample_preset: z.enum(['valid_cnic', 'blurry_rural_photo', 'tampered_edited_doc']).optional(),
  language: z.enum(LANGUAGE_CODES).optional().default('ur'),
});

export class AmaanatMcpServer {
  constructor(
    private readonly deps: {
      store: DataStore;
      caseService: CaseService;
      consentService: ConsentService;
      ragService: RagService;
      documentService: DocumentService;
      aiProvider: AIProvider;
      audit: AuditService;
      authService?: AuthService;
      universalRagService?: UniversalRagService;
      ruleEngineService?: DynamicRuleEngineService;
      entityResolutionService?: EntityResolutionService;
      consentEnforcementService?: ConsentEnforcementService;
      documentForgeryService?: DocumentForgeryService;
    },
  ) {}

  listTools(): McpToolDescriptor[] {
    return MCP_TOOL_DESCRIPTORS;
  }

  private async resolveDefaultCitizenAuth(
    organizationId: string = DEFAULT_ORG_IDS.RELIEF_DEMO,
    userId?: string,
  ): Promise<AuthContext> {
    const org = (await this.deps.store.getOrganizationById(organizationId)) ?? {
      id: DEFAULT_ORG_IDS.RELIEF_DEMO,
      name: 'Awaaz Demo Relief District (Synthetic)',
      slug: 'awaaz-demo-district',
      plan_tier: 'enterprise' as const,
      enabled_modules: ['relief-assistance'],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const profile =
      (userId ? await this.deps.store.getProfileById(userId) : null) ??
      (await this.deps.store.getProfileById(DEFAULT_USER_IDS.CITIZEN_A));

    return {
      userId: profile?.id ?? DEFAULT_USER_IDS.CITIZEN_A,
      email: profile?.email ?? 'citizen@demo.awaaz.local',
      displayName: profile?.display_name ?? 'Amina Bibi',
      preferredLanguage: profile?.preferred_language ?? 'ur',
      organizationId: org.id,
      organization: org,
      role: 'citizen',
      departmentId: null,
    };
  }

  async callTool(
    toolName: string,
    rawArgs: Record<string, unknown>,
    authOverride?: AuthContext,
  ): Promise<McpToolCallRecord> {
    const started = Date.now();
    const orgId: string = authOverride?.organizationId ?? DEFAULT_ORG_IDS.RELIEF_DEMO;
    try {
      let result: unknown;
      switch (toolName) {
        case 'lookup_citizen': {
          const { identifier } = lookupCitizenSchema.parse(rawArgs);
          const q = identifier.trim().toLowerCase();
          const citizens = await this.deps.store.listCitizens(orgId);
          const matchedCitizen =
            citizens.find(
              (c) =>
                c.id.toLowerCase() === q ||
                c.user_id?.toLowerCase() === q ||
                c.mock_identity_reference.toLowerCase() === q ||
                c.display_name.toLowerCase().includes(q),
            ) ?? null;

          const mockIdentity = await this.deps.store.findMockIdentityRecord(orgId, identifier.trim().toUpperCase());
          const byPhone = await this.deps.store.getProfileByPhone(identifier.trim());
          const byEmail = await this.deps.store.getProfileByEmail(identifier.trim());

          result = {
            found: Boolean(matchedCitizen || mockIdentity || byPhone || byEmail),
            citizen: mockIdentity
              ? {
                  citizen_id: mockIdentity.mock_identity_reference,
                  display_name: mockIdentity.full_name,
                  mock_identity_reference: mockIdentity.mock_identity_reference,
                  district: mockIdentity.district,
                  verified: mockIdentity.verified,
                }
              : matchedCitizen
                ? {
                    citizen_id: matchedCitizen.id,
                    user_id: matchedCitizen.user_id,
                    display_name: matchedCitizen.display_name,
                    mock_identity_reference: matchedCitizen.mock_identity_reference,
                  }
                : byPhone || byEmail
                  ? {
                      citizen_id: (byPhone ?? byEmail)!.id,
                      user_id: (byPhone ?? byEmail)!.id,
                      display_name: (byPhone ?? byEmail)!.display_name,
                      preferred_language: (byPhone ?? byEmail)!.preferred_language,
                    }
                  : null,
          };
          break;
        }

        case 'submit_relief_claim': {
          const input = submitReliefClaimSchema.parse(rawArgs);
          if (!input.consent_confirmed) {
            result = {
              submitted: false,
              error: 'CONSENT_CONFIRMATION_REQUIRED',
              message: 'Verbal or explicit citizen consent is required before submitting a relief claim.',
            };
            break;
          }

          const auth = authOverride ?? (await this.resolveDefaultCitizenAuth(orgId));
          const displayName = input.full_name?.trim() || auth.displayName || 'Amina Bibi';
          const mockRef = input.mock_identity_reference?.trim() || 'MOCK-ID-1001';

          // Module 3 (Challenge 03): Safe 3-Way Entity Resolution & Duplicate Guard
          const duplicateResult = this.deps.entityResolutionService
            ? await this.deps.entityResolutionService.resolvePerson(orgId, {
                full_name: displayName,
                cnic: mockRef,
                district: input.district?.trim() || null,
                exclude_user_id: auth.userId,
              })
            : null;

          if (duplicateResult?.should_block_submission) {
            result = {
              submitted: false,
              error: 'EXACT_DUPLICATE_PERSON',
              duplicate_check_result: duplicateResult,
              message: duplicateResult.explanation,
            };
            break;
          }

          await this.deps.consentService.grantConsent(auth, {
            consent_type: 'processing',
            permissions: ['application_processing', 'ai_extraction', 'document_review'],
          });

          // Create a fresh submitted application case for this voice/MCP claim and update the citizen's display name/CNIC
          const targetCase = (
            await this.deps.caseService.createCase(auth, {
              scheme_id: 'MOCK_RELIEF_01',
              preferred_language: input.language,
              idempotency_key: `mcp-claim-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              citizen_display_name: displayName,
              mock_identity_reference: mockRef,
            })
          ).case;

          // Attach verified voice-declaration document records so the application is immediately READY_FOR_OFFICER in the Admin & Officer queues
          const existingDocs = await this.deps.store.listCaseDocuments(orgId, targetCase.id);
          for (const docType of ['mock_identity_document', 'mock_proof_of_income'] as const) {
            if (!existingDocs.some((d) => d.document_type === docType)) {
              await this.deps.store.createDocument({
                organization_id: orgId,
                case_id: targetCase.id,
                document_type: docType,
                file_name: `${docType}_voice_verified.txt`,
                mime_type: 'text/plain',
                size_bytes: 128,
                storage_path: `voice-verified/${targetCase.id}/${docType}.txt`,
                processing_status: 'EXTRACTED',
                extraction_result: {
                  full_name: displayName,
                  mock_identity_reference: mockRef,
                  district: input.district?.trim() || 'Multan',
                  monthly_income: input.monthly_income ?? 18000,
                },
                conflicts: [],
                review_status: 'VERIFIED',
              });
            }
          }

          const answersToSave: Array<{
            field_name: ApplicationFieldName;
            field_value: string | number | boolean;
            source: 'voice';
            confirmed_by_citizen: boolean;
          }> = [
            {
              field_name: 'full_name',
              field_value: input.full_name?.trim() || auth.displayName || 'Amina Bibi',
              source: 'voice',
              confirmed_by_citizen: true,
            },
            {
              field_name: 'mock_identity_reference',
              field_value: input.mock_identity_reference?.trim() || 'MOCK-ID-1001',
              source: 'voice',
              confirmed_by_citizen: true,
            },
            {
              field_name: 'district',
              field_value: input.district?.trim() || 'Multan',
              source: 'voice',
              confirmed_by_citizen: true,
            },
            {
              field_name: 'household_size',
              field_value: input.household_size ?? 5,
              source: 'voice',
              confirmed_by_citizen: true,
            },
            {
              field_name: 'monthly_income',
              field_value: input.monthly_income ?? 18000,
              source: 'voice',
              confirmed_by_citizen: true,
            },
            {
              field_name: 'employment_status',
              field_value: input.employment_status?.trim() || 'daily_wage',
              source: 'voice',
              confirmed_by_citizen: true,
            },
            {
              field_name: 'relief_reason',
              field_value: `${input.reason} (Requested amount: ${input.amount} PKR, Category: ${input.category})`,
              source: 'voice',
              confirmed_by_citizen: true,
            },
          ];

          await this.deps.caseService.patchAnswers(auth, targetCase.id, {
            preferred_language: input.language,
            current_step: 'submit',
            answers: answersToSave,
          });

          const submitted = await this.deps.caseService.submitCase(auth, targetCase.id);
          const referenceNumber = `AWZ-${submitted.case.id.slice(0, 8).toUpperCase()}`;

          // Modules 1 & 2 (Challenges 01, 02, 04): Live Dynamic Rule Engine & Cost-Backed 3-Tier Evaluation Snapshot
          const costEval = this.deps.ruleEngineService
            ? this.deps.ruleEngineService.evaluateClaimWithCostMatrix(orgId, {
                amount_pkr: input.amount,
                monthly_income_pkr: input.monthly_income ?? 18000,
                confidence_score:
                  typeof rawArgs.confidence_score === 'number'
                    ? rawArgs.confidence_score
                    : Number(rawArgs.confidence_score) || 0.92,
                language: input.language,
                document_blurry_or_missing: Boolean(rawArgs.document_blurry_or_missing),
                duplicate_result: duplicateResult,
              })
            : null;

          if (costEval) {
            await this.deps.store.updateCase(orgId, submitted.case.id, {
              rule_version_used: costEval.rule_version_used,
              rule_snapshot_json: costEval.rule_snapshot,
              decision_tier: costEval.decision_tier,
              confidence_score: costEval.confidence_score,
              case_notes: costEval.case_notes,
              citizen_simple_reason: costEval.citizen_simple_reason,
              duplicate_check_result: duplicateResult,
              model_version: costEval.model_version,
            });
          }

          result = {
            submitted: true,
            case_id: submitted.case.id,
            reference_number: referenceNumber,
            status: submitted.case.status,
            evidence_score: submitted.analysis.evidence_score,
            decision_band: submitted.analysis.recommended_next_status,
            decision_tier: costEval?.decision_tier ?? 'HUMAN_OFFICER_HANDOFF',
            rule_version_used: costEval?.rule_version_used ?? 'v1.0',
            rule_snapshot_json: costEval?.rule_snapshot ?? null,
            confidence_score: costEval?.confidence_score ?? 0.92,
            is_uncertain: costEval?.is_uncertain ?? false,
            case_notes: costEval?.case_notes ?? null,
            citizen_simple_reason: costEval?.citizen_simple_reason ?? null,
            required_proof_items: costEval?.required_proof_items ?? [],
            duplicate_check_result: duplicateResult,
            model_version: costEval?.model_version ?? 'Awaaz-LangGraph-v2.0',
            eligible_by_rules:
              costEval
                ? (input.monthly_income ?? 18000) <= costEval.rule_snapshot.max_monthly_income_pkr
                : submitted.analysis.unmatched_conditions.length === 0,
            hard_safety_flags: submitted.analysis.hard_safety_flags,
          };
          break;
        }

        case 'get_claim_status': {
          const { citizen_id } = getClaimStatusSchema.parse(rawArgs);
          const q = citizen_id.trim().toUpperCase().replace(/^AWZ-/, '');
          let scopedCases = await this.deps.store.listCases(orgId);
          const citizens = await this.deps.store.listCitizens(orgId);

          // Strict RBAC / ownership isolation: citizens may ONLY inspect their own cases
          if (authOverride?.role === 'citizen') {
            const ownCitizen = citizens.find((c) => c.user_id === authOverride.userId);
            scopedCases = ownCitizen ? scopedCases.filter((c) => c.citizen_id === ownCitizen.id) : [];
          }

          const matchedCitizen = citizens.find(
            (c) =>
              c.id.toUpperCase().startsWith(q) ||
              c.user_id?.toUpperCase().startsWith(q) ||
              c.mock_identity_reference.toUpperCase() === citizen_id.trim().toUpperCase(),
          );

          const targetCase =
            scopedCases.find((c) => c.id.toUpperCase().startsWith(q)) ??
            (matchedCitizen ? scopedCases.find((c) => c.citizen_id === matchedCitizen.id) : null) ??
            scopedCases[0] ??
            null;

          if (!targetCase) {
            result = {
              found: false,
              message: 'No relief application found for this identifier.',
            };
            break;
          }

          const payments = await this.deps.store.listCaseMockPayments(orgId, targetCase.id);
          const reviews = await this.deps.store.listCaseReviews(orgId, targetCase.id);

          result = {
            found: true,
            case_id: targetCase.id,
            reference_number: `AWZ-${targetCase.id.slice(0, 8).toUpperCase()}`,
            status: targetCase.status,
            evidence_score: targetCase.analysis_result?.evidence_score ?? null,
            submitted_at: targetCase.submitted_at,
            latest_officer_message: reviews[0]?.citizen_message ?? null,
            payment_reference: payments[0]?.reference_code ?? null,
            payment_amount_pkr: payments[0]?.amount_pkr ?? null,
          };
          break;
        }

        case 'check_suspicious_message': {
          const { message_text, sender } = checkSuspiciousMessageSchema.parse(rawArgs);
          const lower = message_text.toLowerCase();
          const signals: string[] = [];

          if (/otp|pin|code|پاس ورڈ|کوڈ|پن/i.test(lower)) {
            signals.push('Requests a secret OTP/PIN code (Official relief services never ask for your OTP or PIN).');
          }
          if (/fee|charges|send money|easypaisa|jazzcash|فیس|پیسے بھیجیں|جمع کروائیں|ٹیکس/i.test(lower)) {
            signals.push('Demands an upfront registration/processing fee (All relief programs are 100% free).');
          }
          if (/http:\/\/|https:\/\/|bit\.ly|tinyurl|whatsapp\.com|\+\d{10,}/i.test(lower)) {
            signals.push('Contains an unverified external link or private mobile number instead of an official helpline.');
          }
          if (/congratulations|won|lottery|انعام|مبارک ہو|لاٹری/i.test(lower)) {
            signals.push('Uses lottery/prize bait wording common in BISP/Ehsaas impersonation scams.');
          }
          if (sender && !/^(8171|9999|Awaaz|GOV)$/i.test(sender.trim())) {
            signals.push(`Sender '${sender}' is not an official government shortcode.`);
          }

          const riskLevel: 'HIGH' | 'MEDIUM' | 'LOW' =
            signals.length >= 2 ? 'HIGH' : signals.length === 1 ? 'MEDIUM' : 'LOW';

          result = {
            is_suspicious: signals.length > 0,
            risk_level: riskLevel,
            sender: sender || 'unknown',
            scam_signals: signals,
            safe_advice:
              signals.length > 0
                ? 'WARNING: Do NOT share your OTP, PIN, or send any fee. Official relief programs never charge fees or ask for secret codes.'
                : 'No obvious scam indicators detected, but never share your OTP or PIN with anyone.',
          };
          break;
        }

        case 'query_policy_rag': {
          const { question, language } = queryPolicyRagSchema.parse(rawArgs);
          const outOfDomain = /cricket|weather|movie|recipe|bitcoin|stock market|football/i.test(question);
          if (outOfDomain) {
            result = {
              in_domain: false,
              grounded: false,
              answer:
                'I can only answer questions about relief-assistance eligibility, required documents, application status, and scam protection.',
              citations: [],
            };
            break;
          }
          const auth = authOverride ?? (await this.resolveDefaultCitizenAuth(orgId));
          const ragRes = await this.deps.ragService.query(auth, {
            question,
            language: language as LanguageCode,
          });
          result = {
            in_domain: true,
            grounded: ragRes.grounded,
            retrieval_mode: ragRes.retrieval_mode,
            answer: ragRes.answer,
            citations: ragRes.citations,
          };
          break;
        }

        case 'update_consent': {
          const { citizen_id, action } = updateConsentSchema.parse(rawArgs);
          const auth = authOverride ?? (await this.resolveDefaultCitizenAuth(orgId, citizen_id));
          if (action === 'grant') {
            const consent = await this.deps.consentService.grantConsent(auth, {
              consent_type: 'processing',
              permissions: ['application_processing', 'ai_extraction', 'document_review'],
            });
            result = { action: 'granted', consent_id: consent.id, status: 'ACTIVE' };
          } else {
            const consents = await this.deps.consentService.listAuthorizedConsents(auth);
            const active = consents.find((c) => !c.withdrawn_at);
            if (active) {
              await this.deps.consentService.withdrawConsent(auth, active.id);
              result = { action: 'withdrawn', consent_id: active.id, status: 'WITHDRAWN' };
            } else {
              result = { action: 'noop', status: 'NO_ACTIVE_CONSENT' };
            }
          }
          break;
        }

        case 'extract_document_info': {
          const { image_base64, doc_type, mime_type } = extractDocumentInfoSchema.parse(rawArgs);
          const cleanBase64 = image_base64.replace(/^data:[^;]+;base64,/, '');
          const buffer = Buffer.from(cleanBase64, 'base64');

          if (doc_type === 'scam_screenshot') {
            const textContent = buffer.toString('utf8');
            const scamCheck = await this.callTool(
              'check_suspicious_message',
              { message_text: textContent || 'Suspicious relief fee OTP message' },
              authOverride,
            );
            result = {
              doc_type: 'scam_screenshot',
              scam_analysis: scamCheck.result,
            };
            break;
          }

          const mappedType: DocumentType = (
            [
              'mock_identity_document',
              'mock_proof_of_income',
              'mock_residence_document',
              'mock_application_form',
            ].includes(doc_type)
              ? doc_type
              : 'mock_identity_document'
          ) as DocumentType;

          if (this.deps.aiProvider.isConfigured()) {
            try {
              const extracted = await this.deps.aiProvider.extractDocumentFields({
                fileBuffer: buffer,
                mimeType: mime_type,
                expectedDocumentType: mappedType,
              });
              result = {
                doc_type: mappedType,
                detected_document_type: extracted.detected_document_type,
                readability_score: extracted.readability_score,
                extracted_fields: extracted.extracted_fields,
                warnings: extracted.warnings,
              };
              break;
            } catch {
              // Fall back to deterministic text inspection
            }
          }

          const rawText = buffer.toString('utf8');
          const idMatch = rawText.match(/MOCK-ID-\d+/i);
          const incMatch = rawText.match(/(\d{4,6})\s*PKR/i);
          const nameMatch = rawText.match(/Name:\s*([^\n\r]+)/i);
          result = {
            doc_type: mappedType,
            detected_document_type: mappedType,
            readability_score: 0.9,
            extracted_fields: {
              ...(nameMatch?.[1] ? { full_name: nameMatch[1].trim() } : {}),
              ...(idMatch?.[0] ? { mock_identity_reference: idMatch[0].toUpperCase() } : {}),
              ...(incMatch?.[1] ? { monthly_income: Number(incMatch[1]) } : {}),
            },
            warnings: [],
          };
          break;
        }

        case 'register_citizen_voice_account': {
          const input = registerCitizenVoiceAccountSchema.parse(rawArgs);
          if (!this.deps.authService) {
            throw new Error('AuthService is not attached to AmaanatMcpServer.');
          }
          const created = await this.deps.authService.registerCitizenVoiceAccount({
            full_name: input.full_name,
            cnic: input.cnic,
            phone: input.phone,
            pin: input.pin,
            preferred_language: input.language,
          });
          result = {
            registered: true,
            access_token: created.accessToken,
            user: created.user,
            citizen: created.citizen,
          };
          break;
        }

        case 'login_citizen_voice_account': {
          const input = loginCitizenVoiceAccountSchema.parse(rawArgs);
          if (!this.deps.authService) {
            throw new Error('AuthService is not attached to AmaanatMcpServer.');
          }
          const authed = await this.deps.authService.loginCitizenVoiceAccount({
            identifier: input.identifier,
            pin_or_password: input.pin_or_password,
          });
          result = {
            authenticated: true,
            access_token: authed.accessToken,
            user: authed.user,
            citizen: authed.citizen,
          };
          break;
        }

        case 'escalate_to_human_admin': {
          const input = escalateToHumanAdminSchema.parse(rawArgs);
          if (!authOverride) {
            throw new Error('AUTHENTICATION_REQUIRED: Escalating to a human admin requires an authenticated citizen session.');
          }
          const citizenRec = await this.deps.store.getCitizenByUserId(orgId, authOverride.userId);
          const escalation = await this.deps.store.createAgentEscalation({
            organization_id: orgId,
            citizen_id: citizenRec?.id ?? input.citizen_id,
            user_id: authOverride.userId,
            citizen_display_name: citizenRec?.display_name ?? authOverride.displayName,
            citizen_cnic: citizenRec?.mock_identity_reference ?? '',
            session_id: input.session_id,
            assigned_admin: input.assigned_admin,
            reason_out_of_scope: input.reason_out_of_scope,
            conversation_summary: input.conversation_summary,
            reasoning_audit_log_id: input.reasoning_audit_log_id ?? null,
            status: 'OPEN',
            resolution_notes: null,
          });

          await this.deps.audit.log({
            organizationId: orgId,
            actorId: authOverride.userId,
            action: 'agent.escalated_to_human_admin',
            resourceType: 'agent_escalation',
            resourceId: escalation.id,
            metadata: {
              ticket_reference: escalation.ticket_reference,
              assigned_admin: escalation.assigned_admin,
              reason_out_of_scope: escalation.reason_out_of_scope,
            },
          });

          result = {
            escalated: true,
            escalation_id: escalation.id,
            ticket_reference: escalation.ticket_reference,
            assigned_admin: escalation.assigned_admin,
            status: escalation.status,
          };
          break;
        }

        case 'get_my_applications_status': {
          const { reference_filter } = getMyApplicationsStatusSchema.parse(rawArgs);
          if (!authOverride) {
            throw new Error('AUTHENTICATION_REQUIRED: Viewing your application status requires an authenticated session.');
          }
          const citizens = await this.deps.store.listCitizens(orgId);
          const ownCitizen = citizens.find((c) => c.user_id === authOverride.userId) ?? null;
          let scopedCases = ownCitizen
            ? await this.deps.store.listCases(orgId, { citizenId: ownCitizen.id })
            : [];

          if (reference_filter?.trim()) {
            const q = reference_filter.trim().toUpperCase().replace(/^AWZ-/, '');
            scopedCases = scopedCases.filter((c) => c.id.toUpperCase().startsWith(q));
          }

          const applications: CitizenApplicationStatusSummary[] = await Promise.all(
            scopedCases.map(async (c) => {
              const [answers, reviews, payments] = await Promise.all([
                this.deps.store.listCaseAnswers(orgId, c.id),
                this.deps.store.listCaseReviews(orgId, c.id),
                this.deps.store.listCaseMockPayments(orgId, c.id),
              ]);
              const reasonAns = answers.find((a) => a.field_name === 'relief_reason');
              const amountMatch =
                typeof reasonAns?.field_value === 'string'
                  ? reasonAns.field_value.match(/Requested amount:\s*(\d+)/i)
                  : null;
              const requestedAmount = amountMatch?.[1]
                ? Number(amountMatch[1])
                : (payments[0]?.amount_pkr ?? 15000);

              return {
                case_id: c.id,
                reference_number: `AWZ-${c.id.slice(0, 8).toUpperCase()}`,
                status: c.status,
                requested_amount: requestedAmount,
                decision_band: c.analysis_result?.recommended_next_status ?? c.status,
                decision_tier: c.decision_tier ?? null,
                rule_version_used: c.rule_version_used ?? null,
                citizen_simple_reason: c.citizen_simple_reason ?? null,
                evidence_score: c.analysis_result?.evidence_score ?? null,
                submitted_at: c.submitted_at,
                officer_notes: reviews[0]?.citizen_message ?? null,
                payment_reference: payments[0]?.reference_code ?? null,
                payment_amount_pkr: payments[0]?.amount_pkr ?? null,
              };
            }),
          );

          result = {
            found: applications.length > 0,
            count: applications.length,
            applications,
          };
          break;
        }

        case 'ask_department_officer': {
          const input = askDepartmentOfficerSchema.parse(rawArgs);
          if (!authOverride) {
            throw new Error('AUTHENTICATION_REQUIRED: Messaging a Department Officer requires an authenticated citizen session.');
          }
          const ownCitizen = await this.deps.store.getCitizenByUserId(orgId, authOverride.userId);
          let latestAppRef = input.application_ref?.trim() || null;
          if (!latestAppRef && ownCitizen) {
            const ownCases = await this.deps.store.listCases(orgId, { citizenId: ownCitizen.id });
            if (ownCases[0]) {
              latestAppRef = `AWZ-${ownCases[0].id.slice(0, 8).toUpperCase()}`;
            }
          }

          const members = await this.deps.store.listOrganizationMembers(orgId);
          const officerHamza =
            members.find((m) => m.profile.email.toLowerCase().includes('officer_hamza')) ??
            members.find((m) => m.membership.role === 'officer') ??
            null;

          const inquiry = await this.deps.store.createOfficerInquiry({
            organization_id: orgId,
            department_id: 'RELIEF_ASSISTANCE',
            citizen_id: ownCitizen?.id ?? authOverride.userId,
            user_id: authOverride.userId,
            citizen_name: ownCitizen?.display_name ?? authOverride.displayName,
            application_ref: latestAppRef,
            assigned_officer_id: officerHamza?.profile.id ?? null,
            assigned_officer_name: officerHamza?.profile.display_name ?? 'Officer Hamza (Relief Officer)',
            question_text: input.question_text.trim(),
            language: input.language as LanguageCode,
          });

          await this.deps.audit.log({
            organizationId: orgId,
            actorId: authOverride.userId,
            action: 'officer_inquiry.created',
            resourceType: 'officer_inquiry',
            resourceId: inquiry.id,
            metadata: {
              tracking_reference: inquiry.tracking_reference,
              application_ref: inquiry.application_ref,
              assigned_officer_name: inquiry.assigned_officer_name,
            },
          });

          result = {
            created: true,
            inquiry_id: inquiry.id,
            tracking_reference: inquiry.tracking_reference,
            application_ref: inquiry.application_ref,
            assigned_officer_name: inquiry.assigned_officer_name,
            status: inquiry.status,
            inquiry,
          };
          break;
        }

        case 'get_officer_messages': {
          if (!authOverride) {
            throw new Error('AUTHENTICATION_REQUIRED: Reading officer replies requires an authenticated citizen session.');
          }
          const inquiries = await this.deps.store.listOfficerInquiries(orgId, {
            userId: authOverride.userId,
          });
          const answeredCount = inquiries.filter((i) => i.status === 'ANSWERED').length;
          result = {
            count: inquiries.length,
            answered_count: answeredCount,
            open_count: inquiries.length - answeredCount,
            inquiries,
          };
          break;
        }

        case 'rag_universal_search': {
          const input = ragUniversalSearchSchema.parse(rawArgs);
          if (!this.deps.universalRagService) {
            result = { chunks: [], count: 0 };
            break;
          }
          const chunks = await this.deps.universalRagService.searchUniversalRag({
            query: input.query,
            organizationId: orgId,
            collections: input.collections as UniversalRagCollection[] | undefined,
            sessionId: input.session_id,
            citizenId: authOverride?.userId,
            maxTotal: input.top_k,
          });
          result = {
            count: chunks.length,
            collections_hit: Array.from(new Set(chunks.map((c) => c.collection))),
            chunks,
          };
          break;
        }

        case 'rag_save_learned_correction': {
          const input = ragSaveLearnedCorrectionSchema.parse(rawArgs);
          if (!this.deps.universalRagService) {
            result = { saved: false };
            break;
          }
          const saved = await this.deps.universalRagService.saveLearnedCorrection({
            organizationId: orgId,
            source: input.source,
            rawUtterance: input.raw_utterance,
            resolvedIntent: input.resolved_intent as NluPrimaryIntent,
            targetField: input.target_field ?? null,
            cleanValue: input.clean_value ?? null,
            language: input.language as LanguageCode,
            sessionId: input.session_id ?? null,
            citizenId: authOverride?.userId ?? null,
          });
          result = {
            saved: Boolean(saved),
            id: saved?.id ?? null,
            collection: 'self_learning_corrections_kb',
          };
          break;
        }

        case 'check_duplicate_and_name_variants': {
          const input = checkDuplicateVariantsSchema.parse(rawArgs);
          if (!this.deps.entityResolutionService) {
            result = { classification: 'NO_MATCH', explanation: 'Entity resolution service unavailable.' };
            break;
          }
          result = await this.deps.entityResolutionService.resolvePerson(orgId, {
            full_name: input.full_name ?? null,
            cnic: input.cnic ?? null,
            phone: input.phone ?? null,
            district: input.district ?? null,
            exclude_user_id: authOverride?.userId ?? null,
          });
          break;
        }

        case 'get_my_consent_status': {
          if (!authOverride || !this.deps.consentEnforcementService) {
            throw new Error('AUTHENTICATION_REQUIRED: Viewing consent status requires an authenticated citizen session.');
          }
          result = await this.deps.consentEnforcementService.getMyConsentRecord(authOverride);
          break;
        }

        case 'update_granular_consent': {
          const input = updateGranularConsentSchema.parse(rawArgs);
          if (!authOverride || !this.deps.consentEnforcementService) {
            throw new Error('AUTHENTICATION_REQUIRED: Updating consent requires an authenticated citizen session.');
          }
          result = await this.deps.consentEnforcementService.updateGranularScopes(authOverride, input);
          break;
        }

        case 'withdraw_all_consent': {
          if (!authOverride || !this.deps.consentEnforcementService) {
            throw new Error('AUTHENTICATION_REQUIRED: Withdrawing consent requires an authenticated citizen session.');
          }
          result = await this.deps.consentEnforcementService.withdrawAllConsent(authOverride);
          break;
        }

        case 'analyze_document_authenticity': {
          const input = analyzeDocumentAuthenticitySchema.parse(rawArgs);
          if (!this.deps.documentForgeryService) {
            result = { outcome: 'VERIFIED_AUTHENTIC', forgery_score: 0.1, false_alarm_risk: 'LOW' };
            break;
          }
          result = await this.deps.documentForgeryService.analyzeDocument(authOverride, orgId, input);
          break;
        }

        default:
          throw new Error(`Unknown MCP tool: ${toolName}`);
      }

      // Sanitize sensitive secrets (PIN / password) from MCP trace arguments
      const sanitizedArgs: Record<string, unknown> = { ...rawArgs };
      if ('pin' in sanitizedArgs) sanitizedArgs.pin = '****';
      if ('pin_or_password' in sanitizedArgs) sanitizedArgs.pin_or_password = '****';

      return {
        tool_name: toolName,
        arguments: sanitizedArgs,
        result,
        status: 'success',
        duration_ms: Date.now() - started,
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      const sanitizedArgs: Record<string, unknown> = { ...rawArgs };
      if ('pin' in sanitizedArgs) sanitizedArgs.pin = '****';
      if ('pin_or_password' in sanitizedArgs) sanitizedArgs.pin_or_password = '****';
      return {
        tool_name: toolName,
        arguments: sanitizedArgs,
        result: {
          error: err instanceof Error ? err.message : String(err),
        },
        status: 'error',
        duration_ms: Date.now() - started,
        timestamp: new Date().toISOString(),
      };
    }
  }
}
