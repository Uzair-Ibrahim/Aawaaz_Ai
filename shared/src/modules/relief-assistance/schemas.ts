import { z } from 'zod';
import { languageCodeSchema } from '../../saas/types';

export const CASE_STATUSES = [
  'DRAFT',
  'COLLECTING_INFORMATION',
  'DOCUMENT_PENDING',
  'AI_ANALYSIS',
  'NEEDS_MORE_INFO',
  'NEEDS_HUMAN_REVIEW',
  'READY_FOR_OFFICER',
  'OFFICER_REVIEW',
  'APPROVED',
  'REJECTED',
  'MOCK_PAYMENT_QUEUED',
  'MOCK_PAYMENT_COMPLETED',
] as const;

export type CaseStatus = (typeof CASE_STATUSES)[number];
export const caseStatusSchema = z.enum(CASE_STATUSES);

export const ANSWER_SOURCES = ['voice', 'text', 'document', 'officer', 'system'] as const;
export type AnswerSource = (typeof ANSWER_SOURCES)[number];
export const answerSourceSchema = z.enum(ANSWER_SOURCES);

export const DOCUMENT_TYPES = [
  'mock_identity_document',
  'mock_proof_of_income',
  'mock_residence_document',
  'mock_application_form',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];
export const documentTypeSchema = z.enum(DOCUMENT_TYPES);

export const APPLICATION_FIELD_SPECS = {
  full_name: {
    field: 'full_name',
    expected_type: 'string',
    required: true,
    needs_confirmation: true,
    minLength: 2,
    maxLength: 120,
  },
  mock_identity_reference: {
    field: 'mock_identity_reference',
    expected_type: 'string',
    required: true,
    needs_confirmation: true,
    minLength: 5,
    maxLength: 40,
  },
  district: {
    field: 'district',
    expected_type: 'string',
    required: true,
    needs_confirmation: false,
    minLength: 2,
    maxLength: 80,
  },
  household_size: {
    field: 'household_size',
    expected_type: 'number',
    required: true,
    needs_confirmation: true,
    min: 1,
    max: 30,
  },
  monthly_income: {
    field: 'monthly_income',
    expected_type: 'number',
    required: true,
    needs_confirmation: true,
    min: 0,
    max: 10_000_000,
  },
  employment_status: {
    field: 'employment_status',
    expected_type: 'string',
    required: true,
    needs_confirmation: false,
    minLength: 2,
    maxLength: 60,
  },
  relief_reason: {
    field: 'relief_reason',
    expected_type: 'string',
    required: true,
    needs_confirmation: false,
    minLength: 3,
    maxLength: 500,
  },
  has_dependents: {
    field: 'has_dependents',
    expected_type: 'boolean',
    required: false,
    needs_confirmation: false,
  },
} as const;

export type ApplicationFieldName = keyof typeof APPLICATION_FIELD_SPECS;

export const APPLICATION_FIELD_NAMES = Object.keys(
  APPLICATION_FIELD_SPECS,
) as ApplicationFieldName[];

export const applicationFieldNameSchema = z.enum([
  'full_name',
  'mock_identity_reference',
  'district',
  'household_size',
  'monthly_income',
  'employment_status',
  'relief_reason',
  'has_dependents',
]);

// --- Eligibility Rule Engine Schemas ---
export const ruleOperatorSchema = z.enum(['eq', 'equals', 'neq', 'lt', 'lte', 'gt', 'gte', 'in']);
export type RuleOperator = z.infer<typeof ruleOperatorSchema>;

export const ruleConditionSchema = z.object({
  id: z.string().min(1).optional(),
  field: z.string().min(1).max(64),
  operator: ruleOperatorSchema,
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))]),
  description: z.string().max(240).optional(),
});
export type RuleCondition = z.infer<typeof ruleConditionSchema>;

export const ruleGroupSchema = z.object({
  combinator: z.enum(['AND', 'OR']).default('AND'),
  conditions: z.array(ruleConditionSchema).min(1),
});
export type RuleGroup = z.infer<typeof ruleGroupSchema>;

export const eligibilityRuleDefinitionSchema = z.object({
  scheme_id: z.string().min(1).max(64),
  combinator: z.enum(['AND', 'OR']).default('AND'),
  conditions: z.array(ruleConditionSchema).default([]),
  groups: z.array(ruleGroupSchema).optional(),
  required_fields: z.array(applicationFieldNameSchema).default([
    'full_name',
    'mock_identity_reference',
    'district',
    'household_size',
    'monthly_income',
    'employment_status',
    'relief_reason',
  ]),
  required_documents: z.array(documentTypeSchema).default([
    'mock_identity_document',
    'mock_proof_of_income',
  ]),
  scoring_weights: z
    .object({
      mock_identity_verification: z.number().min(0).max(100).default(30),
      document_readability: z.number().min(0).max(100).default(25),
      required_field_completeness: z.number().min(0).max(100).default(25),
      cross_field_consistency: z.number().min(0).max(100).default(20),
    })
    .default({
      mock_identity_verification: 30,
      document_readability: 25,
      required_field_completeness: 25,
      cross_field_consistency: 20,
    }),
  thresholds: z
    .object({
      officer_ready_min: z.number().min(0).max(100).default(90),
      needs_more_info_min: z.number().min(0).max(100).default(70),
    })
    .default({
      officer_ready_min: 90,
      needs_more_info_min: 70,
    }),
  default_mock_grant_pkr: z.number().positive().default(15000),
});

export type EligibilityRuleDefinition = z.infer<typeof eligibilityRuleDefinitionSchema>;

// --- API Request Schemas ---
export const createCaseSchema = z.object({
  scheme_id: z.string().min(1).max(64).default('MOCK_RELIEF_01'),
  preferred_language: languageCodeSchema.default('en'),
  idempotency_key: z.string().min(8).max(128),
  citizen_id: z.string().uuid().optional(),
  citizen_display_name: z.string().min(2).max(120).optional(),
  mock_identity_reference: z.string().min(5).max(40).optional(),
});

export const patchCaseAnswersSchema = z.object({
  expected_server_updated_at: z.string().datetime().optional(),
  current_step: z.string().min(1).max(64).optional(),
  preferred_language: languageCodeSchema.optional(),
  answers: z
    .array(
      z.object({
        field_name: applicationFieldNameSchema,
        field_value: z.union([z.string(), z.number(), z.boolean()]),
        source: answerSourceSchema.default('text'),
        confirmed_by_citizen: z.boolean().default(false),
        extraction_confidence: z.number().min(0).max(1).nullable().optional(),
      }),
    )
    .min(1),
});

export const structuredExtractionOutputSchema = z
  .object({
    field: applicationFieldNameSchema,
    value: z.union([z.string(), z.number(), z.boolean()]),
    needs_confirmation: z.boolean(),
    reason: z.string().min(1).max(400),
    confidence: z.number().min(0).max(1).optional(),
  })
  .strict();

export type StructuredExtractionOutput = z.infer<typeof structuredExtractionOutputSchema>;

export const extractFieldRequestSchema = z.object({
  active_field: applicationFieldNameSchema,
  language: languageCodeSchema,
  transcript: z.string().min(1).max(1500),
});

export const ragQuerySchema = z.object({
  question: z.string().min(2).max(1000),
  language: languageCodeSchema.default('en'),
  case_id: z.string().uuid().optional(),
});

export const officerDecisionSchema = z
  .object({
    decision: z.enum(['APPROVED', 'REJECTED']),
    decision_reason: z.string().max(2000).optional(),
    internal_notes: z.string().max(2000).default(''),
    citizen_message: z.string().min(3).max(1000),
  })
  .refine(
    (data) => (data.decision_reason?.trim().length ?? 0) >= 3 || data.internal_notes.trim().length >= 3,
    {
      message: 'A mandatory non-empty decision_reason (at least 3 characters) is required.',
      path: ['decision_reason'],
    },
  );

export const officerRequestInfoSchema = z.object({
  missing_items: z.array(z.string().min(2).max(120)).min(1),
  internal_notes: z.string().max(2000).default(''),
  citizen_message: z.string().min(3).max(1000),
});

export const grantConsentSchema = z.object({
  consent_type: z.enum(['processing', 'helper_delegation']).default('processing'),
  helper_id: z.string().uuid().nullable().optional(),
  case_id: z.string().uuid().nullable().optional(),
  permissions: z.array(z.string().min(1).max(64)).min(1),
  expires_at: z.string().datetime().nullable().optional(),
});

export const createMockPaymentSchema = z.object({
  case_id: z.string().uuid(),
  amount_pkr: z.number().positive().max(500_000).optional(),
});

export const createDepartmentAccountSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  display_name: z.string().min(2).max(120),
  role: z.enum(['officer', 'helper', 'admin']).default('officer'),
  department_id: z.string().uuid().nullable().optional(),
  preferred_language: languageCodeSchema.default('en'),
});

export const createAssistanceRequestSchema = z.object({
  citizen_question: z.string().min(2).max(1200),
  chatbot_draft_answer: z.string().max(4000).nullable().optional(),
  language: languageCodeSchema.default('en'),
  case_id: z.string().uuid().nullable().optional(),
  department_id: z.string().uuid().nullable().optional(),
});

export const respondAssistanceRequestSchema = z.object({
  humanized_reply: z.string().min(2).max(3000),
  save_as_guidance: z.boolean().default(false),
  guidance_question_pattern: z.string().min(2).max(300).optional(),
});

export const createHumanizedGuidanceSchema = z.object({
  service_id: z.string().min(1).max(64).default('MOCK_RELIEF_01'),
  language: languageCodeSchema.default('en'),
  question_pattern: z.string().min(2).max(300),
  humanized_answer: z.string().min(3).max(3000),
  department_id: z.string().uuid().nullable().optional(),
});
