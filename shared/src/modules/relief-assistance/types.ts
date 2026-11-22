import type { LanguageCode } from '../../saas/types';
import type {
  AnswerSource,
  ApplicationFieldName,
  CaseStatus,
  DocumentType,
  EligibilityRuleDefinition,
} from './schemas';

export interface CitizenRecord {
  id: string;
  organization_id: string;
  user_id: string | null;
  display_name: string;
  mock_identity_reference: string;
  created_at: string;
}

export interface CaseAnswerRecord {
  id: string;
  organization_id: string;
  case_id: string;
  field_name: ApplicationFieldName;
  field_value: string | number | boolean;
  source: AnswerSource;
  confirmed_by_citizen: boolean;
  extraction_confidence: number | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentConflict {
  field_name: string;
  application_value: unknown;
  document_value: unknown;
  severity: 'warning' | 'hard_review';
  message: string;
}

export interface DocumentRecord {
  id: string;
  organization_id: string;
  case_id: string;
  document_type: DocumentType;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  processing_status: 'UPLOADED' | 'PROCESSING' | 'EXTRACTED' | 'NEEDS_REVIEW' | 'FAILED';
  extraction_result: Record<string, unknown> | null;
  conflicts: DocumentConflict[];
  review_status: 'PENDING' | 'VERIFIED' | 'FLAGGED' | 'REJECTED';
  created_at: string;
}

export interface EligibilityEvaluationResult {
  rule_id: string;
  rule_version_id: string;
  rule_version: number;
  evaluation_status: 'officer_ready' | 'needs_more_info' | 'requires_officer_review';
  recommended_next_status: 'READY_FOR_OFFICER' | 'NEEDS_MORE_INFO' | 'NEEDS_HUMAN_REVIEW';
  evidence_score: number;
  score_breakdown: {
    mock_identity_verification: number;
    document_readability: number;
    required_field_completeness: number;
    cross_field_consistency: number;
  };
  hard_safety_flags: string[];
  matched_conditions: Array<{ field: string; operator: string; expected: unknown; actual: unknown }>;
  unmatched_conditions: Array<{ field: string; operator: string; expected: unknown; actual: unknown }>;
  missing_fields: string[];
  missing_documents: string[];
  explanation: string;
  evaluated_at: string;
}

export type ServiceDepartmentCode =
  | 'RELIEF_ASSISTANCE'
  | 'SCAM_CYBER_SAFETY'
  | 'GENERAL_INQUIRY'
  | 'SYSTEM_ONBOARDING';

export type DecisionTier =
  | 'ACT_ALONE_FAST_TRACK'
  | 'ASK_FOR_MORE_PROOF'
  | 'HUMAN_OFFICER_HANDOFF';

export interface DynamicRuleVersionRecord {
  id: string;
  organization_id: string;
  version: string;
  is_active: boolean;
  max_monthly_income_pkr: number;
  act_alone_max_amount_pkr: number;
  ask_proof_max_amount_pkr: number;
  min_confidence_act_alone: number;
  min_confidence_ask_proof: number;
  false_approval_cost_pkr: number;
  false_delay_cost_pkr: number;
  wrongful_rejection_cost_pkr: number;
  change_reason: string;
  updated_by: string;
  created_at: string;
}

export interface StructuredUncertaintyCaseNotes {
  confidence_score: number;
  uncertainty_reasons: string[];
  conflicting_or_missing_fields: string[];
  recommended_human_checks: string[];
}

export interface CostTierEvaluationResult {
  decision_tier: DecisionTier;
  rule_version_used: string;
  rule_snapshot: DynamicRuleVersionRecord;
  confidence_score: number;
  is_uncertain: boolean;
  citizen_simple_reason: string;
  required_proof_items: string[];
  cost_rationale: {
    false_approval_cost_pkr: number;
    false_delay_cost_pkr: number;
    wrongful_rejection_cost_pkr: number;
    cost_ratio_false_approval_vs_delay: number;
  };
  case_notes: StructuredUncertaintyCaseNotes | null;
  model_version: string;
}

export type EntityResolutionClassification =
  | 'NO_MATCH'
  | 'EXACT_DUPLICATE_PERSON'
  | 'DISTINCT_PERSON_HOMONYM'
  | 'POSSIBLE_DUPLICATE_NEEDS_HUMAN';

export interface EntityResolutionResult {
  classification: EntityResolutionClassification;
  match_confidence: number;
  normalized_input_name: string;
  phonetic_key: string;
  matched_citizen_id: string | null;
  matched_display_name: string | null;
  matched_cnic: string | null;
  similarity_score: number;
  should_block_submission: boolean;
  requires_human_review: boolean;
  explanation: string;
  side_by_side_comparison?: {
    incoming: { name: string; cnic: string | null; phone: string | null; district: string | null };
    existing: { name: string; cnic: string | null; phone: string | null; district: string | null };
  } | null;
}

export interface CitizenConsentScopes {
  share_with_relief_officer: boolean;
  allow_ai_voice_processing: boolean;
  allow_document_verification: boolean;
}

export interface ConsentRecipientEntry {
  recipient_id: string;
  name: string;
  department: string;
  purpose: string;
  scope_key: keyof CitizenConsentScopes;
  access_active: boolean;
}

export interface CitizenGranularConsentRecord {
  id: string;
  organization_id: string;
  citizen_id: string;
  user_id: string;
  status: 'GRANTED' | 'WITHDRAWN';
  scopes: CitizenConsentScopes;
  who_has_access: ConsentRecipientEntry[];
  updated_at: string;
  created_at: string;
}

export type DocumentAuthenticityOutcome =
  | 'VERIFIED_AUTHENTIC'
  | 'POSSIBLE_FALSE_ALARM_LOW_QUALITY'
  | 'LIKELY_FORGED_NEEDS_REVIEW';

export interface DocumentAuthenticityAnalysis {
  id: string;
  organization_id: string;
  citizen_id: string | null;
  user_id: string | null;
  doc_type: string;
  file_name: string;
  outcome: DocumentAuthenticityOutcome;
  forgery_score: number;
  false_alarm_risk: 'LOW' | 'MEDIUM' | 'HIGH';
  image_quality_score: number;
  tamper_indicators: string[];
  quality_issues: string[];
  cross_field_mismatches: string[];
  extracted_fields: Record<string, string>;
  citizen_message: string;
  false_alarm_disclaimer: string;
  non_blocking_options: Array<'RETAKE_CLEARER_PHOTO' | 'SEND_TO_HUMAN_OFFICER'>;
  department_id: ServiceDepartmentCode;
  created_at: string;
}

export interface DocumentAuthenticityMetrics {
  total_scanned: number;
  verified_authentic: number;
  likely_forged_flagged: number;
  possible_false_alarms_protected: number;
  recent_scans: DocumentAuthenticityAnalysis[];
}

export interface CaseRecord {
  id: string;
  organization_id: string;
  citizen_id: string;
  department_id: string | null;
  assigned_department?: ServiceDepartmentCode | null;
  scheme_id: string;
  status: CaseStatus;
  preferred_language: LanguageCode;
  current_step: string;
  rule_version_id: string | null;
  rule_version_used?: string | null;
  rule_snapshot_json?: DynamicRuleVersionRecord | null;
  decision_tier?: DecisionTier | null;
  confidence_score?: number | null;
  case_notes?: StructuredUncertaintyCaseNotes | null;
  citizen_simple_reason?: string | null;
  duplicate_check_result?: EntityResolutionResult | null;
  model_version?: string | null;
  access_blocked?: boolean;
  access_blocked_reason?: string | null;
  assigned_officer_id: string | null;
  decided_by_officer_id?: string | null;
  decided_by_officer_name?: string | null;
  decision_reason?: string | null;
  decided_at?: string | null;
  idempotency_key: string;
  analysis_result: EligibilityEvaluationResult | null;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
}

export interface RuleVersionRecord {
  id: string;
  organization_id: string;
  rule_id: string;
  scheme_id: string;
  version_number: number;
  rules_json: EligibilityRuleDefinition;
  published_by: string;
  published_at: string;
}

export interface EligibilityRuleRecord {
  id: string;
  organization_id: string;
  scheme_id: string;
  active_version_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PolicyRecord {
  id: string;
  organization_id: string;
  title: string;
  document_type: string;
  version: string;
  effective_date: string;
  language: LanguageCode;
  source_reference: string;
  storage_path: string;
  content: string;
  content_hash: string;
  created_at: string;
}

export interface PolicyChunkRecord {
  id: string;
  organization_id: string;
  policy_id: string;
  chunk_text: string;
  embedding: number[] | null;
  metadata: {
    title: string;
    version: string;
    section: string;
    source_reference: string;
    language: LanguageCode;
  };
  created_at: string;
}

export interface ConsentRecord {
  id: string;
  organization_id: string;
  citizen_id: string;
  helper_id: string | null;
  case_id: string | null;
  consent_type: 'processing' | 'helper_delegation';
  permissions: string[];
  granted_at: string;
  expires_at: string | null;
  withdrawn_at: string | null;
}

export interface AiRunRecord {
  id: string;
  organization_id: string;
  case_id: string | null;
  model_provider: string;
  model_name: string;
  operation: string;
  input_reference: string;
  output: Record<string, unknown>;
  confidence: number | null;
  explanation: string | null;
  created_at: string;
}

export interface CaseReviewRecord {
  id: string;
  organization_id: string;
  case_id: string;
  officer_id: string;
  officer_display_name?: string | null;
  decision: 'APPROVED' | 'REJECTED' | 'REQUEST_INFO' | 'NOTE';
  decision_reason?: string | null;
  internal_notes: string;
  citizen_message: string;
  rule_version_id: string | null;
  created_at: string;
}

export interface MockIdentityRecord {
  id: string;
  organization_id: string;
  mock_identity_reference: string;
  full_name: string;
  district: string;
  verified: boolean;
  created_at: string;
}

export interface MockPaymentRecord {
  id: string;
  organization_id: string;
  case_id: string;
  initiated_by: string;
  amount_pkr: number;
  status: 'MOCK_PAYMENT_QUEUED' | 'MOCK_PAYMENT_COMPLETED' | 'MOCK_PAYMENT_FAILED';
  reference_code: string;
  created_at: string;
  completed_at: string | null;
}

export interface AssistanceRequestRecord {
  id: string;
  organization_id: string;
  department_id: string | null;
  citizen_user_id: string;
  citizen_display_name?: string;
  case_id: string | null;
  language: LanguageCode;
  citizen_question: string;
  chatbot_draft_answer: string | null;
  status: 'OPEN' | 'ANSWERED';
  responder_user_id: string | null;
  responder_display_name?: string | null;
  humanized_reply: string | null;
  saved_as_guidance: boolean;
  created_at: string;
  answered_at: string | null;
}

export interface HumanizedGuidanceRecord {
  id: string;
  organization_id: string;
  department_id: string | null;
  service_id: string;
  language: LanguageCode;
  question_pattern: string;
  humanized_answer: string;
  created_by: string;
  created_at: string;
}

export type AgentWorkflowStage =
  | 'HOME_WELCOME'
  | 'LANGUAGE_SELECT'
  | 'ROLE_IDENTIFICATION'
  | 'CITIZEN_ACCOUNT_CHECK'
  | 'AUTH_GATE'
  | 'AGENT_HUB'
  | 'RELIEF_FORM'
  | 'ESCALATION_CONFIRM';

export type AgentTaskType =
  | 'idle'
  | 'language_select'
  | 'role_routing'
  | 'auth_signup'
  | 'auth_login'
  | 'relief_form'
  | 'scam_check'
  | 'policy_rag'
  | 'claim_status'
  | 'officer_inquiry'
  | 'escalation';

export interface SuspendedTaskEntry {
  task_type: AgentTaskType;
  suspended_at: string;
  reason: string;
  draft_snapshot: Record<string, unknown>;
  next_missing_field: string | null;
}

export interface AgentAuthDraft {
  mode: 'undecided' | 'signup' | 'login';
  full_name: string;
  cnic: string;
  phone: string;
  pin: string;
  identifier: string;
  target_role?: 'citizen' | 'admin' | 'officer' | 'helper';
  wants_account_question_asked?: boolean;
  declined_signup?: boolean;
  field_fill_history?: string[];
  editing_field?: string | null;
}

export interface PendingEscalationDraft {
  assigned_admin: string;
  reason_out_of_scope: string;
  user_request_text: string;
  category: 'claim_dispute' | 'force_approve' | 'bank_transfer' | 'nadra_change' | 'human_agent';
}

export interface ConversationWindowTurn {
  turn_index: number;
  role: 'user' | 'agent';
  text: string;
  language: LanguageCode;
  timestamp: string;
  fields_touched: string[];
  action_taken: string;
}

export interface FieldProvenanceEntry {
  field_key: string;
  current_value: string | number | boolean;
  raw_user_utterance: string;
  turn_index: number;
  status: 'filled' | 'corrected' | 'pre_filled' | 'validated';
}

export type NluPrimaryIntent =
  | 'PROVIDE_FIELD'
  | 'ROLLBACK_LAST_FIELD'
  | 'EDIT_SPECIFIC_FIELD'
  | 'INLINE_CORRECTION'
  | 'SWITCH_TASK'
  | 'CONFIRM_SUBMIT'
  | 'ASK_STATUS'
  | 'ASK_OFFICER'
  | 'CHECK_OFFICER_REPLY'
  | 'SCAM_CHECK'
  | 'POLICY_RAG'
  | 'OUT_OF_SCOPE'
  | 'GENERAL_CHAT';

export interface AgentNluRagMemoryRecord {
  id: string;
  organization_id: string | null;
  source: 'SEED_EXEMPLAR' | 'LEARNED_FROM_CORRECTION' | 'LEARNED_FROM_CONFIRMATION';
  raw_utterance: string;
  resolved_intent: NluPrimaryIntent;
  target_field: string | null;
  clean_value: string | number | boolean | null;
  language: LanguageCode;
  hit_count: number;
  embedding?: number[] | null;
  created_at: string;
  updated_at: string;
}

export interface RetrievedNluRagMatch {
  id: string;
  source: AgentNluRagMemoryRecord['source'];
  raw_utterance: string;
  resolved_intent: NluPrimaryIntent;
  target_field: string | null;
  clean_value: string | number | boolean | null;
  language: LanguageCode;
  similarity: number;
  hit_count: number;
}

export type UniversalRagCollection =
  | 'policy_and_services_kb'
  | 'scam_and_fraud_kb'
  | 'multilingual_nlu_slang_kb'
  | 'episodic_conversation_kb'
  | 'self_learning_corrections_kb';

export interface UniversalRagDocumentRecord {
  id: string;
  organization_id: string | null;
  collection: UniversalRagCollection;
  title: string;
  content: string;
  language: LanguageCode;
  session_id?: string | null;
  citizen_id?: string | null;
  metadata: Record<string, unknown>;
  hit_count: number;
  embedding?: number[] | null;
  created_at: string;
  updated_at: string;
}

export interface RetrievedUniversalRagChunk {
  id: string;
  collection: UniversalRagCollection;
  title: string;
  snippet: string;
  score: number;
  language: LanguageCode;
  metadata?: Record<string, unknown>;
}

export type LanguageGuardStatus = 'PASSED' | 'REWRITTEN_TO_LOCKED_LANG' | 'EXPLICIT_SWITCH_APPLIED';

export interface AgentMemorySessionRecord {
  session_id: string;
  organization_id: string;
  citizen_id: string | null;
  user_id: string | null;
  workflow_stage: AgentWorkflowStage;
  detected_language: LanguageCode;
  locked_language?: LanguageCode;
  language_locked: boolean;
  language_switch_history?: Array<{
    from: LanguageCode;
    to: LanguageCode;
    reason: string;
    timestamp: string;
  }>;
  active_task: AgentTaskType;
  suspended_tasks: SuspendedTaskEntry[];
  auth_draft: AgentAuthDraft;
  form_draft: Record<string, unknown>;
  field_fill_history?: string[];
  editing_field?: string | null;
  conversation_window?: ConversationWindowTurn[];
  context_summary?: string;
  field_provenance?: Record<string, FieldProvenanceEntry>;
  turn_counter?: number;
  pending_escalation: PendingEscalationDraft | null;
  looked_up_identifier: string | null;
  conversation_history: Array<{ role: 'user' | 'agent'; text: string; timestamp: string }>;
  created_at: string;
  updated_at: string;
}

export interface AgentValidationError {
  field: string;
  message: string;
  received: string;
}

export interface AgentReasoningAuditLogRecord {
  id: string;
  organization_id: string;
  department_id?: ServiceDepartmentCode;
  related_application_id?: string | null;
  timestamp: string;
  session_id: string;
  citizen_id: string | null;
  user_id: string | null;
  workflow_stage: AgentWorkflowStage;
  detected_language: LanguageCode;
  user_input: string;
  intent_detected: string;
  mood_or_context_switch: string;
  access_control_decision: {
    decision: 'ALLOWED' | 'DENIED';
    actor_role: string;
    authenticated: boolean;
    rule_reason: string;
  };
  capability_check: 'IN_SCOPE' | 'OUT_OF_SCOPE_ESCALATED';
  reasoning_steps: string[];
  self_reflection_check: {
    passed: boolean;
    self_corrected: boolean;
    notes: string;
  };
  memory_snapshot_diff: {
    action: 'NONE' | 'SAVED' | 'SUSPEND_TASK' | 'RESUME_TASK' | 'CLEARED';
    active_task: AgentTaskType;
    suspended_count: number;
    summary: string;
  };
  mcp_tools_invoked: Array<{
    tool_name: string;
    arguments: Record<string, unknown>;
    result_summary: string;
    status: 'success' | 'error';
    duration_ms: number;
  }>;
  validation_errors: AgentValidationError[];
  rag_memories_retrieved?: RetrievedNluRagMatch[];
  learned_memory_saved?: {
    id: string;
    raw_utterance: string;
    resolved_intent: NluPrimaryIntent;
    target_field: string | null;
    clean_value: string | number | boolean | null;
  } | null;
  semantic_nlu_summary?: {
    parser_mode: 'llm_rag' | 'hybrid_rag_fallback';
    primary_intent: NluPrimaryIntent;
    target_field: string | null;
    is_user_dissatisfied: boolean;
    extracted_clean_values: Record<string, unknown>;
    reasoning_summary: string;
  } | null;
  locked_language?: LanguageCode;
  language_guard_status?: LanguageGuardStatus;
  langgraph_nodes_visited?: string[];
  universal_rag_chunks?: RetrievedUniversalRagChunk[];
  mcp_protocol_info?: {
    transport: string;
    discovered_tools_count: number;
    sdk: string;
  };
  rule_version_used?: string | null;
  rule_snapshot_json?: DynamicRuleVersionRecord | null;
  model_version?: string | null;
  confidence_score?: number | null;
  decision_tier?: DecisionTier | null;
  duplicate_check_result?: EntityResolutionResult | null;
  consent_event_type?:
    | 'CONSENT_GRANTED'
    | 'CONSENT_SCOPE_UPDATED'
    | 'CONSENT_WITHDRAWN'
    | 'DATA_ACCESS_BLOCKED_CONSENT_WITHDRAWN'
    | null;
  final_agent_response: string;
}

export interface AgentEscalationRecord {
  id: string;
  ticket_reference: string;
  organization_id: string;
  citizen_id: string;
  user_id: string;
  citizen_display_name: string;
  citizen_cnic: string;
  session_id: string;
  assigned_admin: string;
  reason_out_of_scope: string;
  conversation_summary: string;
  reasoning_audit_log_id: string | null;
  status: 'OPEN' | 'IN_REVIEW' | 'RESOLVED';
  resolution_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface OfficerInquiryRecord {
  id: string;
  tracking_reference: string;
  organization_id: string;
  department_id?: ServiceDepartmentCode | null;
  citizen_id: string;
  user_id: string;
  citizen_name: string;
  application_ref: string | null;
  assigned_officer_id: string | null;
  assigned_officer_name: string;
  question_text: string;
  language: LanguageCode;
  status: 'OPEN' | 'ANSWERED';
  officer_reply: string | null;
  created_at: string;
  replied_at: string | null;
}

export interface CitizenApplicationStatusSummary {
  case_id: string;
  reference_number: string;
  status: CaseStatus;
  requested_amount: number | null;
  decision_band: string | null;
  decision_tier?: DecisionTier | null;
  rule_version_used?: string | null;
  citizen_simple_reason?: string | null;
  evidence_score: number | null;
  submitted_at: string | null;
  officer_notes: string | null;
  payment_reference: string | null;
  payment_amount_pkr: number | null;
}
