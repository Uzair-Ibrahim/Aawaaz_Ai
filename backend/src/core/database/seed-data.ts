import type { EligibilityRuleDefinition, LanguageCode } from '@awaaz/shared';

export const DEFAULT_ORG_IDS = {
  RELIEF_DEMO: '11111111-1111-4111-8111-111111111111',
  PROVINCE_BETA: '22222222-2222-4222-8222-222222222222',
} as const;

export const DEFAULT_DEPARTMENT_IDS = {
  RELIEF_ASSISTANCE: '33333333-1111-4111-8111-111111111111',
  SCAM_CYBER_SAFETY: '33333333-3333-4333-8333-333333333333',
  PROV_RELIEF: '33333333-2222-4222-8222-222222222222',
} as const;

export const DEFAULT_USER_IDS = {
  CITIZEN_A: 'aaaa1111-1111-4111-8111-111111111111',
  HELPER_A: 'aaaa2222-1111-4111-8111-111111111111',
  OFFICER_A: 'aaaa3333-1111-4111-8111-111111111111',
  ADMIN_A: 'aaaa4444-1111-4111-8111-111111111111',
  CITIZEN_B: 'bbbb1111-2222-4222-8222-222222222222',
  OFFICER_B: 'bbbb3333-2222-4222-8222-222222222222',
} as const;

export const DEFAULT_RULE_DEFINITION: EligibilityRuleDefinition = {
  scheme_id: 'MOCK_RELIEF_01',
  combinator: 'AND',
  conditions: [
    {
      id: 'cond_income_cap',
      field: 'monthly_income',
      operator: 'lte',
      value: 25000,
      description: 'Synthetic prototype rule: household monthly income must be <= 25,000 PKR.',
    },
    {
      id: 'cond_household_size',
      field: 'household_size',
      operator: 'gte',
      value: 1,
      description: 'Household size must be at least 1.',
    },
  ],
  required_fields: [
    'full_name',
    'mock_identity_reference',
    'district',
    'household_size',
    'monthly_income',
    'employment_status',
    'relief_reason',
  ],
  required_documents: ['mock_identity_document', 'mock_proof_of_income'],
  scoring_weights: {
    mock_identity_verification: 30,
    document_readability: 25,
    required_field_completeness: 25,
    cross_field_consistency: 20,
  },
  thresholds: {
    officer_ready_min: 90,
    needs_more_info_min: 70,
  },
  default_mock_grant_pkr: 15000,
};

export interface SeedPolicyTemplate {
  title: string;
  document_type: string;
  version: string;
  effective_date: string;
  language: LanguageCode;
  source_reference: string;
  content: string;
}

export const SYNTHETIC_POLICIES: SeedPolicyTemplate[] = [
  {
    title: 'Mock Relief Scheme Eligibility Criteria (Synthetic)',
    document_type: 'eligibility_criteria',
    version: '1.0',
    effective_date: '2026-01-01',
    language: 'en',
    source_reference: 'SYN-POL-ELIG-01',
    content: [
      'Section 1.1 Scheme Overview: MOCK_RELIEF_01 is a synthetic demonstration relief-assistance program created exclusively for the Awaaz prototype. It is not an official government scheme.',
      'Section 1.2 Income Threshold: Applicant households must report a monthly household income of 25,000 PKR or less under version 1 of the synthetic eligibility rules. Rules are configurable by an authorized workspace administrator and evaluated deterministically.',
      'Section 1.3 Identity & Residency: Applicants must supply a synthetic mock identity reference (for example, MOCK-ID-1001) and district of residence. Real national identity numbers must never be uploaded.',
      'Section 1.4 Human Decision Guarantee: AI tools may assist with extraction and completeness checks, but an authorized human Department Officer must review and make every final approval or rejection decision.',
    ].join('\n\n'),
  },
  {
    title: 'Required Supporting Documents Guide (Synthetic)',
    document_type: 'required_documents',
    version: '1.0',
    effective_date: '2026-01-01',
    language: 'en',
    source_reference: 'SYN-POL-DOCS-02',
    content: [
      'Section 2.1 Mandatory Synthetic Documents: Every MOCK_RELIEF_01 application requires two synthetic supporting files: (1) a mock_identity_document and (2) a mock_proof_of_income document.',
      'Section 2.2 Optional Documents: Applicants may optionally upload a mock_residence_document or mock_application_form to strengthen evidence completeness.',
      'Section 2.3 Low OCR Confidence Policy: Low document readability or extraction uncertainty must never result in an automatic rejection. Unclear documents are flagged for human officer review.',
      'Section 2.4 Privacy & Storage: All uploaded files are stored in tenant-scoped private storage and accessed only through short-lived signed URLs by authorized users.',
    ].join('\n\n'),
  },
  {
    title: 'Application Submission & Consent Procedure (Synthetic)',
    document_type: 'application_procedure',
    version: '1.0',
    effective_date: '2026-01-01',
    language: 'en',
    source_reference: 'SYN-POL-APP-03',
    content: [
      'Section 3.1 Consent First: Before submitting an application, the citizen must review what data is collected, which AI providers process it, who may view it, and how consent can be withdrawn.',
      'Section 3.2 Guided Collection & Confirmation: Critical fields such as full_name, mock_identity_reference, household_size, and monthly_income must be explicitly confirmed by the citizen before submission.',
      'Section 3.3 Community Helper Delegation: A citizen may grant time-bound consent to a Community Helper within the same workspace. A helper can never grant consent on behalf of a citizen, and consent withdrawal revokes helper access immediately on the server.',
      'Section 3.4 Offline Drafts: Drafts may be saved offline in the browser using IndexedDB and synced using idempotency keys once internet connectivity returns. AI processing requires an active internet connection.',
    ].join('\n\n'),
  },
  {
    title: 'Officer Review & Evidence Scoring Procedure (Synthetic)',
    document_type: 'review_procedure',
    version: '1.0',
    effective_date: '2026-01-01',
    language: 'en',
    source_reference: 'SYN-POL-REV-04',
    content: [
      'Section 4.1 Evidence Completeness Score: Cases receive a transparent 0-100 evidence completeness score composed of mock identity verification (30 points), document readability (25 points), required field completeness (25 points), and cross-field consistency (20 points).',
      'Section 4.2 Routing Thresholds: Scores 90-100 route to READY_FOR_OFFICER, scores 70-89 route to NEEDS_MORE_INFO, and scores below 70 route to NEEDS_HUMAN_REVIEW. Hard safety flags such as missing consent, duplicate mock identity references, or conflicting document values override the numeric score and force human review.',
      'Section 4.3 Officer Decisions: Officers can approve, reject, or request additional information. Internal officer review notes remain hidden from citizens. Only approved cases may enter MOCK_PAYMENT_QUEUED for synthetic payment simulation.',
    ].join('\n\n'),
  },
  {
    title: 'Appeal & Reconsideration Procedure (Synthetic)',
    document_type: 'appeal_procedure',
    version: '1.0',
    effective_date: '2026-01-01',
    language: 'en',
    source_reference: 'SYN-POL-APP-05',
    content: [
      'Section 5.1 Requesting Reconsideration: If a citizen disagrees with a rejection or needs clarification on missing documents, they may contact a workspace Department Officer or authorized Community Helper within 30 days using their case ID.',
      'Section 5.2 Rule Version Preservation: Every evaluated case retains the exact rule_version_id used at evaluation time. Later rule updates never rewrite historical decisions.',
      'Section 5.3 Auditability: All decisions, rule publications, consent changes, and AI runs are recorded in an append-only audit trail visible to authorized workspace Super Admins.',
    ].join('\n\n'),
  },
];

export const SYNTHETIC_MOCK_IDENTITIES = [
  { mock_identity_reference: 'MOCK-ID-1001', full_name: 'Amina Bibi', district: 'Multan', verified: true },
  { mock_identity_reference: 'MOCK-ID-1002', full_name: 'Tariq Mehmood', district: 'Peshawar', verified: true },
  { mock_identity_reference: 'MOCK-ID-1003', full_name: 'Sajida Parveen', district: 'Sukkur', verified: true },
  { mock_identity_reference: 'MOCK-ID-1004', full_name: 'Gul Khan', district: 'Quetta', verified: true },
  { mock_identity_reference: 'MOCK-ID-2001', full_name: 'Zainab Noor', district: 'Lahore', verified: true },
];
