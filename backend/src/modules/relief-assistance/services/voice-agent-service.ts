import crypto from 'node:crypto';
import {
  type AgentAuthDraft,
  type AgentMemorySessionRecord,
  type AgentReasoningAuditLogRecord,
  type AgentTaskType,
  type AgentValidationError,
  type AgentWorkflowStage,
  type AuthSessionUser,
  type CitizenApplicationStatusSummary,
  type ConversationWindowTurn,
  type DecisionTier,
  type DynamicRuleVersionRecord,
  type EntityResolutionResult,
  type FieldProvenanceEntry,
  type LanguageCode,
  type LanguageGuardStatus,
  type OfficerInquiryRecord,
  type PendingEscalationDraft,
  type RetrievedNluRagMatch,
  type RetrievedUniversalRagChunk,
  type ServiceDepartmentCode,
  type StructuredUncertaintyCaseNotes,
  type SuspendedTaskEntry,
} from '@awaaz/shared';
import { AmaanatMcpClient } from '../../../mcp/client';
import type { AmaanatMcpServer, McpToolCallRecord } from '../../../mcp/mcp-tools';
import type { AuthContext } from '../../../core/auth/auth-service';
import { toAsciiDigits } from '../../../core/auth/auth-service';
import { DEFAULT_ORG_IDS } from '../../../core/database/seed-data';
import type { DataStore } from '../../../core/database/types';
import type { AppEnv } from '../../../config/env';
import type { AIProvider } from '../../../integrations/ai/provider';
import type { VoiceProvider } from '../../../integrations/voice/provider';
import {
  AwaazLangGraphAgent,
  type PlannedMcpToolCall,
  type PlannerTurnOutcome,
  type ToolExecutionOutcome,
} from '../agent/langgraph-agent';
import {
  NluRagService,
  type SemanticTurnNluResult,
  cleanColloquialDistrict,
  cleanColloquialFullName,
  cleanColloquialReason,
  parseColloquialPakistaniNumber,
} from './nlu-rag-service';
import { UniversalRagService } from './universal-rag-service';
import type { ConsentEnforcementService } from './consent-enforcement-service';
import type { DocumentForgeryService } from './document-forgery-service';
import type { EntityResolutionService } from './entity-resolution-service';
import type { DynamicRuleEngineService } from './rule-engine-service';

export type VoiceUiAction =
  | 'STAY_HOME'
  | 'NAVIGATE_AUTH'
  | 'NAVIGATE_LOGIN'
  | 'NAVIGATE_SIGNUP'
  | 'NAVIGATE_HUB'
  | 'NAVIGATE_CITIZEN_HUB'
  | 'NAVIGATE_OFFICER_PORTAL'
  | 'NAVIGATE_ADMIN_PORTAL'
  | 'NAVIGATE_HELPER_PORTAL'
  | 'UPDATE_FORM'
  | 'ASK_CONFIRMATION'
  | 'SHOW_RECEIPT'
  | 'SHOW_APPLICATION_STATUS'
  | 'SHOW_OFFICER_INQUIRY'
  | 'SHOW_SCAM_ALERT'
  | 'SHOW_POLICY_ANSWER'
  | 'OFFER_ESCALATION'
  | 'SHOW_ESCALATION_TICKET'
  | 'PAUSE_VOICE_AGENT';

export type VoiceNavigateTarget = '/' | '/login' | '/signup' | '/citizen' | '/officer' | '/admin' | '/helper' | null;

export interface VoiceSessionFormState {
  name: string;
  cnic: string;
  district: string;
  household_size: number | null;
  monthly_income: number | null;
  employment_status: string;
  amount: number | null;
  reason: string;
  category: string;
  consent_confirmed: boolean;
  missing_fields: string[];
  ready_to_submit: boolean;
  submitted_case_id: string | null;
  reference_number: string | null;
  claim_status: string | null;
  rule_version_used?: string | null;
  decision_tier?: DecisionTier | null;
  confidence_score?: number | null;
  citizen_simple_reason?: string | null;
  case_notes?: StructuredUncertaintyCaseNotes | null;
}

export interface VoiceSessionTurnResult {
  session_id: string;
  audit_log_id: string;
  workflow_stage: AgentWorkflowStage;
  active_task: AgentTaskType;
  suspended_tasks: SuspendedTaskEntry[];
  memory_action: 'NONE' | 'SAVED' | 'SUSPEND_TASK' | 'RESUME_TASK' | 'CLEARED';
  detected_language: LanguageCode;
  transcript: string;
  agent_reply_text: string;
  agent_reply_audio: string | null;
  agent_reply_audio_mime: string | null;
  form_state: VoiceSessionFormState;
  auth_draft: AgentAuthDraft;
  field_fill_history: string[];
  editing_field: string | null;
  validation_errors: AgentValidationError[];
  access_control_decision: AgentReasoningAuditLogRecord['access_control_decision'];
  capability_check: 'IN_SCOPE' | 'OUT_OF_SCOPE_ESCALATED';
  reasoning_steps: string[];
  self_reflection_check: AgentReasoningAuditLogRecord['self_reflection_check'];
  mcp_tools_called: McpToolCallRecord[];
  ui_action: VoiceUiAction;
  navigate_to?: VoiceNavigateTarget;
  session_ended: boolean;
  auth_session?: {
    access_token: string;
    user: AuthSessionUser;
    citizen?: { id: string; display_name: string; mock_identity_reference: string } | null;
  };
  escalation?: {
    escalation_id?: string;
    ticket_reference?: string;
    assigned_admin: string;
    reason_out_of_scope: string;
    status: 'PENDING_CONFIRMATION' | 'OPEN';
  };
  applications_status?: CitizenApplicationStatusSummary[];
  officer_inquiries?: OfficerInquiryRecord[];
  officer_inquiry_created?: OfficerInquiryRecord | null;
  scam_alert?: unknown;
  policy_answer?: unknown;
  rag_memories_retrieved?: RetrievedNluRagMatch[];
  learned_memory_saved?: AgentReasoningAuditLogRecord['learned_memory_saved'];
  semantic_nlu_summary?: AgentReasoningAuditLogRecord['semantic_nlu_summary'];
  locked_language: LanguageCode;
  language_guard_status: LanguageGuardStatus;
  langgraph_nodes_visited: string[];
  universal_rag_chunks?: RetrievedUniversalRagChunk[];
  mcp_protocol_info?: {
    transport: string;
    discovered_tools_count: number;
    sdk: string;
  };
}

function emptyFormState(): VoiceSessionFormState {
  return {
    name: '',
    cnic: '',
    district: '',
    household_size: 5,
    monthly_income: null,
    employment_status: 'daily_wage',
    amount: null,
    reason: '',
    category: 'flood_relief',
    consent_confirmed: false,
    missing_fields: ['name', 'cnic', 'district', 'monthly_income', 'amount', 'reason', 'consent_confirmed'],
    ready_to_submit: false,
    submitted_case_id: null,
    reference_number: null,
    claim_status: null,
  };
}

function emptyAuthDraft(): AgentAuthDraft {
  return {
    mode: 'undecided',
    full_name: '',
    cnic: '',
    phone: '',
    pin: '',
    identifier: '',
    target_role: undefined,
    wants_account_question_asked: false,
    declined_signup: false,
    field_fill_history: [],
    editing_field: null,
  };
}

export function computeMissingFields(state: VoiceSessionFormState): string[] {
  const missing: string[] = [];
  if (!state.name.trim()) missing.push('name');
  if (!state.cnic.trim()) missing.push('cnic');
  if (!state.district.trim()) missing.push('district');
  if (state.monthly_income === null || !Number.isFinite(state.monthly_income)) missing.push('monthly_income');
  if (state.amount === null || !Number.isFinite(state.amount)) missing.push('amount');
  if (!state.reason.trim()) missing.push('reason');
  if (!state.consent_confirmed) missing.push('consent_confirmed');
  return missing;
}

export function computeFilledFields(state: VoiceSessionFormState): string[] {
  const filled: string[] = [];
  if (state.name.trim()) filled.push('name');
  if (state.cnic.trim()) filled.push('cnic');
  if (state.district.trim()) filled.push('district');
  if (state.monthly_income !== null && Number.isFinite(state.monthly_income)) filled.push('monthly_income');
  if (state.amount !== null && Number.isFinite(state.amount)) filled.push('amount');
  if (state.reason.trim()) filled.push('reason');
  if (state.consent_confirmed) filled.push('consent_confirmed');
  return filled;
}

export function computeMissingAuthSignupFields(draft: AgentAuthDraft): Array<'full_name' | 'cnic' | 'phone' | 'pin'> {
  const missing: Array<'full_name' | 'cnic' | 'phone' | 'pin'> = [];
  if (!draft.full_name.trim()) missing.push('full_name');
  if (!draft.cnic.trim()) missing.push('cnic');
  if (!draft.phone.trim()) missing.push('phone');
  if (!draft.pin.trim()) missing.push('pin');
  return missing;
}

const INVALID_PLACEHOLDERS = /^(waiting for|pending|null|undefined|none|n\/a|-|—|\.\.\.)$/i;

function isValidNonPlaceholderString(val: unknown, minLen = 2): val is string {
  return typeof val === 'string' && val.trim().length >= minLen && !INVALID_PLACEHOLDERS.test(val.trim());
}

// --- STRICT VALIDATORS ---

function normalizeSpokenDigitWords(raw: string): string {
  let text = toAsciiDigits(raw);
  const wordDigits: Array<[RegExp, string]> = [
    [/\b(zero|sifar|صفر)\b/gi, '0'],
    [/\b(one|ek|aik|ایک)\b/gi, '1'],
    [/\b(two|do|دو)\b/gi, '2'],
    [/\b(three|teen|تین)\b/gi, '3'],
    [/\b(four|char|chaar|چار)\b/gi, '4'],
    [/\b(five|panch|paanch|پانچ)\b/gi, '5'],
    [/\b(six|chay|cheh|چھ)\b/gi, '6'],
    [/\b(seven|saat|سات)\b/gi, '7'],
    [/\b(eight|aath|آٹھ)\b/gi, '8'],
    [/\b(nine|nau|نو)\b/gi, '9'],
  ];
  for (const [pat, d] of wordDigits) {
    text = text.replace(pat, d);
  }
  return text;
}

export function validateFullName(raw: string): { valid: boolean; value?: string; error?: string } {
  const trimmed = raw.trim();
  if (trimmed.length < 3 || trimmed.length > 80) {
    return { valid: false, error: 'Full name must be between 3 and 80 characters.' };
  }
  if (/\d/.test(toAsciiDigits(trimmed))) {
    return { valid: false, error: 'Full name cannot contain numbers.' };
  }
  if (!/^[A-Za-z\u0600-\u06FF\u0750-\u077F\u0A00-\u0A7F\s.'-]+$/.test(trimmed)) {
    return { valid: false, error: 'Full name must contain alphabetic characters only.' };
  }
  if (/^(yes|no|ok|haan|ji|signup|login|naya account|new account)$/i.test(trimmed)) {
    return { valid: false, error: 'Please provide your actual full name (at least 3 letters).' };
  }
  return { valid: true, value: trimmed };
}

export function validateStrictCnic13(raw: string): { valid: boolean; value?: string; digitCount: number; error?: string } {
  const normalized = normalizeSpokenDigitWords(raw);
  const digits = normalized.replace(/\D/g, '');
  if (digits.length !== 13) {
    return {
      valid: false,
      digitCount: digits.length,
      error: `CNIC must be exactly 13 digits (heard ${digits.length} digits). Required format: XXXXX-XXXXXXX-X.`,
    };
  }
  return {
    valid: true,
    digitCount: 13,
    value: `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`,
  };
}

export function validatePakistaniPhone(raw: string): { valid: boolean; value?: string; error?: string } {
  const normalized = normalizeSpokenDigitWords(raw);
  const cleaned = normalized.replace(/[\s\-().]/g, '');
  if (/^03\d{9}$/.test(cleaned)) {
    return { valid: true, value: `+92${cleaned.slice(1)}` };
  }
  if (/^\+923\d{9}$/.test(cleaned)) {
    return { valid: true, value: cleaned };
  }
  if (/^923\d{9}$/.test(cleaned)) {
    return { valid: true, value: `+${cleaned}` };
  }
  return {
    valid: false,
    error: 'Phone number must be a valid Pakistani mobile number (03XXXXXXXXX or +923XXXXXXXXX).',
  };
}

export function validatePin4(raw: string): { valid: boolean; value?: string; error?: string } {
  const normalized = normalizeSpokenDigitWords(raw);
  const digits = normalized.replace(/\D/g, '');
  if (digits.length !== 4) {
    return {
      valid: false,
      error: `PIN must be exactly 4 digits (heard ${digits.length} digits).`,
    };
  }
  return { valid: true, value: digits };
}

export function validateDistrict(raw: string): { valid: boolean; value?: string; error?: string } {
  const trimmed = raw.trim();
  if (trimmed.length < 2 || trimmed.length > 50 || /\d/.test(toAsciiDigits(trimmed))) {
    return { valid: false, error: 'District must be 2–50 alphabetic characters with no digits.' };
  }
  if (/\b(relief|imdad|darkhwast|apply|application|claim|form|help|madad|edit|change|karo|kar\s+do)\b/i.test(trimmed)) {
    return { valid: false, error: 'Please specify your district or city name (e.g., Dadu, Multan, Lahore).' };
  }
  return { valid: true, value: trimmed };
}

export function validateMonthlyIncome(val: number): { valid: boolean; value?: number; error?: string } {
  if (!Number.isFinite(val) || val < 0 || val > 500000) {
    return {
      valid: false,
      error: `Monthly income must be between 0 and 500,000 PKR (received ${val} PKR).`,
    };
  }
  return { valid: true, value: Math.round(val) };
}

export function validateRequestedAmount(val: number): { valid: boolean; value?: number; error?: string } {
  if (!Number.isFinite(val) || val < 500 || val > 100000) {
    return {
      valid: false,
      error: `Requested relief amount must be between 500 and 100,000 PKR (received ${val} PKR).`,
    };
  }
  return { valid: true, value: Math.round(val) };
}

export function validateReliefReason(raw: string): { valid: boolean; value?: string; error?: string } {
  const trimmed = raw.trim();
  const alphaOnly = trimmed.replace(/[\d\s.,!?؟۔-]+/g, '');
  if (trimmed.length < 5 || alphaOnly.length < 4) {
    return {
      valid: false,
      error: 'Relief reason must be at least 5 meaningful characters describing your situation.',
    };
  }
  return { valid: true, value: trimmed };
}

// --- PHASE 3: ROLLBACK & TARGETED FIELD EDITING DETECTION ---

function isRelativeRollbackRequest(transcript: string): boolean {
  const t = transcript.toLowerCase();
  return (
    /\b(peeche\s+jao|piche\s+jao|pichli\s+field|pichla\s+khana|pichla\s+sawal|go\s+back|previous\s+field|undo\s+last|undo\s+field|dobara\s+bharo|pichli\s+galat|pichli\s+ghalat)\b/i.test(
      t,
    ) || /(پیچھے جاؤ|پچھلی فیلڈ|پچھلا خانہ|پچھلا سوال|دوبارہ بھرو|واپس پچھلے)/.test(transcript)
  );
}

function detectExplicitFieldCorrection(transcript: string): Set<string> {
  const allowOverwrite = new Set<string>();
  const t = transcript.toLowerCase();
  const hasChangeVerb =
    /\b(change|update|correct|wrong|mistake|edit|replace|fix|karke|kar\s+do|ghalat|galat|badal|tabdeel|tabdeeli|غلط|بدل|تبدیل|تبدیلی|درست|ایڈٹ)\b/i.test(
      t,
    ) || /(غلط|بدل|تبدیل|درست|ترمیم)/.test(transcript);
  if (!hasChangeVerb) return allowOverwrite;

  if (/\b(name|naam|ناں|نام|نالو|نوم)\b/i.test(t) || /(نام|ناں|نالو|نوم)/.test(transcript)) {
    allowOverwrite.add('name');
    allowOverwrite.add('full_name');
  }
  if (/\b(cnic|id|card|شناختی|کارڈ|ڪارڊ)\b/i.test(t) || /(شناختی کارڈ|پېژندپاڼه)/.test(transcript)) {
    allowOverwrite.add('cnic');
  }
  if (/\b(phone|mobile|موبائل|فون)\b/i.test(t) || /(موبائل|فون نمبر)/.test(transcript)) {
    allowOverwrite.add('phone');
  }
  if (/\b(pin|پن|کوڈ)\b/i.test(t) || /(پن کوڈ)/.test(transcript)) {
    allowOverwrite.add('pin');
  }
  if (/\b(district|city|zila|shehar|ضلع|شہر|ضلعي|ولسوالۍ)\b/i.test(t) || /(ضلع|شہر|ضلعي|ولسوالۍ)/.test(transcript)) {
    allowOverwrite.add('district');
  }
  if (/\b(income|amdani|salary|آمدنی|آمدني|عاید)\b/i.test(t) || /(آمدنی|آمدني|عاید)/.test(transcript)) {
    allowOverwrite.add('monthly_income');
  }
  if (/\b(amount|raqam|grant|رقم|پیسے)\b/i.test(t) || /(مطلوبہ رقم|رقم|پیسے)/.test(transcript)) {
    allowOverwrite.add('amount');
  }
  if (/\b(reason|issue|problem|وجہ|مسئلہ|سبب)\b/i.test(t) || /(وجہ|سبب|لامل)/.test(transcript)) {
    allowOverwrite.add('reason');
  }
  return allowOverwrite;
}

function pushFillHistory(history: string[], field: string): void {
  if (!field || field === 'consent_confirmed') return;
  if (history[history.length - 1] !== field) {
    history.push(field);
  }
  if (history.length > 25) {
    history.splice(0, history.length - 25);
  }
}

export function monotonicMergeFormState(
  target: VoiceSessionFormState,
  patch: Partial<VoiceSessionFormState>,
  allowOverwrite: Set<string> = new Set(),
): string[] {
  const mutated: string[] = [];
  if (isValidNonPlaceholderString(patch.name, 2) && (!target.name.trim() || allowOverwrite.has('name'))) {
    if (target.name !== patch.name.trim()) mutated.push('name');
    target.name = patch.name.trim();
  }
  if (isValidNonPlaceholderString(patch.cnic, 3) && (!target.cnic.trim() || allowOverwrite.has('cnic'))) {
    const next = patch.cnic.trim().toUpperCase();
    if (target.cnic !== next) mutated.push('cnic');
    target.cnic = next;
  }
  if (isValidNonPlaceholderString(patch.district, 2) && (!target.district.trim() || allowOverwrite.has('district'))) {
    if (target.district !== patch.district.trim()) mutated.push('district');
    target.district = patch.district.trim();
  }
  if (
    typeof patch.monthly_income === 'number' &&
    Number.isFinite(patch.monthly_income) &&
    patch.monthly_income >= 0 &&
    patch.monthly_income <= 500000 &&
    (target.monthly_income === null || allowOverwrite.has('monthly_income'))
  ) {
    if (target.monthly_income !== patch.monthly_income) mutated.push('monthly_income');
    target.monthly_income = patch.monthly_income;
  }
  if (
    typeof patch.amount === 'number' &&
    Number.isFinite(patch.amount) &&
    patch.amount >= 500 &&
    patch.amount <= 100000 &&
    (target.amount === null || allowOverwrite.has('amount'))
  ) {
    if (target.amount !== patch.amount) mutated.push('amount');
    target.amount = patch.amount;
  }
  if (
    typeof patch.household_size === 'number' &&
    Number.isFinite(patch.household_size) &&
    patch.household_size >= 1 &&
    patch.household_size <= 30
  ) {
    target.household_size = patch.household_size;
  }
  if (isValidNonPlaceholderString(patch.reason, 5) && (!target.reason.trim() || allowOverwrite.has('reason'))) {
    if (target.reason !== patch.reason.trim()) mutated.push('reason');
    target.reason = patch.reason.trim();
  }
  if (isValidNonPlaceholderString(patch.category, 2)) {
    target.category = patch.category.trim();
  }
  if (patch.consent_confirmed === true) {
    target.consent_confirmed = true;
  }
  if (isValidNonPlaceholderString(patch.submitted_case_id, 4) && !target.submitted_case_id) {
    target.submitted_case_id = patch.submitted_case_id.trim();
  }
  if (isValidNonPlaceholderString(patch.reference_number, 4) && !target.reference_number) {
    target.reference_number = patch.reference_number.trim();
  }
  if (isValidNonPlaceholderString(patch.claim_status, 2) && !target.claim_status) {
    target.claim_status = patch.claim_status.trim();
  }
  return mutated;
}

// --- MIXED-LANGUAGE & CODE-SWITCHING CREDENTIAL PARSER ---

function extractMixedCredentials(transcript: string): { identifier?: string; secret?: string } {
  const normalized = toAsciiDigits(transcript)
    .replace(/\b(?:underscore|under\s+score)\b/gi, '_')
    .replace(/\s+_\s+/g, '_')
    .replace(/\b(?:at\s+the\s+rate|at\s+sign)\b/gi, '@')
    .replace(/\s+@\s+/g, '@')
    .trim();

  let identifier: string | undefined;
  let secret: string | undefined;

  // 1. Explicit password / PIN extraction (works in mixed Urdu + English!)
  const secretExplicit = normalized.match(
    /(?:password|passcode|pass|pin|پاسورڈ|پاس\s*ورڈ|پن|کوڈ)\s*(?:is|hai|he|ہے|:|=)?\s*([A-Za-z0-9!@#$%^&*_.-]{4,32})/i,
  );
  if (secretExplicit?.[1]) {
    secret = secretExplicit[1].replace(/[.,!?]+$/, '');
  }

  // 2. Explicit username / email / CNIC / phone extraction
  const userExplicit = normalized.match(
    /(?:username|user\s*name|user|id|email|login|یوزرنیم|نام|ای\s*میل)\s*(?:is|hai|he|ہے|:|=)?\s*([A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|[A-Za-z][A-Za-z0-9_.-]{2,40})/i,
  );
  if (userExplicit?.[1] && !/^(aur|and|hai|he|password|pin|mera|my)$/i.test(userExplicit[1])) {
    identifier = userExplicit[1].replace(/[.,!?]+$/, '');
  }

  // 3. Direct known username / email / CNIC / Pak mobile patterns anywhere in the sentence
  if (!identifier) {
    const directMatch =
      normalized.match(
        /\b((?:admin|officer|helper|citizen|auditor)_[a-z0-9_]+|[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}|\d{5}-\d{7}-\d|\d{13}|(?:\+92|92|0)3\d{9})\b/i,
      ) ??
      normalized.match(/\b((?:admin|officer|helper|citizen|auditor)\s+(?:ayesha|hamza|salma|zainab|bilal))\b/i);
    if (directMatch?.[1]) {
      identifier = directMatch[1].trim().replace(/\s+/g, '_');
    }
  }

  // 4. Fallback secret: known demo passwords or 4-digit PIN when identifier already present
  if (!secret) {
    const knownPass = normalized.match(/\b(officer123|admin123|helper123|citizen123|auditor123|DemoPass123!)\b/);
    if (knownPass?.[1]) {
      secret = knownPass[1];
    } else if (identifier) {
      // Check for a standalone 4-digit PIN (not part of CNIC/phone)
      const stripped = normalized
        .replace(identifier, ' ')
        .replace(/\b\d{5}-\d{7}-\d\b/g, ' ')
        .replace(/\b\d{13}\b/g, ' ')
        .replace(/(?:\+92|92|0)3\d{9}\b/g, ' ');
      const pinOnly = stripped.match(/\b(\d{4})\b/);
      if (pinOnly?.[1]) secret = pinOnly[1];
    }
  }

  return { identifier, secret };
}

export function detectLanguageFromText(text: string, fallback: LanguageCode = 'ur'): LanguageCode {
  const trimmed = text.trim();
  if (!trimmed) return fallback;

  // Explicit spoken language names
  if (/\b(urdu|اردو)\b/i.test(trimmed)) return 'ur';
  if (/\b(english|انگلش|انگریزی)\b/i.test(trimmed)) return 'en';
  if (/\b(sindhi|سنڌي|سندھی)\b/i.test(trimmed)) return 'sd';
  if (/\b(punjabi|پنجابی)\b/i.test(trimmed)) return 'pa';
  if (/\b(pashto|pushto|پښتو|پشتو)\b/i.test(trimmed)) return 'ps';
  if (/\b(balochi|بلوچی)\b/i.test(trimmed)) return 'bal';

  // 1. Pashto script & vocabulary
  if (
    /[ښځڅډټړڼږ]/.test(trimmed) ||
    /(?:^|[\s،,.۔؟!])(زما|نوم|دی|یم|غواړم|پېښور|مرسته|روپۍ|کورنۍ|ولسوالۍ)(?:$|[\s،,.۔؟!])/.test(trimmed)
  ) {
    return 'ps';
  }

  // 2. Sindhi script & vocabulary
  if (
    /[ٻڀٿٽڄڃڇڌڏڍڦڪڻ]/.test(trimmed) ||
    /(?:^|[\s،,.۔؟!])(منهنجو|نالو|آهي|آهيان|گهرجي|رپيا|سکر|ضلعي|رهان|ٻوڏ)(?:$|[\s،,.۔؟!])/.test(trimmed)
  ) {
    return 'sd';
  }

  // 3. Balochi markers
  if (/(?:^|[\s،,.۔؟!])(انت|کنت|وتئی|منی|وتی|لوٹ|ہئو)(?:$|[\s،,.۔؟!])|ءِ|ءَ/.test(trimmed)) {
    return 'bal';
  }

  // 4. Punjabi markers
  if (
    /[\u0A00-\u0A7F]/.test(trimmed) ||
    /(?:^|[\s،,.۔؟!])(نیں|تہاڈا|ناں|وچ|لئی|آں|اے|چاہیدی|چاہیدا|ضلعے|مہینے|تسی|رہندا)(?:$|[\s،,.۔؟!])|میرا ناں|جی آیاں/.test(
      trimmed,
    )
  ) {
    return 'pa';
  }

  // 5. Arabic/Urdu script -> preserve regional Arabic-script fallback unless explicit Urdu words are spoken
  if (/[\u0600-\u06FF]/.test(trimmed)) {
    if (
      ['sd', 'pa', 'ps', 'bal'].includes(fallback) &&
      !/(?:^|[\s،,.۔؟!])(میرا|ہے|ہوں|کیونکہ|مجھے|چاہیے|آمدنی)(?:$|[\s،,.۔؟!])/.test(trimmed)
    ) {
      return fallback;
    }
    return 'ur';
  }

  // 6. Roman script regional / Urdu keywords (including mixed code-switching!)
  if (/\b(tuhada|mera naa|chaida|pind|vich|asi|tusi)\b/i.test(trimmed)) return 'pa';
  if (/\b(muhinjo|nalo|ahe|ahiyan|tawhan|tokhe|ghurje)\b/i.test(trimmed)) return 'sd';
  if (/\b(zama|num|pakhtun|ghwaram|khe|taso)\b/i.test(trimmed)) return 'ps';
  if (
    /\b(mera|meri|mujhe|main|mein|naam|hai|hoon|amdani|amdan|mahana|imdad|darkhwast|zila|shehar|ghar|rupay|haan|nahi|nahin|nhi|ji|ijazat|deti|deta|kar\s+dein|kar\s+do|karke|se\s+hoon|ruko|wapis|wapas|mukammal|naya|banao|banana|bana|hua|bhej|chahiye|sailab|barish|paise|paisay|faisla|insaan|karni|pehle|karo|aam|peeche|pichli|jao|poocho|pooch|jawab|aaya|batao|kab|hogi|hazaar|hazar|saade|pachis|taqreeban|aur|galat|ghalat|sahi|tumne|likhi|likha|cheez|bhai|yaar|yr|haiga|asal|banti|deewar)\b/i.test(
      trimmed,
    )
  ) {
    return 'ur';
  }

  // Pure digits, negative numbers, CNIC, phone, usernames, or MOCK-ID -> preserve current session language
  if (
    /^[+\-\d\s,.-]+$|^MOCK-ID-\d+$/i.test(trimmed) ||
    /^(?:admin|officer|helper|citizen|auditor)_[a-z0-9_]+$/i.test(trimmed) ||
    /^[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(trimmed)
  ) {
    return fallback;
  }

  // Short city name alone -> preserve current language!
  for (const [regex] of DISTRICT_MAP) {
    if (regex.test(trimmed) && trimmed.split(/\s+/).length <= 2) {
      return fallback;
    }
  }

  return 'en';
}

const DISTRICT_MAP: Array<[RegExp, string]> = [
  [/\bdadu\b|دادو/i, 'Dadu'],
  [/\bmultan\b|ملتان/i, 'Multan'],
  [/\blahore\b|لاہور|لاهور/i, 'Lahore'],
  [/\bsukkur\b|سکھر|سکر/i, 'Sukkur'],
  [/\bpeshawar\b|پشاور|پېښور/i, 'Peshawar'],
  [/\bquetta\b|کوئٹہ|کوئٹه/i, 'Quetta'],
  [/\bkarachi\b|کراچی|ڪراچي/i, 'Karachi'],
  [/\bhyderabad\b|حیدرآباد|حيدرآباد/i, 'Hyderabad'],
  [/\brawalpindi\b|راولپنڈی/i, 'Rawalpindi'],
  [/\bfaisalabad\b|فیصل آباد/i, 'Faisalabad'],
  [/\bbahawalpur\b|بہاولپور/i, 'Bahawalpur'],
  [/\bmardan\b|مردان/i, 'Mardan'],
  [/\bswat\b|سوات/i, 'Swat'],
  [/\blarkana\b|لاڑکانہ|لاڙڪاڻو/i, 'Larkana'],
  [/\bturbat\b|تربت/i, 'Turbat'],
  [/\bgwadar\b|گوادر/i, 'Gwadar'],
  [/\bdg khan\b|ڈی جی خان|ڈیرہ غازی خان/i, 'Dera Ghazi Khan'],
  [/\bthatta\b|ٹھٹہ|ٺٽو/i, 'Thatta'],
  [/\bbadin\b|بدین|بدين/i, 'Badin'],
  [/\bkhairpur\b|خیرپور|خيرپور/i, 'Khairpur'],
  [/\bnawabshah\b|نوابشاہ/i, 'Nawabshah'],
  [/\bmirpurkhas\b|میرپورخاص/i, 'Mirpurkhas'],
  [/\bjacobabad\b|جیکب آباد/i, 'Jacobabad'],
  [/\bshikarpur\b|شکارپور/i, 'Shikarpur'],
  [/\bsanghar\b|سانگھڑ/i, 'Sanghar'],
  [/\bjamshoro\b|جامشورو/i, 'Jamshoro'],
  [/\brajanpur\b|راجن پور/i, 'Rajanpur'],
  [/\bmuzaffargarh\b|مظفرگڑھ/i, 'Muzaffargarh'],
  [/\bcharsadda\b|چارسدہ/i, 'Charsadda'],
  [/\bnowshera\b|نوشہرہ/i, 'Nowshera'],
  [/\bkohat\b|کوہاٹ/i, 'Kohat'],
  [/\bbannu\b|بنوں/i, 'Bannu'],
  [/\bchitral\b|چترال/i, 'Chitral'],
  [/\bkhuzdar\b|خضدار/i, 'Khuzdar'],
  [/\blasbela\b|لسبیلہ/i, 'Lasbela'],
  [/\bsibi\b|سبی/i, 'Sibi'],
  [/\bislamabad\b|اسلام آباد/i, 'Islamabad'],
  [/\bgujranwala\b|گوجرانوالہ/i, 'Gujranwala'],
  [/\bsialkot\b|سیالکوٹ/i, 'Sialkot'],
  [/\bsargodha\b|سرگودھا/i, 'Sargodha'],
];

function parseSpokenSignedNumber(rawText: string): number | null {
  const ascii = toAsciiDigits(rawText).toLowerCase();
  const withoutIds = ascii
    .replace(/mock-id-\d+/gi, ' ')
    .replace(/\b\d{5}-\d{7}-\d\b/g, ' ')
    .replace(/\b\d{13}\b/g, ' ')
    .replace(/(?:\+?92|0)3\d{9}\b/g, ' ');

  const wordMap: Array<[RegExp, number]> = [
    [/پانچ ہزار|پنج ہزار|پنج هزار|\b5\s*(?:thousand|hazaar|hazar)\b|\bfive thousand\b/i, 5000],
    [/آٹھ ہزار|اٹھ ہزار|\b8\s*(?:thousand|hazaar|hazar)\b|\beight thousand\b/i, 8000],
    [/دس ہزار|ڏهه هزار|لس زره|\b10\s*(?:thousand|hazaar|hazar)\b|\bten thousand\b/i, 10000],
    [/بارہ ہزار|ٻارهن هزار|۱۲ زره|\b12\s*(?:thousand|hazaar|hazar)\b|\btwelve thousand\b/i, 12000],
    [/پندرہ ہزار|پندرهن هزار|۱۵ زره|\b15\s*(?:thousand|hazaar|hazar)\b|\bfifteen thousand\b/i, 15000],
    [/سترہ ہزار|سترهن هزار|\b17\s*(?:thousand|hazaar|hazar)\b|\bseventeen thousand\b/i, 17000],
    [/اٹھارہ ہزار|ارڙهن هزار|۱۸ زره|\b18\s*(?:thousand|hazaar|hazar)\b|\beighteen thousand\b/i, 18000],
    [/بیس ہزار|ويهه هزار|شل زره|\b20\s*(?:thousand|hazaar|hazar)\b|\btwenty thousand\b/i, 20000],
    [/پچیس ہزار|پنجويهه هزار|\b25\s*(?:thousand|hazaar|hazar)\b|\btwenty five thousand\b/i, 25000],
    [/تیس ہزار|\b30\s*(?:thousand|hazaar|hazar)\b|\bthirty thousand\b/i, 30000],
    [/کچھ نہیں|صفر|بے روزگار|کوئی آمدنی نہیں|\bzero\b|\bnone\b/i, 0],
  ];
  for (const [pat, val] of wordMap) {
    if (pat.test(withoutIds)) return val;
  }

  const numMatch = withoutIds.replace(/(\d),(\d)/g, '$1$2').match(/(-\d+(?:\.\d+)?|\b\d{1,8}\b)/);
  if (numMatch?.[1]) {
    const n = Number(numMatch[1]);
    if (Number.isFinite(n)) {
      if (n > 0 && n <= 99 && /ہزار|هزار|زره|thousand|hazaar|hazar|k\b/i.test(withoutIds)) {
        return n * 1000;
      }
      return n;
    }
  }
  return null;
}

// --- 6-LANGUAGE LOCALIZED AGENTIC PROMPTS (en, ur, sd, pa, ps, bal) ---

export function localizedHomeWelcome(lang: LanguageCode): string {
  switch (lang) {
    case 'en':
      return 'Assalam-o-Alaikum! Welcome to Amaanat Awaaz Saathi. Please tell me who you are: Normal Citizen (Aam User), Admin, Department Officer, or Community Helper?';
    case 'sd':
      return 'السلام عليڪم! امانت آواز ساٿي ۾ ڀليڪار. مهرباني ڪري ٻڌايو توهان ڪير آهيو: عام شهري (عادي صارف)، ايڊمن، کاتي جو آفيسر، يا ڪميونٽي مددگار؟';
    case 'pa':
      return 'السلام علیکم! امانت آواز ساتھی وچ جی آیاں نوں۔ دسو تسی کون او: عام صارف (شہری)، ایڈمن، محکمہ افسر، یا کمیونٹی معاون؟';
    case 'ps':
      return 'السلام علیکم! د امانت آواز ملګري ته ښه راغلاست. مهرباني وکړئ ووایاست تاسو څوک یاست: عادي وګړی، مدیر (ایډمن)، د ادارې افسر، که ټولنیز مرستیال؟';
    case 'bal':
      return 'السلام علیکم! امانت آواز ساتھی ءَ وش آتک اِت۔ مہربانی کن بگوش شما کے اِت: عام شہری، ایڈمن، محکمہ افسر یا کمیونٹی مددگار؟';
    default:
      return 'السلام علیکم! امانت آواز ساتھی میں خوش آمدید۔ بتائیں آپ کون ہیں: عام صارف (شہری)، ایڈمن، محکمہ افسر (Department Officer)، یا کمیونٹی معاون؟';
  }
}

function localizedCitizenAccountCheck(lang: LanguageCode, askWantCreate: boolean): string {
  if (!askWantCreate) {
    switch (lang) {
      case 'en':
        return 'Welcome! Do you already have an account, or not? Say "Yes" to sign in or "No" if you do not have one yet.';
      case 'sd':
        return 'ڀليڪار! ڇا توهان جو اڪائونٽ اڳ ۾ ٺهيل آهي يا نه؟';
      case 'pa':
        return 'جی آیاں نوں! کی تہاڈا اکاؤنٹ پہلاں توں بنیا ہویا اے یا نہیں؟';
      case 'ps':
        return 'ښه راغلاست! ایا ستاسو حساب له مخکې جوړ دی که نه؟';
      case 'bal':
        return 'وش آتک! آیا تئی اکاؤنٹ پیسرا جوڑ انت یا ناں؟';
      default:
        return 'خوش آمدید! کیا آپ کا اکاؤنٹ پہلے سے بنا ہوا ہے یا نہیں؟';
    }
  }
  switch (lang) {
    case 'en':
      return 'Understood — you do not have an account yet. Are you sure you want me to create a new account for you? Say "Yes" to create one or "No" to return to the home screen.';
    case 'sd':
      return 'سمجهي ويس — توهان جو اڪائونٽ اڃا ناهي ٺهيل. ڇا توهان پڪ سان چاهيو ٿا ته مان توهان جو نئون اڪائونٽ ٺاهيان؟';
    case 'pa':
      return 'سمجھ گیا — تہاڈا اکاؤنٹ ہجے نہیں بنیا۔ کی تسی پکا چاہندے او کہ میں تہاڈا نواں اکاؤنٹ بنا دیواں؟';
    case 'ps':
      return 'پوه شوم — ستاسو حساب لا نه دی جوړ شوی. ایا تاسو ډاډه یاست چې غواړئ زه ستاسو لپاره نوی حساب جوړ کړم؟';
    case 'bal':
      return 'سرپد بوتاں — تئی اکاؤنٹ انگت جوڑ نہ انت۔ آیا شما پکا لوٹ اِت کہ من تئی نوکیں اکاؤنٹ جوڑ بکناں؟';
    default:
      return 'سمجھ گیا، آپ کا اکاؤنٹ ابھی نہیں بنا ہوا۔ کیا آپ واقعی چاہتے ہیں کہ میں آپ کا نیا اکاؤنٹ بنا دوں؟ ہاں یا نہیں کہیں۔';
  }
}

function localizedVoicePaused(lang: LanguageCode): string {
  switch (lang) {
    case 'en':
      return 'Okay, I have paused. Tap the microphone whenever you want to speak again.';
    case 'sd':
      return 'ٺيڪ آهي، مان رڪجي ويس. جڏهن ٻيهر ڳالهائڻ چاهيو ته مائيڪ بٽڻ دٻايو.';
    case 'pa':
      return 'ٹھیک اے، میں رک گیا آں۔ جدوں دوبارہ گل کرنی ہووے تاں مائیک بٹن دبا دیو۔';
    case 'ps':
      return 'سمه ده، زه ودرېدم. کله چې بیا خبرې کول غواړئ د مایک تڼۍ کېکاږئ.';
    case 'bal':
      return 'شر انت، من اوشتاتاں۔ ہر وھد ءَ کہ گپ جنگ لوٹ اِت مائیک ءِ بٹن ءَ بزن اِت۔';
    default:
      return 'ٹھیک ہے، میں رک گیا ہوں۔ جب آپ دوبارہ بات کرنا چاہیں تو مائیک بٹن دبائیں۔';
  }
}

function localizedGoingToLogin(lang: LanguageCode, targetRole?: string): string {
  const roleHintEn =
    targetRole === 'officer'
      ? 'Department Officer'
      : targetRole === 'admin'
        ? 'Admin'
        : targetRole === 'helper'
          ? 'Community Helper'
          : 'Citizen';
  switch (lang) {
    case 'en':
      return `Great! Taking you to the ${roleHintEn} login page now. Please tell me your username/CNIC and password or PIN (e.g., "username officer_hamza and password officer123").`;
    case 'sd':
      return 'تمام سٺو! مان توهان کي لاگ ان صفحي تي وٺي وڃي رهيو آهيان. مهرباني ڪري پنهنجو يوزرنيم يا CNIC ۽ پاسورڊ/PIN ٻڌايو.';
    case 'pa':
      return 'بہت ودھیا! میں تہانوں لاگ ان صفحے تے لے کے جا رہیا آں۔ اپنا یوزرنیم یا CNIC اتے پاسورڈ یا PIN دسو۔';
    case 'ps':
      return 'ډېر ښه! زه تاسو د ننوتلو (لاګ ان) پاڼې ته وړم. مهرباني وکړئ خپل کارن نوم یا CNIC او پټنوم/PIN ووایاست.';
    case 'bal':
      return 'باز وش! من شمارا لاگ ان ءِ دیم ءَ برگا آں۔ مہربانی کن وتئی یوزرنیم یا CNIC ءُ پاسورڈ/PIN بگوش اِت۔';
    default:
      return 'بہت اچھا! میں آپ کو لاگ ان پیج پر لے کر جا رہا ہوں۔ براہِ کرم اپنا یوزرنیم یا CNIC اور پاسورڈ یا PIN بتائیں۔';
  }
}

function localizedGoingToSignup(lang: LanguageCode): string {
  switch (lang) {
    case 'en':
      return 'Great! Taking you to the account creation screen now. First, please tell me your full name (3–80 letters).';
    case 'sd':
      return 'تمام سٺو! مان توهان کي نئين اڪائونٽ واري صفحي تي وٺي وڃي رهيو آهيان. سڀ کان پهرين پنهنجو پورو نالو ٻڌايو.';
    case 'pa':
      return 'بہت ودھیا! میں تہانوں نواں اکاؤنٹ بنان والے صفحے تے لے جا رہیا آں۔ سب توں پہلے اپنا پورا ناں دسو۔';
    case 'ps':
      return 'ډېر ښه! زه تاسو د نوي حساب جوړولو پاڼې ته وړم. لومړی خپل بشپړ نوم ووایاست.';
    case 'bal':
      return 'باز وش! من شمارا نوکیں اکاؤنٹ ءِ دیم ءَ برگا آں۔ پیسرا وتئی سرجمیں نام بگوش اِت۔';
    default:
      return 'بہت اچھا! میں آپ کو نیا اکاؤنٹ بنانے کے صفحے پر لے کر جا رہا ہوں۔ سب سے پہلے اپنا پورا نام بتائیں۔';
  }
}

function localizedDeclinedSignup(lang: LanguageCode): string {
  switch (lang) {
    case 'en':
      return 'Okay, no new account will be created. Returning to the home screen — tap the microphone whenever you need help.';
    case 'sd':
      return 'ٺيڪ آهي، ڪو نئون اڪائونٽ نه ٺاهيو ويندو. هوم اسڪرين تي واپس وڃي رهيا آهيون — جڏهن مدد گهرجي ته مائيڪ بٽڻ دٻايو.';
    case 'pa':
      return 'ٹھیک اے، کوئی نواں اکاؤنٹ نہیں بنایا جاوے گا۔ ہوم اسکرین تے واپس جا رہے آں — جدوں مدد چاہیدی ہووے مائیک بٹن دباؤ۔';
    case 'ps':
      return 'سمه ده، نوی حساب به نه جوړېږي. کور پاڼې ته بېرته ځو — کله چې مرستې ته اړتیا لرئ د مایک تڼۍ کېکاږئ.';
    case 'bal':
      return 'شر انت، ہچ نوکیں اکاؤنٹ جوڑ نہ بیت۔ ہوم اسکرین ءَ پدا رؤگ ءَ ایں — ہر وھد ءَ کہ مدد لوٹ اِت مائیک بٹن ءَ بزن اِت۔';
    default:
      return 'ٹھیک ہے، کوئی نیا اکاؤنٹ نہیں بنایا جائے گا۔ ہوم اسکرین پر واپس جا رہے ہیں — جب بھی مدد چاہیے ہو تو مائیک بٹن دبائیں۔';
  }
}

function localizedAuthGateAskMode(lang: LanguageCode): string {
  switch (lang) {
    case 'en':
      return 'Language set to English! Do you already have an account, or should I create a new voice account for you?';
    case 'sd':
      return 'سنڌي ٻولي چونڊجي وئي! ڇا توهان جو اڳ ۾ اڪائونٽ ٺهيل آهي، يا مان توهان جو نئون اڪائونٽ ٺاهيان؟';
    case 'pa':
      return 'پنجابی بولی چُن لئی گئی! کی تہاڈا پہلاں توں اکاؤنٹ بنیا ہویا اے، یا میں تہاڈا نواں اکاؤنٹ بنا دیواں؟';
    case 'ps':
      return 'پښتو ژبه وټاکل شوه! ایا ستاسو حساب له مخکې جوړ دی، که زه ستاسو لپاره نوی حساب جوړ کړم؟';
    case 'bal':
      return 'بلوچی زبان گچین بوت! آیا تئی اکاؤنٹ پیسرا جوڑ انت یا من تئی نوکیں اکاؤنٹ جوڑ بکناں؟';
    default:
      return 'اردو زبان منتخب ہو گئی! کیا آپ کا پہلے سے اکاؤنٹ بنا ہوا ہے، یا میں آپ کا نیا اکاؤنٹ بنا دوں؟ (نئے اکاؤنٹ کے لیے "نیا اکاؤنٹ بنائیں" کہیں یا اپنا نام بتائیں)';
  }
}

function localizedAuthSignupQuestion(
  lang: LanguageCode,
  field: 'full_name' | 'cnic' | 'phone' | 'pin',
  draft: AgentAuthDraft,
): string {
  if (lang === 'en') {
    if (field === 'full_name') return 'To create your account, please tell me your full name (3–80 letters).';
    if (field === 'cnic')
      return `Thank you ${draft.full_name}. Now please tell me your exact 13-digit CNIC number (format: XXXXX-XXXXXXX-X).`;
    if (field === 'phone')
      return `CNIC ${draft.cnic} verified. Now please tell me your Pakistani mobile number (03XXXXXXXXX).`;
    return 'Last step for signup: choose a 4-digit secret PIN for future voice logins.';
  }
  if (lang === 'sd') {
    if (field === 'full_name') return 'نئون اڪائونٽ ٺاهڻ لاءِ، مهرباني ڪري پنهنجو پورو نالو ٻڌايو.';
    if (field === 'cnic')
      return `مهرباني ${draft.full_name}. هاڻي پنهنجو پورو 13 هندسن وارو CNIC نمبر ٻڌايو (مثال 42101-1234567-2).`;
    if (field === 'phone')
      return `CNIC ${draft.cnic} محفوظ ٿي ويو. هاڻي پنهنجو پاڪستاني موبائل نمبر ٻڌايو (03XXXXXXXXX).`;
    return 'آخري مرحلو: پنهنجي اڪائونٽ لاءِ 4 هندسن جو PIN ڪوڊ ٻڌايو.';
  }
  if (lang === 'pa') {
    if (field === 'full_name') return 'نواں اکاؤنٹ بنان لئی اپنا پورا ناں دسو۔';
    if (field === 'cnic')
      return `شکریہ ${draft.full_name}۔ ہُݨ اپنا پورا 13 ہندسیاں دا CNIC نمبر دسو (42101-1234567-2)۔`;
    if (field === 'phone')
      return `CNIC ${draft.cnic} درست اے۔ ہُݨ اپنا پاکستانی موبائل نمبر دسو (03XXXXXXXXX)۔`;
    return 'آخری قدم: اپنے اکاؤنٹ لئی 4 ہندسیاں دا PIN کوڈ دسو۔';
  }
  if (lang === 'ps') {
    if (field === 'full_name') return 'د نوي حساب جوړولو لپاره خپل بشپړ نوم ووایاست.';
    if (field === 'cnic')
      return `مننه ${draft.full_name}. اوس خپل دقیق 13 رقمي پېژندپاڼې نمبر ووایاست (42101-1234567-2).`;
    if (field === 'phone')
      return `پېژندپاڼه ${draft.cnic} سمه ده. اوس خپل پاکستاني موبایل نمبر ووایاست (03XXXXXXXXX).`;
    return 'وروستی پړاو: د ننوتلو لپاره 4 رقمي PIN کوډ ووایاست.';
  }
  if (lang === 'bal') {
    if (field === 'full_name') return 'نوکیں اکاؤنٹ جوڑ کنگ ءِ واستہ وتئی سرجمیں نام بگوش اِت۔';
    if (field === 'cnic') return `منتوار ${draft.full_name}۔ نوں وتئی 13 ہندسہ ءِ CNIC نمبر بگوش اِت۔`;
    if (field === 'phone') return `CNIC ${draft.cnic} محفوظ بوت۔ نوں وتئی موبائل نمبر (03XXXXXXXXX) بگوش اِت۔`;
    return 'آخری گام: وتئی اکاؤنٹ ءِ واستہ 4 ہندسہ ءِ PIN کوڈ بگوش اِت۔';
  }
  if (field === 'full_name') return 'نیا اکاؤنٹ بنانے کے لیے سب سے پہلے اپنا پورا نام بتائیں۔';
  if (field === 'cnic')
    return `شکریہ ${draft.full_name}۔ اب اپنا پورا 13 ہندسوں کا شناختی کارڈ (CNIC) نمبر بتائیں (مثلاً 42101-1234567-2)۔`;
  if (field === 'phone')
    return `شناختی کارڈ ${draft.cnic} محفوظ ہو گیا۔ اب اپنا پاکستانی موبائل نمبر بتائیں (مثلاً 03001234567)۔`;
  return 'اکاؤنٹ مکمل کرنے کا آخری مرحلہ: لاگ ان کے لیے کوئی 4 ہندسوں کا خفیہ PIN بتائیں (مثلاً 1234)۔';
}

function localizedOpenHubGreeting(lang: LanguageCode, name: string): string {
  switch (lang) {
    case 'en':
      return `Assalam-o-Alaikum ${name}, your account is ready! How may I help you today? You can apply for relief assistance, check your application status, ask a Department Officer directly, verify a suspicious scam SMS, or ask policy questions.`;
    case 'sd':
      return `السلام عليڪم ${name}، توهان جو اڪائونٽ تيار آهي! ٻڌايو اڄ مان توهان جي ڪهڙي مدد ڪري سگهان ٿو؟ توهان رليف جي درخواست ڏئي سگهو ٿا، درخواست جو اسٽيٽس ڄاڻي سگهو ٿا، سڌو کاتي جي آفيسر کان سوال پڇي سگهو ٿا، يا مشڪوڪ SMS چيڪ ڪرائي سگهو ٿا.`;
    case 'pa':
      return `السلام علیکم ${name}، تہاڈا اکاؤنٹ تیار اے! دسو اج میں تہاڈی کی مدد کر سکدا آں؟ تسی ریلیف درخواست دے سکدے او، درخواست دا اسٹیٹس چیک کر سکدے او، سدھا محکمہ افسر توں سوال پچھ سکدے او، یا مشکوک SMS چیک کروا سکدے او۔`;
    case 'ps':
      return `السلام علیکم ${name}، ستاسو حساب چمتو دی! ووایاست نن زه ستاسو څه مرسته کولی شم؟ تاسو د مرستې غوښتنه کولی شئ، د غوښتنلیک حالت کتلی شئ، مستقیم له افسر څخه پوښتنه کولی شئ، یا شکمن SMS کتلی شئ.`;
    case 'bal':
      return `السلام علیکم ${name}، تئی اکاؤنٹ تیار انت! بگوش مروچی من تئی چے مدد کت کناں؟ شما امداد ءِ درخواست دات کن اِت، اسٹیٹس چارت کن اِت، یا براہ راست افسر ءَ جست کت کن اِت۔`;
    default:
      return `السلام علیکم ${name}، آپ کا اکاؤنٹ تیار ہے! بتائیں آج میں آپ کی کیا مدد کر سکتا ہوں؟ آپ ریلیف کی درخواست دے سکتے ہیں، اپنی درخواست کا اسٹیٹس جان سکتے ہیں، ڈائریکٹ محکمہ افسر سے سوال پوچھ سکتے ہیں، کسی مشکوک SMS کی جانچ کروا سکتے ہیں، یا پالیسی کے بارے میں پوچھ سکتے ہیں۔`;
  }
}

function localizedReliefQuestion(lang: LanguageCode, field: string, state: VoiceSessionFormState): string {
  if (lang === 'en') {
    const map: Record<string, string> = {
      name: 'Please tell me your full name.',
      cnic: `Thank you ${state.name}. Please provide your 13-digit CNIC.`,
      district: `Your name (${state.name}) and CNIC (${state.cnic}) are pre-filled from your account. Which district or city do you live in?`,
      monthly_income: `District ${state.district} saved. What is your total monthly household income in PKR (0 to 500,000)?`,
      amount: `Monthly income ${state.monthly_income} PKR saved. How much relief amount do you need in PKR (between 500 and 100,000 PKR)?`,
      reason: `Requested amount ${state.amount} PKR saved. Please briefly describe why you need relief assistance.`,
      consent_confirmed: `All details are ready: Name ${state.name}, CNIC ${state.cnic}, District ${state.district}, Monthly Income ${state.monthly_income} PKR, Requested Amount ${state.amount} PKR, Reason: ${state.reason}. Is everything correct, or would you like to edit any field? If everything is correct, say "Yes, submit my claim".`,
    };
    return map[field] ?? map.district!;
  }
  if (lang === 'sd') {
    const map: Record<string, string> = {
      name: 'مهرباني ڪري پنهنجو پورو نالو ٻڌايو.',
      cnic: `مهرباني ${state.name}. هاڻي پنهنجو CNIC نمبر ٻڌايو.`,
      district: `توهان جو نالو (${state.name}) ۽ CNIC (${state.cnic}) اڪائونٽ مان اڳ ئي ڀريل آهن. توهان ڪهڙي ضلعي ۾ رهو ٿا؟`,
      monthly_income: `ضلعو ${state.district} محفوظ ٿيو. توهان جي مهيني جي ڪل آمدني ڪيترا رپيا آهي؟`,
      amount: `آمدني ${state.monthly_income} رپيا محفوظ ٿي. توهان کي ڪيتري امداد رقم گهرجي (500 کان 100,000 رپيا)؟`,
      reason: `رقم ${state.amount} رپيا محفوظ ٿي. مهرباني ڪري امداد جو سبب ٻڌايو.`,
      consent_confirmed: `سڀ تفصيل مڪمل آهن (${state.name}، ضلعو ${state.district}، آمدني ${state.monthly_income} رپيا، رقم ${state.amount} رپيا). ڇا سڀ ٺيڪ آهي يا ڪنهن خاني ۾ تبديلي ڪرڻي آهي؟ جيڪڏهن ٺيڪ آهي ته "ها اجازت آهي جمع ڪريو" چئو.`,
    };
    return map[field] ?? map.district!;
  }
  if (lang === 'ps') {
    const map: Record<string, string> = {
      name: 'خپل بشپړ نوم ووایاست.',
      cnic: `مننه ${state.name}. اوس خپل CNIC نمبر ووایاست.`,
      district: `ستاسو نوم (${state.name}) او پېژندپاڼه (${state.cnic}) له حساب څخه ډک شول. تاسو په کومه ولسوالۍ کې اوسېږئ؟`,
      monthly_income: `ولسوالي ${state.district} ثبت شوه. ستاسو میاشتنی عاید څومره روپۍ دی؟`,
      amount: `عاید ${state.monthly_income} روپۍ ثبت شو. تاسو څومره مرستې پیسې غواړئ (500 تر 100,000 روپۍ)؟`,
      reason: `رقم ${state.amount} روپۍ ثبت شو. مهرباني وکړئ د مرستې لامل ووایاست.`,
      consent_confirmed: `ټول معلومات بشپړ شول (${state.name}، ${state.district}، عاید ${state.monthly_income} روپۍ، رقم ${state.amount} روپۍ). ایا ټول سم دي که بدلون غواړئ؟ د سپارلو لپاره "هو اجازه ده وسپارئ" ووایاست.`,
    };
    return map[field] ?? map.district!;
  }
  if (lang === 'pa') {
    const map: Record<string, string> = {
      name: 'اپنا پورا ناں دسو۔',
      cnic: `شکریہ ${state.name}۔ ہُݨ اپنا CNIC نمبر دسو۔`,
      district: `تہاڈا ناں (${state.name}) اتے CNIC (${state.cnic}) اکاؤنٹ توں پہلے ہی بھرے ہوئے نیں۔ ہُݨ دسو تسی کس ضلعے وچ رہندے او؟`,
      monthly_income: `ضلع ${state.district} لکھ لیا گیا۔ تہاڈے گھر دی مہینے دی کل آمدنی کنے روپے اے؟`,
      amount: `آمدنی ${state.monthly_income} روپے لکھ لئی گئی۔ تہانوں کنی ریلیف رقم چاہیدی اے (500 توں 100,000 روپے)؟`,
      reason: `رقم ${state.amount} روپے لکھ لئی گئی۔ تہانوں کس وجہ توں ریلیف امداد دی لوڑ اے؟`,
      consent_confirmed: `ساری تفصیل مکمل ہو گئی اے (${state.name}، ضلع ${state.district}، آمدنی ${state.monthly_income} روپے، رقم ${state.amount} روپے)۔ کی سب ٹھیک اے یا کسے خانے وچ تبدیلی کرنی اے؟ جے ٹھیک اے تاں "ہاں اجازت اے جمع کر دیو" آکھو۔`,
    };
    return map[field] ?? map.district!;
  }
  if (lang === 'bal') {
    const map: Record<string, string> = {
      name: 'وتئی سرجمیں نام بگوش اِت۔',
      cnic: `منتوار ${state.name}۔ نوں وتئی CNIC نمبر بگوش اِت۔`,
      district: `تئی نام (${state.name}) ءُ CNIC (${state.cnic}) پیسرا درج انت۔ شما کجام ضلع ءَ نند اِت؟`,
      monthly_income: `ضلع ${state.district} محفوظ بوت۔ تئی ماہانہ آمدنی چنت کلدار انت؟`,
      amount: `آمدنی ${state.monthly_income} کلدار محفوظ بوت۔ شمارا چنت امداد لوٹ ایت (500 تا 100,000)؟`,
      reason: `رقم ${state.amount} کلدار محفوظ بوت۔ امداد ءِ سبب بگوش اِت۔`,
      consent_confirmed: `سرجمیں حال تیار انت (${state.name}، ضلع ${state.district}، آمدنی ${state.monthly_income}، رقم ${state.amount})۔ آیا درست انت یا بدلی کنگی انت؟ جمع کنگ ءِ واستہ "ہئو جمع کن" بگوش اِت۔`,
    };
    return map[field] ?? map.district!;
  }
  const map: Record<string, string> = {
    name: 'سب سے پہلے اپنا پورا نام بتائیں۔',
    cnic: `شکریہ ${state.name}۔ اب اپنا شناختی کارڈ نمبر بتائیں۔`,
    district: `آپ کا نام (${state.name}) اور CNIC (${state.cnic}) آپ کے اکاؤنٹ سے خودکار درج ہو گیا ہے۔ اب بتائیں آپ کس ضلع یا شہر میں رہتے ہیں؟`,
    monthly_income: `ضلع ${state.district} محفوظ ہو گیا۔ اب بتائیں آپ کے گھر کی کل ماہانہ آمدنی کتنے روپے ہے (0 سے 500,000 روپے)؟`,
    amount: `ماہانہ آمدنی ${state.monthly_income} روپے درج ہو گئی۔ آپ کو کتنی ریلیف رقم کی ضرورت ہے (500 سے 100,000 روپے کے درمیان)؟`,
    reason: `مطلوبہ رقم ${state.amount} روپے درج ہو گئی۔ براہِ کرم مختصر وجہ بتائیں کہ آپ کو ریلیف امداد کیوں چاہیے؟`,
    consent_confirmed: `آپ کی تمام تفصیلات تیار ہیں: نام ${state.name}، شناختی کارڈ ${state.cnic}، ضلع ${state.district}، ماہانہ آمدنی ${state.monthly_income} روپے، مطلوبہ رقم ${state.amount} روپے، وجہ: ${state.reason}۔ کیا سب معلومات ٹھیک ہیں، یا کسی فیلڈ میں تبدیلی کرنی ہے؟ اگر ٹھیک ہے تو "ہاں میں اجازت دیتی ہوں، سبمٹ کر دیں" بولیں۔`,
  };
  return map[field] ?? map.district!;
}

function localizedSubmittedReceipt(lang: LanguageCode, refNum: string, status: string, score: number): string {
  if (lang === 'en') {
    return `Congratulations! Your relief application has been verified and submitted to the Admin Console under your authenticated account. Reference Number: ${refNum} (Evidence Score: ${score}/100, Status: ${status}). How else may I help you today?`;
  }
  if (lang === 'sd') {
    return `مبارڪون! توهان جي رليف درخواست توهان جي تصديق ٿيل اڪائونٽ ذريعي جمع ٿي وئي آهي. حوالو نمبر: ${refNum} (اسڪور: ${score}/100). ڇا توهان کي ڪا ٻي مدد گهرجي؟`;
  }
  if (lang === 'ps') {
    return `مبارک شه! ستاسو د مرستې غوښتنلیک ستاسو له تایید شوي حساب څخه وسپارل شو. د حوالې شمېره: ${refNum} (نمرې: ${score}/100). ایا بله مرسته غواړئ؟`;
  }
  if (lang === 'pa') {
    return `مبارک ہووے! تہاڈی ریلیف درخواست جمع ہو گئی اے۔ حوالہ نمبر: ${refNum} (اسکور: ${score}/100، اسٹیٹس: ${status})۔ ہور کی مدد کراں؟`;
  }
  if (lang === 'bal') {
    return `مبارک بات! تئی امداد ءِ درخواست جمع بوت۔ حوالہ نمبر: ${refNum} (اسکور: ${score}/100)۔ دگہ چے مدد بکناں؟`;
  }
  return `مبارک ہو! آپ کی ریلیف درخواست آپ کے تصدیق شدہ اکاؤنٹ کے تحت کامیابی سے جمع ہو کر ایڈمن کنسول میں پہنچ گئی ہے۔ آپ کا حوالہ نمبر ${refNum} ہے (اسکور: ${score}/100، اسٹیٹس: ${status})۔ کیا میں آپ کی کوئی اور مدد کر سکتا ہوں؟`;
}

function detectOutOfScopeEscalation(transcript: string): PendingEscalationDraft | null {
  const t = transcript.toLowerCase();
  if (
    /\b(force.?approve|approve\s+(my|kar|kr)|khud.*approve|manzoor\s+kar\s+do|abhi\s+approve)\b/i.test(t) ||
    /(خو?د.*منظور کر|فوراً منظور|کلیم اپروو کر)/.test(transcript)
  ) {
    return {
      assigned_admin: 'Officer Hamza',
      reason_out_of_scope:
        'AI cannot approve relief claims or bypass human officer review authority (strict RBAC & human-in-the-loop guardrail).',
      user_request_text: transcript.trim(),
      category: 'force_approve',
    };
  }
  if (
    /\b(bank.*transfer|transfer.*money|paise\s+bhej|send\s+money|jazzcash|easypaisa|disburse|bank\s+mein)\b/i.test(t) ||
    /(بینک.*ٹرانسفر|پیسے بھیج دو|اکاؤنٹ میں پیسے)/.test(transcript)
  ) {
    return {
      assigned_admin: 'Officer Hamza',
      reason_out_of_scope:
        'AI cannot initiate real bank transfers or disburse funds directly without human Officer authorization.',
      user_request_text: transcript.trim(),
      category: 'bank_transfer',
    };
  }
  if (
    /\b(nadra|cnic\s+change|cnic\s+badal|change\s+my\s+nadra|update\s+nadra)\b/i.test(t) ||
    /(نادرا|شناختی کارڈ بدل|ریکارڈ تبدیل)/.test(transcript)
  ) {
    return {
      assigned_admin: 'Admin Ayesha',
      reason_out_of_scope:
        'AI cannot modify official NADRA identity records or override verified identity databases.',
      user_request_text: transcript.trim(),
      category: 'nadra_change',
    };
  }
  if (
    /\b(officer\s+ne\s+ghalat|appeal|complaint|shikayat|wrong\s+decision|unfair\s+rejection)\b/i.test(t) ||
    /(آفیسر نے غلط فیصلہ|شکایت|اپیل کرنی)/.test(transcript)
  ) {
    return {
      assigned_admin: 'Officer Hamza',
      reason_out_of_scope:
        'Disputes, appeals, and complaints against an Officer decision require formal human supervisor review.',
      user_request_text: transcript.trim(),
      category: 'claim_dispute',
    };
  }
  if (
    /\b(insaan\s+se\s+baat|admin\s+se\s+baat|talk\s+to\s+(a\s+)?(human|admin|person)|real\s+person)\b/i.test(t) ||
    /(انسان سے بات|ایڈمن سے بات)/.test(transcript)
  ) {
    return {
      assigned_admin: 'Admin Ayesha',
      reason_out_of_scope: 'Citizen explicitly requested direct assistance from a human Officer / Administrator.',
      user_request_text: transcript.trim(),
      category: 'human_agent',
    };
  }
  return null;
}

function summarizeFormDraftFields(form: VoiceSessionFormState, lang: LanguageCode): string {
  const saved: string[] = [];
  if (form.name) saved.push(lang === 'en' ? `Name (${form.name})` : `نام (${form.name})`);
  if (form.cnic) saved.push(`CNIC (${form.cnic})`);
  if (form.district) saved.push(lang === 'en' ? `District (${form.district})` : `ضلع (${form.district})`);
  if (form.monthly_income !== null)
    saved.push(
      lang === 'en' ? `Monthly Income (${form.monthly_income} PKR)` : `ماہانہ آمدنی (${form.monthly_income} روپے)`,
    );
  if (form.amount !== null)
    saved.push(lang === 'en' ? `Requested Amount (${form.amount} PKR)` : `مطلوبہ رقم (${form.amount} روپے)`);
  if (form.reason) saved.push(lang === 'en' ? 'Reason' : 'وجہ');
  return saved.join('، ');
}

function fieldDisplayLabel(field: string, lang: LanguageCode): string {
  const enMap: Record<string, string> = {
    name: 'Full Name',
    full_name: 'Full Name',
    cnic: 'CNIC',
    phone: 'Mobile Phone',
    pin: '4-Digit PIN',
    district: 'District',
    monthly_income: 'Monthly Income (PKR)',
    amount: 'Requested Amount (PKR)',
    reason: 'Relief Reason',
    consent_confirmed: 'Verbal Consent',
  };
  const urMap: Record<string, string> = {
    name: 'پورا نام',
    full_name: 'پورا نام',
    cnic: 'شناختی کارڈ (CNIC)',
    phone: 'موبائل نمبر',
    pin: '4 ہندسوں کا PIN',
    district: 'ضلع',
    monthly_income: 'ماہانہ آمدنی',
    amount: 'مطلوبہ ریلیف رقم',
    reason: 'امداد کی وجہ',
    consent_confirmed: 'زبانی اجازت',
  };
  return lang === 'en' ? (enMap[field] ?? field) : (urMap[field] ?? field);
}

function getFormFieldCurrentValue(state: VoiceSessionFormState, field: string): string {
  switch (field) {
    case 'name':
      return state.name || 'empty';
    case 'cnic':
      return state.cnic || 'empty';
    case 'district':
      return state.district || 'empty';
    case 'monthly_income':
      return state.monthly_income !== null ? `${state.monthly_income} PKR` : 'empty';
    case 'amount':
      return state.amount !== null ? `${state.amount} PKR` : 'empty';
    case 'reason':
      return state.reason || 'empty';
    default:
      return 'empty';
  }
}

function getAuthFieldCurrentValue(draft: AgentAuthDraft, field: string): string {
  switch (field) {
    case 'full_name':
      return draft.full_name || 'empty';
    case 'cnic':
      return draft.cnic || 'empty';
    case 'phone':
      return draft.phone || 'empty';
    case 'pin':
      return draft.pin ? '****' : 'empty';
    default:
      return 'empty';
  }
}

export class VoiceAgentService {
  private readonly nluRagService: NluRagService;
  private readonly universalRagService: UniversalRagService;
  private readonly mcpClient: AmaanatMcpClient;
  private readonly langGraphAgent: AwaazLangGraphAgent;

  constructor(
    private readonly deps: {
      env: AppEnv;
      store: DataStore;
      mcpServer: AmaanatMcpServer;
      mcpClient?: AmaanatMcpClient;
      voiceProvider: VoiceProvider;
      aiProvider?: AIProvider;
      nluRagService?: NluRagService;
      universalRagService?: UniversalRagService;
      ruleEngineService?: DynamicRuleEngineService;
      consentEnforcementService?: ConsentEnforcementService;
      entityResolutionService?: EntityResolutionService;
      documentForgeryService?: DocumentForgeryService;
    },
  ) {
    this.nluRagService =
      deps.nluRagService ??
      new NluRagService({
        env: deps.env,
        store: deps.store,
        aiProvider: deps.aiProvider,
      });
    this.universalRagService =
      deps.universalRagService ??
      new UniversalRagService({
        env: deps.env,
        store: deps.store,
        aiProvider: deps.aiProvider,
      });
    this.mcpClient = deps.mcpClient ?? new AmaanatMcpClient(deps.mcpServer);
    this.langGraphAgent = new AwaazLangGraphAgent({
      env: deps.env,
      aiProvider: deps.aiProvider,
      mcpClient: this.mcpClient,
      universalRagService: this.universalRagService,
    });
  }

  private appendConversationWindowTurn(
    memory: AgentMemorySessionRecord,
    role: 'user' | 'agent',
    text: string,
    language: LanguageCode,
    fieldsTouched: string[],
    actionTaken: string,
  ): void {
    if (!Array.isArray(memory.conversation_window)) memory.conversation_window = [];
    memory.turn_counter = (memory.turn_counter ?? 0) + 1;
    const entry: ConversationWindowTurn = {
      turn_index: memory.turn_counter,
      role,
      text: text.slice(0, 450),
      language,
      timestamp: new Date().toISOString(),
      fields_touched: fieldsTouched,
      action_taken: actionTaken,
    };
    memory.conversation_window.push(entry);

    // Keep last 16 verbatim turns; compress older overflow into rolling context_summary
    if (memory.conversation_window.length > 16) {
      const overflow = memory.conversation_window.splice(0, memory.conversation_window.length - 16);
      const digest = overflow
        .map(
          (o) =>
            `#${o.turn_index}[${o.role}/${o.action_taken}${o.fields_touched.length ? `:${o.fields_touched.join(',')}` : ''}]: ${o.text.slice(0, 80)}`,
        )
        .join(' | ');
      const prev = memory.context_summary ?? '';
      memory.context_summary = `${prev ? `${prev} | ` : ''}${digest}`.slice(-1200);
    }
  }

  private recordFieldProvenance(
    memory: AgentMemorySessionRecord,
    fieldKey: string,
    value: string | number | boolean,
    rawUtterance: string,
    status: FieldProvenanceEntry['status'],
  ): void {
    if (!memory.field_provenance || typeof memory.field_provenance !== 'object') {
      memory.field_provenance = {};
    }
    memory.field_provenance[fieldKey] = {
      field_key: fieldKey,
      current_value: value,
      raw_user_utterance: rawUtterance.slice(0, 220),
      turn_index: memory.turn_counter ?? 0,
      status,
    };
  }

  private async loadOrCreateMemory(
    sessionId: string | undefined,
    orgId: string,
    initialLang: LanguageCode,
    initialStage: AgentWorkflowStage,
    auth?: AuthContext,
  ): Promise<AgentMemorySessionRecord> {
    const id = sessionId && sessionId.trim() ? sessionId.trim() : crypto.randomUUID();
    const existing = await this.deps.store.getAgentMemorySession(id);
    if (existing) {
      if (!Array.isArray(existing.field_fill_history)) existing.field_fill_history = [];
      if (existing.editing_field === undefined) existing.editing_field = null;
      if (!Array.isArray(existing.auth_draft.field_fill_history)) existing.auth_draft.field_fill_history = [];
      if (!Array.isArray(existing.conversation_window)) existing.conversation_window = [];
      if (typeof existing.context_summary !== 'string') existing.context_summary = '';
      if (!existing.field_provenance || typeof existing.field_provenance !== 'object') existing.field_provenance = {};
      if (typeof existing.turn_counter !== 'number') existing.turn_counter = existing.conversation_window.length;
      if (!existing.locked_language) existing.locked_language = existing.detected_language;
      if (!Array.isArray(existing.language_switch_history)) existing.language_switch_history = [];
      if (auth) {
        existing.user_id = auth.userId;
        existing.organization_id = auth.organizationId;
        const citizen = await this.deps.store.getCitizenByUserId(auth.organizationId, auth.userId);
        if (citizen) {
          existing.citizen_id = citizen.id;
        }
        if (
          existing.workflow_stage === 'HOME_WELCOME' ||
          existing.workflow_stage === 'LANGUAGE_SELECT' ||
          existing.workflow_stage === 'ROLE_IDENTIFICATION' ||
          existing.workflow_stage === 'CITIZEN_ACCOUNT_CHECK' ||
          existing.workflow_stage === 'AUTH_GATE'
        ) {
          existing.workflow_stage = 'AGENT_HUB';
          existing.active_task = 'idle';
        }
      }
      return existing;
    }

    let citizenId: string | null = null;
    const freshForm = emptyFormState();
    const initialProvenance: Record<string, FieldProvenanceEntry> = {};
    if (auth) {
      const citizen = await this.deps.store.getCitizenByUserId(auth.organizationId, auth.userId);
      if (citizen) {
        citizenId = citizen.id;
        freshForm.name = citizen.display_name;
        freshForm.cnic = citizen.mock_identity_reference;
        initialProvenance.name = {
          field_key: 'name',
          current_value: citizen.display_name,
          raw_user_utterance: '[Pre-filled from authenticated citizen profile]',
          turn_index: 0,
          status: 'pre_filled',
        };
        initialProvenance.cnic = {
          field_key: 'cnic',
          current_value: citizen.mock_identity_reference,
          raw_user_utterance: '[Pre-filled from authenticated citizen profile]',
          turn_index: 0,
          status: 'pre_filled',
        };
      } else {
        freshForm.name = auth.displayName;
      }
      freshForm.missing_fields = computeMissingFields(freshForm);
    }

    const now = new Date().toISOString();
    const fresh: AgentMemorySessionRecord = {
      session_id: id,
      organization_id: orgId,
      citizen_id: citizenId,
      user_id: auth?.userId ?? null,
      workflow_stage: auth ? (initialStage === 'RELIEF_FORM' ? 'RELIEF_FORM' : 'AGENT_HUB') : initialStage,
      detected_language: initialLang,
      locked_language: initialLang,
      language_locked: false,
      language_switch_history: [],
      active_task: auth && initialStage === 'RELIEF_FORM' ? 'relief_form' : 'idle',
      suspended_tasks: [],
      auth_draft: emptyAuthDraft(),
      form_draft: freshForm as unknown as Record<string, unknown>,
      field_fill_history: [],
      editing_field: null,
      pending_escalation: null,
      looked_up_identifier: null,
      conversation_history: [],
      conversation_window: [],
      context_summary: '',
      field_provenance: initialProvenance,
      turn_counter: 0,
      created_at: now,
      updated_at: now,
    };
    await this.deps.store.upsertAgentMemorySession(fresh);
    return fresh;
  }

  private hydrateFormState(
    memory: AgentMemorySessionRecord,
    clientFormState?: Partial<VoiceSessionFormState>,
  ): VoiceSessionFormState {
    const base = emptyFormState();
    const stored = memory.form_draft as Partial<VoiceSessionFormState>;
    monotonicMergeFormState(base, stored);
    if (clientFormState && typeof clientFormState === 'object') {
      monotonicMergeFormState(base, clientFormState);
    }
    base.missing_fields = computeMissingFields(base);
    base.ready_to_submit = base.missing_fields.length === 0;
    return base;
  }

  private suspendActiveReliefTask(
    memory: AgentMemorySessionRecord,
    formState: VoiceSessionFormState,
    reason: string,
  ): boolean {
    const hasProgress = Boolean(
      formState.district ||
        formState.monthly_income !== null ||
        formState.amount !== null ||
        formState.reason ||
        formState.name,
    );
    if (memory.active_task !== 'relief_form' && memory.workflow_stage !== 'RELIEF_FORM') return false;
    if (!hasProgress || formState.submitted_case_id) return false;

    const nextMissing = computeMissingFields(formState)[0] ?? null;
    const entry: SuspendedTaskEntry = {
      task_type: 'relief_form',
      suspended_at: new Date().toISOString(),
      reason,
      draft_snapshot: structuredClone(formState) as unknown as Record<string, unknown>,
      next_missing_field: nextMissing,
    };
    memory.suspended_tasks = [entry, ...memory.suspended_tasks.filter((t) => t.task_type !== 'relief_form')];
    memory.workflow_stage = 'AGENT_HUB';
    memory.active_task = 'idle';
    memory.editing_field = null;
    return true;
  }

  private extractAuthSignupFields(
    transcript: string,
    draft: AgentAuthDraft,
    expectedField: 'full_name' | 'cnic' | 'phone' | 'pin' | undefined,
    allowOverwrite: Set<string>,
    validationErrors: AgentValidationError[],
  ): string[] {
    const raw = transcript.trim();
    const ascii = toAsciiDigits(raw);
    const updated: string[] = [];

    // 1. CNIC
    const explicitCnicLabel = ascii.match(
      /(?:cnic|شناختی\s*کارڈ|شمارہ|card)\s*(?:is|number|نمبر|ہے|kar\s+do|karke|:)?\s*([0-9-\s]{4,22})/i,
    );
    const dashedCnicCandidate = ascii.match(/\b(\d{5}-\d{2,8}(?:-\d)?)\b/);
    const raw13Digits = ascii.match(/\b(\d{13})\b/);

    if (
      (explicitCnicLabel?.[1] || dashedCnicCandidate?.[1] || raw13Digits?.[1]) &&
      (!draft.cnic || allowOverwrite.has('cnic'))
    ) {
      const candidate = (explicitCnicLabel?.[1] ?? dashedCnicCandidate?.[1] ?? raw13Digits?.[1] ?? '').trim();
      const check = validateStrictCnic13(candidate);
      if (check.valid && check.value) {
        draft.cnic = check.value;
        updated.push('cnic');
      } else {
        validationErrors.push({
          field: 'cnic',
          message: check.error ?? 'CNIC must be exactly 13 digits.',
          received: candidate,
        });
      }
    } else if (expectedField === 'cnic' && (!draft.cnic || allowOverwrite.has('cnic'))) {
      const check = validateStrictCnic13(raw);
      if (check.valid && check.value) {
        draft.cnic = check.value;
        updated.push('cnic');
      } else {
        validationErrors.push({
          field: 'cnic',
          message: check.error ?? 'CNIC must be exactly 13 digits.',
          received: raw,
        });
      }
    }

    // 2. Phone
    const explicitPhoneLabel = ascii.match(
      /(?:phone|mobile|موبائل|فون|نمبر)\s*(?:is|number|نمبر|ہے|kar\s+do|:)?\s*([+0-9-\s]{3,18})/i,
    );
    const pakMobileMatch = ascii.match(/(?:\+92|92|0)3\d{2}[-\s]?\d{7}\b/);

    if (pakMobileMatch?.[0] && (!draft.phone || allowOverwrite.has('phone'))) {
      const check = validatePakistaniPhone(pakMobileMatch[0]);
      if (check.valid && check.value) {
        draft.phone = check.value;
        updated.push('phone');
      } else {
        validationErrors.push({
          field: 'phone',
          message: check.error ?? 'Invalid Pakistani mobile number.',
          received: pakMobileMatch[0],
        });
      }
    } else if (explicitPhoneLabel?.[1] && (!draft.phone || allowOverwrite.has('phone'))) {
      const candidate = explicitPhoneLabel[1].trim();
      const check = validatePakistaniPhone(candidate);
      if (check.valid && check.value) {
        draft.phone = check.value;
        updated.push('phone');
      } else {
        validationErrors.push({
          field: 'phone',
          message: check.error ?? 'Invalid Pakistani mobile number.',
          received: candidate,
        });
      }
    } else if (expectedField === 'phone' && (!draft.phone || allowOverwrite.has('phone'))) {
      const check = validatePakistaniPhone(raw);
      if (check.valid && check.value) {
        draft.phone = check.value;
        updated.push('phone');
      } else {
        validationErrors.push({
          field: 'phone',
          message: check.error ?? 'Invalid Pakistani mobile number.',
          received: raw,
        });
      }
    }

    // 3. 4-digit PIN
    const explicitPinMatch = ascii.match(/(?:pin|پن|کوڈ|code)\s*(?:is|number|ہے|kar\s+do|:)?\s*(\d{2,8})/i);
    if (explicitPinMatch?.[1] && (!draft.pin || allowOverwrite.has('pin'))) {
      const check = validatePin4(explicitPinMatch[1]);
      if (check.valid && check.value) {
        draft.pin = check.value;
        updated.push('pin');
      } else {
        validationErrors.push({
          field: 'pin',
          message: check.error ?? 'PIN must be exactly 4 digits.',
          received: explicitPinMatch[1],
        });
      }
    } else if (expectedField === 'pin' && (!draft.pin || allowOverwrite.has('pin'))) {
      const check = validatePin4(raw);
      if (check.valid && check.value) {
        draft.pin = check.value;
        updated.push('pin');
      } else {
        validationErrors.push({
          field: 'pin',
          message: check.error ?? 'PIN must be exactly 4 digits.',
          received: raw,
        });
      }
    }

    // 4. Full Name (zero-filler colloquial normalizer!)
    if (!draft.full_name || allowOverwrite.has('full_name')) {
      const hasNameCue =
        /(?:mera\s+naam|my\s+name\s+is|i\s+am|name\s*:|bol\s+raha|bol\s+rahi|میرا نام|میرا ناں|منهنجو نالو|زما نوم|منی نام)/i.test(
          raw,
        );
      if (hasNameCue || (expectedField === 'full_name' && updated.length === 0 && validationErrors.length === 0)) {
        const cleaned = cleanColloquialFullName(raw);
        if (cleaned) {
          const check = validateFullName(cleaned);
          if (check.valid && check.value) {
            draft.full_name = check.value;
            updated.push('full_name');
          } else {
            validationErrors.push({
              field: 'full_name',
              message: check.error ?? 'Full name must be 3–80 alphabetic characters.',
              received: cleaned,
            });
          }
        } else if (expectedField === 'full_name' && raw.length > 0 && updated.length === 0) {
          const rawCheck = validateFullName(raw);
          if (!rawCheck.valid) {
            validationErrors.push({
              field: 'full_name',
              message: rawCheck.error ?? 'Full name must be 3–80 alphabetic characters.',
              received: raw,
            });
          }
        }
      }
    }

    return updated;
  }

  private extractReliefFieldsStrict(
    transcript: string,
    state: VoiceSessionFormState,
    expectedField: string | undefined,
    allowOverwrite: Set<string>,
    validationErrors: AgentValidationError[],
  ): string[] {
    const ascii = toAsciiDigits(transcript).trim();
    if (!ascii) return [];

    const patch: Partial<VoiceSessionFormState> = {};

    // 1. CNIC / Mock ID
    const mockIdMatch =
      ascii.match(/MOCK-ID-\d{3,6}/i) ?? ascii.match(/\b(\d{5}-\d{7}-\d)\b/) ?? ascii.match(/\b(\d{13})\b/);
    if (mockIdMatch?.[0]) {
      const rawId = mockIdMatch[0].toUpperCase();
      patch.cnic = /^\d{13}$/.test(rawId)
        ? `${rawId.slice(0, 5)}-${rawId.slice(5, 12)}-${rawId.slice(12)}`
        : rawId;
    } else if (!state.cnic && /\b(1001|1002|1003|1004)\b/.test(ascii)) {
      const num = ascii.match(/\b(1001|1002|1003|1004)\b/)?.[1];
      if (num) patch.cnic = `MOCK-ID-${num}`;
    }

    // 2. District (negation-aware zero-filler extraction!)
    const cleanDist = cleanColloquialDistrict(ascii, state.district);
    if (cleanDist) {
      patch.district = cleanDist;
    }
    if (!patch.district) {
      const romanFromMatch = ascii.match(
        /\b(?:main|mein|i am from|i live in)\s+([A-Za-z]{3,25})\s+(?:se\s+hoon|mein\s+rehta|mein\s+rehti)\b/i,
      );
      if (romanFromMatch?.[1]) {
        const city = romanFromMatch[1].trim();
        const check = validateDistrict(city);
        if (check.valid && check.value) {
          patch.district = check.value.charAt(0).toUpperCase() + check.value.slice(1).toLowerCase();
        }
      }
    }
    // Also handle "change district to <City>" / "district edit karke <City> kar do"
    if (!patch.district && allowOverwrite.has('district')) {
      const editDistMatch = ascii.match(
        /(?:district|city|zila|shehar)\s*(?:edit|change|update|badal|karke|to|kar\s+ke|\s)+([A-Za-z]{2,30})(?:\s+kar\s+do|\s+kar\s+dein|$)/i,
      );
      if (editDistMatch?.[1]) {
        const check = validateDistrict(editDistMatch[1].trim());
        if (check.valid && check.value) {
          patch.district = check.value.charAt(0).toUpperCase() + check.value.slice(1).toLowerCase();
        }
      }
    }

    // 3. Name (zero-filler!)
    if (/(?:mera\s+naam|my\s+name\s+is|i\s+am|name\s*:|muhinjo\s+nalo|zama\s+num|mera\s+naa|میرا نام|میرا ناں|منهنجو نالو|زما نوم|منی نام)/i.test(ascii)) {
      const cleanName = cleanColloquialFullName(transcript);
      if (
        cleanName &&
        !/^(dadu|multan|lahore|sukkur|peshawar|quetta|karachi|hyderabad)$/i.test(cleanName)
      ) {
        patch.name = cleanName;
      }
    }

    // 4. Household Size
    const hhMatch =
      ascii.match(/(\d{1,2})\s*(?:members|people|persons|افراد|جی|ڀاتي|کسان|مردم|بچے)/i) ??
      ascii.match(/(?:household|family|گھر میں|گهر ۾)\s*(\d{1,2})/i);
    if (hhMatch?.[1]) {
      const hh = Number(hhMatch[1]);
      if (hh >= 1 && hh <= 30) patch.household_size = hh;
    }

    // 5. Monthly Income & Requested Amount (with STRICT range validation & full Pakistani colloquial numbers!)
    const asciiWithoutIds = ascii
      .replace(/MOCK-ID-\d+/gi, ' ')
      .replace(/\b\d{5}-\d{7}-\d\b/g, ' ')
      .replace(/\b\d{13}\b/g, ' ')
      .replace(/(?:\+?92|0)3\d{9}\b/g, ' ')
      .replace(/(\d),(\d)/g, '$1$2');

    const incomeLabeled = asciiWithoutIds.match(
      /(?:income|amdani|amdan|kamai|salary|آمدنی|آمدني|عاید)\s*(?:is|hai|he|to|karke|taqreeban|lag\s+bhag|koi|اے|آهي|دی|تقریباً|:)?\s*(-?\d+(?:\.\d+)?)\s*(hazaar|hazar|thousand|ہزار|هزار|k)?/i,
    );
    const amountLabeled = asciiWithoutIds.match(
      /(?:amount|requested|grant|imdad|raqam|رقم|چاہیے|chahiye|need)\s*(?:is|of|hai|to|karke|rupay|pkr|:)?\s*(-?\d+(?:\.\d+)?)\s*(hazaar|hazar|thousand|ہزار|هزار|k)?|(-?\d+(?:\.\d+)?)\s*(hazaar|hazar|thousand|ہزار|هزار|k)?\s*(?:pkr|rupay|rupees|روپے|رپيا|روپۍ)?\s*(?:chahiye|needed|imdad|relief|grant|چاہیے|گهرجي)/i,
    );

    if (incomeLabeled?.[1]) {
      let v = Number(incomeLabeled[1]);
      if (incomeLabeled[2] && v > 0 && v <= 99) v *= 1000;
      const check = validateMonthlyIncome(v);
      if (check.valid && check.value !== undefined) {
        patch.monthly_income = check.value;
      } else {
        validationErrors.push({
          field: 'monthly_income',
          message: check.error ?? 'Monthly income must be between 0 and 500,000 PKR.',
          received: String(v),
        });
      }
    }

    const amtRaw = amountLabeled?.[1] ?? amountLabeled?.[3];
    const amtMult = amountLabeled?.[2] ?? amountLabeled?.[4];
    if (amtRaw) {
      let v = Number(amtRaw);
      if (amtMult && v > 0 && v <= 99) v *= 1000;
      const check = validateRequestedAmount(v);
      if (check.valid && check.value !== undefined) {
        patch.amount = check.value;
      } else {
        validationErrors.push({
          field: 'amount',
          message: check.error ?? 'Requested amount must be between 500 and 100,000 PKR.',
          received: String(v),
        });
      }
    }

    const allNums = [...asciiWithoutIds.matchAll(/(-\d+|\b\d{3,8}\b)/g)].map((m) => Number(m[1]));
    const parsedSpoken = parseColloquialPakistaniNumber(asciiWithoutIds) ?? parseSpokenSignedNumber(asciiWithoutIds);
    if (parsedSpoken !== null && !allNums.includes(parsedSpoken)) {
      allNums.unshift(parsedSpoken);
    }

    if (allNums.length > 0 && !incomeLabeled && !amtRaw) {
      const explicitIncomeWord = /\b(amdan|amdani|income|kamai|salary|mahana|آمدنی|آمدني|عاید)\b/i.test(asciiWithoutIds);
      const explicitAmountWord = /\b(amount|raqam|chahiye|need|grant|imdad|madad|رقم|چاہیے)\b/i.test(asciiWithoutIds);

      if (expectedField === 'amount' || (explicitAmountWord && !explicitIncomeWord && expectedField !== 'monthly_income')) {
        const val = allNums[0]!;
        const check = validateRequestedAmount(val);
        if (check.valid && check.value !== undefined) {
          patch.amount = check.value;
        } else {
          validationErrors.push({
            field: 'amount',
            message: check.error ?? 'Requested amount must be between 500 and 100,000 PKR.',
            received: String(val),
          });
        }
      } else if (
        expectedField === 'monthly_income' ||
        (explicitIncomeWord && !explicitAmountWord) ||
        (state.monthly_income === null && !expectedField)
      ) {
        const val = allNums[0]!;
        const check = validateMonthlyIncome(val);
        if (check.valid && check.value !== undefined) {
          patch.monthly_income = check.value;
        } else {
          validationErrors.push({
            field: 'monthly_income',
            message: check.error ?? 'Monthly income must be between 0 and 500,000 PKR.',
            received: String(val),
          });
        }
        if (allNums.length > 1 && state.amount === null) {
          const amtCheck = validateRequestedAmount(allNums[1]!);
          if (amtCheck.valid && amtCheck.value !== undefined) {
            patch.amount = amtCheck.value;
          } else {
            validationErrors.push({
              field: 'amount',
              message: amtCheck.error ?? 'Requested amount must be between 500 and 100,000 PKR.',
              received: String(allNums[1]),
            });
          }
        }
      } else if (state.amount === null) {
        const val = allNums[0]!;
        const check = validateRequestedAmount(val);
        if (check.valid && check.value !== undefined) {
          patch.amount = check.value;
        } else {
          validationErrors.push({
            field: 'amount',
            message: check.error ?? 'Requested amount must be between 500 and 100,000 PKR.',
            received: String(val),
          });
        }
      }
    }

    // 6. Reason (clean, zero-filler!)
    if (
      /flood|rain|house|damage|widow|medical|unemployed|food|ration|sailab|barish|ghar|deewar|chhat|tabah|سیلاب|بارش|مکان|گهر|بیوہ|بیماری|بے روزگار|راشن|امداد|ریلیف|مدد|مرسته|کمک|ٻوڏ|ہڑھ/i.test(
        ascii,
      )
    ) {
      if (expectedField === 'reason' || (ascii.split(/\s+/).length >= 4 && allowOverwrite.size === 0)) {
        const cleanRsn = cleanColloquialReason(transcript) ?? transcript;
        const check = validateReliefReason(cleanRsn);
        if (check.valid && check.value) {
          patch.reason = check.value;
        }
      }
      if (/flood|rain|sailab|barish|سیلاب|بارش|ٻوڏ|ہڑھ/i.test(ascii)) patch.category = 'flood_relief';
      else if (/widow|بیوہ/i.test(ascii)) patch.category = 'widow_support';
      else if (/medical|hospital|بیمار|علاج/i.test(ascii)) patch.category = 'medical_relief';
    }

    // 7. Verbal Consent Confirmation
    const isExplicitSubmitConsent =
      /\b(ijazat|submit|confirm|proceed|agree)\b/i.test(ascii) ||
      /(اجازت|جمع کر|سبمٹ|تصدیق|ها اجازت|هو اجازه|ہئو جمع)/.test(ascii);
    const isShortYes = /\b(haan|han|ji\s+haan|yes|ji)\b/i.test(ascii) || /(ہاں|جی ہاں|بلکل|ہئو)/.test(ascii);
    if (
      (isExplicitSubmitConsent || (expectedField === 'consent_confirmed' && isShortYes)) &&
      validationErrors.length === 0 &&
      allowOverwrite.size === 0
    ) {
      patch.consent_confirmed = true;
    }

    const mutated = monotonicMergeFormState(state, patch, allowOverwrite);

    // Context-aware direct slot mapping when answering expectedField
    if (validationErrors.length === 0) {
      if (expectedField === 'name' && (!state.name || allowOverwrite.has('name')) && !mutated.includes('name')) {
        const cleaned = ascii
          .replace(/^(?:السلام علیکم|جی|میرا نام|میرا ناں|منهنجو نالو|زما نوم|mera\s+naam|my\s+name\s+is|i\s+am)\s*/i, '')
          .replace(/\s*(?:ہے|اے|آهي|دی|hai|he|hoon)[۔.،]*$/i, '')
          .trim();
        const check = validateFullName(cleaned);
        if (check.valid && check.value) {
          mutated.push(...monotonicMergeFormState(state, { name: check.value }, allowOverwrite));
        }
      } else if (
        expectedField === 'district' &&
        (!state.district || allowOverwrite.has('district')) &&
        !mutated.includes('district')
      ) {
        const cleaned = ascii
          .replace(/^(?:میں|مان|زه|تسی|ضلع|شہر|ولسوالۍ|ضلعي|main|mein|i live in|i am from|from|district)\s*/i, '')
          .replace(/\s*(?:میں رہتا ہوں|میں رہتی ہوں|وچ رہندا آں|۾ رهان ٿو|کې اوسېږم|سے ہوں|se hoon)[۔.،]*$/i, '')
          .trim();
        const check = validateDistrict(cleaned);
        if (check.valid && check.value) {
          mutated.push(...monotonicMergeFormState(state, { district: check.value }, allowOverwrite));
        } else if (cleaned.length > 0) {
          validationErrors.push({
            field: 'district',
            message: check.error ?? 'District must be 2–50 alphabetic characters.',
            received: cleaned,
          });
        }
      } else if (
        expectedField === 'reason' &&
        (!state.reason || allowOverwrite.has('reason')) &&
        !mutated.includes('reason')
      ) {
        const check = validateReliefReason(transcript);
        if (check.valid && check.value) {
          mutated.push(...monotonicMergeFormState(state, { reason: check.value }, allowOverwrite));
        } else {
          validationErrors.push({
            field: 'reason',
            message: check.error ?? 'Relief reason must be at least 5 meaningful characters.',
            received: transcript,
          });
        }
      }
    }

    return mutated;
  }

  private isFormFieldFilled(state: VoiceSessionFormState, field: string): boolean {
    switch (field) {
      case 'name':
        return Boolean(state.name.trim());
      case 'cnic':
        return Boolean(state.cnic.trim());
      case 'district':
        return Boolean(state.district.trim());
      case 'monthly_income':
        return state.monthly_income !== null && Number.isFinite(state.monthly_income);
      case 'amount':
        return state.amount !== null && Number.isFinite(state.amount);
      case 'reason':
        return Boolean(state.reason.trim());
      case 'consent_confirmed':
        return state.consent_confirmed;
      default:
        return false;
    }
  }

  private getFormFieldRawValue(state: VoiceSessionFormState, field: string): string | number | boolean | null {
    switch (field) {
      case 'name':
        return state.name || null;
      case 'cnic':
        return state.cnic || null;
      case 'district':
        return state.district || null;
      case 'monthly_income':
        return state.monthly_income;
      case 'amount':
        return state.amount;
      case 'reason':
        return state.reason || null;
      case 'consent_confirmed':
        return state.consent_confirmed;
      default:
        return null;
    }
  }

  private applySemanticAuthFields(
    semanticNlu: SemanticTurnNluResult,
    draft: AgentAuthDraft,
    allowOverwrite: Set<string>,
    validationErrors: AgentValidationError[],
    onlyFields?: Set<string>,
  ): string[] {
    const updated: string[] = [];
    const order: Array<'full_name' | 'cnic' | 'phone' | 'pin'> = ['full_name', 'cnic', 'phone', 'pin'];

    for (const field of order) {
      if (onlyFields && !onlyFields.has(field)) continue;
      const entry = semanticNlu.extracted_fields[field];
      if (!entry || entry.confidence < 0.7) continue;

      if (field === 'full_name' && (!draft.full_name || allowOverwrite.has('full_name'))) {
        const cleaned = cleanColloquialFullName(String(entry.clean_value)) ?? String(entry.clean_value).trim();
        const check = validateFullName(cleaned);
        if (check.valid && check.value) {
          draft.full_name = check.value;
          updated.push('full_name');
        } else {
          validationErrors.push({
            field: 'full_name',
            message: check.error ?? 'Full name must be 3–80 alphabetic characters.',
            received: cleaned,
          });
        }
      } else if (field === 'cnic' && (!draft.cnic || allowOverwrite.has('cnic'))) {
        const check = validateStrictCnic13(String(entry.clean_value));
        if (check.valid && check.value) {
          draft.cnic = check.value;
          updated.push('cnic');
        } else {
          validationErrors.push({
            field: 'cnic',
            message: check.error ?? 'CNIC must be exactly 13 digits.',
            received: String(entry.clean_value),
          });
        }
      } else if (field === 'phone' && (!draft.phone || allowOverwrite.has('phone'))) {
        const check = validatePakistaniPhone(String(entry.clean_value));
        if (check.valid && check.value) {
          draft.phone = check.value;
          updated.push('phone');
        } else {
          validationErrors.push({
            field: 'phone',
            message: check.error ?? 'Invalid Pakistani mobile number.',
            received: String(entry.clean_value),
          });
        }
      } else if (field === 'pin' && (!draft.pin || allowOverwrite.has('pin'))) {
        const check = validatePin4(String(entry.clean_value));
        if (check.valid && check.value) {
          draft.pin = check.value;
          updated.push('pin');
        } else {
          validationErrors.push({
            field: 'pin',
            message: check.error ?? 'PIN must be exactly 4 digits.',
            received: String(entry.clean_value),
          });
        }
      }
    }
    return updated;
  }

  private applySemanticReliefFields(
    semanticNlu: SemanticTurnNluResult,
    state: VoiceSessionFormState,
    allowOverwrite: Set<string>,
    validationErrors: AgentValidationError[],
    onlyFields?: Set<string>,
  ): string[] {
    const patch: Partial<VoiceSessionFormState> = {};
    const orderedFields = ['name', 'cnic', 'district', 'monthly_income', 'amount', 'reason', 'consent_confirmed'] as const;

    for (const field of orderedFields) {
      if (onlyFields && !onlyFields.has(field)) continue;
      const entry = semanticNlu.extracted_fields[field];
      if (!entry || entry.confidence < 0.7) continue;

      if (field === 'name') {
        const cleaned = cleanColloquialFullName(String(entry.clean_value)) ?? String(entry.clean_value).trim();
        const check = validateFullName(cleaned);
        if (check.valid && check.value) {
          patch.name = check.value;
        }
      } else if (field === 'cnic') {
        const raw = String(entry.clean_value).trim();
        if (/^MOCK-ID-\d{3,6}$/i.test(raw)) {
          patch.cnic = raw.toUpperCase();
        } else {
          const check = validateStrictCnic13(raw);
          if (check.valid && check.value) {
            patch.cnic = check.value;
          }
        }
      } else if (field === 'district') {
        const raw = String(entry.clean_value).trim();
        const check = validateDistrict(raw);
        if (check.valid && check.value) {
          patch.district = check.value;
        } else {
          validationErrors.push({
            field: 'district',
            message: check.error ?? 'District must be 2–50 alphabetic characters.',
            received: raw,
          });
        }
      } else if (field === 'monthly_income') {
        const num =
          typeof entry.clean_value === 'number'
            ? entry.clean_value
            : parseColloquialPakistaniNumber(String(entry.clean_value));
        if (num !== null && Number.isFinite(num)) {
          const check = validateMonthlyIncome(num);
          if (check.valid && check.value !== undefined) {
            patch.monthly_income = check.value;
          } else {
            validationErrors.push({
              field: 'monthly_income',
              message: check.error ?? 'Monthly income must be between 0 and 500,000 PKR.',
              received: String(num),
            });
          }
        }
      } else if (field === 'amount') {
        const num =
          typeof entry.clean_value === 'number'
            ? entry.clean_value
            : parseColloquialPakistaniNumber(String(entry.clean_value));
        if (num !== null && Number.isFinite(num)) {
          const check = validateRequestedAmount(num);
          if (check.valid && check.value !== undefined) {
            patch.amount = check.value;
          } else {
            validationErrors.push({
              field: 'amount',
              message: check.error ?? 'Requested amount must be between 500 and 100,000 PKR.',
              received: String(num),
            });
          }
        }
      } else if (field === 'reason') {
        const cleaned = cleanColloquialReason(String(entry.clean_value)) ?? String(entry.clean_value).trim();
        const check = validateReliefReason(cleaned);
        if (check.valid && check.value) {
          patch.reason = check.value;
          if (/flood|rain|sailab|barish|سیلاب|بارش|ٻوڏ|ہڑھ/i.test(check.value)) patch.category = 'flood_relief';
          else if (/widow|بیوہ/i.test(check.value)) patch.category = 'widow_support';
          else if (/medical|hospital|بیمار|علاج/i.test(check.value)) patch.category = 'medical_relief';
        }
      } else if (field === 'consent_confirmed' && entry.clean_value === true && allowOverwrite.size === 0 && validationErrors.length === 0) {
        patch.consent_confirmed = true;
      }
    }

    return monotonicMergeFormState(state, patch, allowOverwrite);
  }

  private buildSemanticNluAuditSummary(
    nlu: SemanticTurnNluResult,
  ): NonNullable<AgentReasoningAuditLogRecord['semantic_nlu_summary']> {
    const cleanExtracted: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(nlu.extracted_fields)) {
      cleanExtracted[k] = v.clean_value;
    }
    return {
      parser_mode: nlu.parser_mode,
      primary_intent: nlu.primary_intent,
      target_field: nlu.target_field,
      is_user_dissatisfied: nlu.is_user_dissatisfied_with_filled_value,
      extracted_clean_values: cleanExtracted,
      reasoning_summary: nlu.reasoning_summary,
    };
  }

  /**
   * Autonomous Cognitive Loop (Plan -> RBAC Guard -> Capability Check -> Act -> Self-Reflect -> Audit)
   */
  async processTurn(input: {
    sessionId?: string;
    audioBuffer?: Buffer;
    audioMimeType?: string;
    transcript?: string;
    languageHint?: LanguageCode;
    languageExplicitSwitch?: boolean;
    workflowStageHint?: AgentWorkflowStage;
    imageBase64?: string;
    imageMimeType?: string;
    docType?: string;
    synthesizeAudio?: boolean;
    clientFormState?: Partial<VoiceSessionFormState>;
    isTelephonyMode?: boolean;
    auth?: AuthContext;
  }): Promise<VoiceSessionTurnResult> {
    const orgId = input.auth?.organizationId ?? DEFAULT_ORG_IDS.RELIEF_DEMO;
    const initialStage: AgentWorkflowStage =
      input.workflowStageHint ?? (input.auth ? 'AGENT_HUB' : 'LANGUAGE_SELECT');
    const memory = await this.loadOrCreateMemory(
      input.sessionId,
      orgId,
      input.languageHint ?? 'ur',
      initialStage,
      input.auth,
    );

    const formState = this.hydrateFormState(memory, input.clientFormState);
    const prevFormSnapshot = structuredClone(formState);
    const turnMcpCalls: McpToolCallRecord[] = [];
    const reasoningSteps: string[] = [];
    const validationErrors: AgentValidationError[] = [];
    let uiAction: VoiceUiAction = 'UPDATE_FORM';
    let navigateTo: VoiceNavigateTarget = null;
    let memoryAction: 'NONE' | 'SAVED' | 'SUSPEND_TASK' | 'RESUME_TASK' | 'CLEARED' = 'NONE';
    let memorySummary = 'No working memory state mutation.';
    let capabilityCheck: 'IN_SCOPE' | 'OUT_OF_SCOPE_ESCALATED' = 'IN_SCOPE';
    let accessControlDecision: AgentReasoningAuditLogRecord['access_control_decision'] = {
      decision: 'ALLOWED',
      actor_role: input.auth?.role ?? 'unauthenticated',
      authenticated: Boolean(input.auth),
      rule_reason: input.auth
        ? `Authenticated ${input.auth.role} (${input.auth.userId}) verified within tenant ${orgId}.`
        : 'Public onboarding / informational tool allowed prior to authentication.',
    };
    let intentDetected = 'open_greeting';
    let moodOrContextSwitch = 'neutral';
    let replyText = '';
    let sessionEnded = false;
    let scamAlert: unknown;
    let policyAnswer: unknown;
    let authSessionOut: VoiceSessionTurnResult['auth_session'];
    let escalationOut: VoiceSessionTurnResult['escalation'];
    let applicationsStatusOut: CitizenApplicationStatusSummary[] | undefined;
    let officerInquiriesOut: OfficerInquiryRecord[] | undefined;
    let officerInquiryCreatedOut: OfficerInquiryRecord | null | undefined;
    let retrievedRagMatches: RetrievedNluRagMatch[] = [];
    let learnedMemorySaved: AgentReasoningAuditLogRecord['learned_memory_saved'] = null;
    let semanticNluSummary: AgentReasoningAuditLogRecord['semantic_nlu_summary'] = null;
    const turnFieldsTouched: string[] = [];

    const wantAudio = input.synthesizeAudio ?? true;

    // 1. Speech-to-Text locked strictly to locked_language once set (breaks Urdu -> English STT trap!)
    let transcript = (input.transcript ?? '').trim();
    let whisperDetectedLang: LanguageCode | undefined;
    if (input.audioBuffer && input.audioBuffer.length > 0 && !transcript) {
      const sttLang = memory.locked_language ?? memory.detected_language ?? input.languageHint ?? 'ur';
      const stt = await this.deps.voiceProvider.transcribe({
        audio: input.audioBuffer,
        language: sttLang,
        mimeType: input.audioMimeType ?? 'audio/webm',
        autoDetect: !memory.language_locked,
      });
      transcript = stt.text.trim();
      whisperDetectedLang = stt.detected_language;
    }

    const pendingToolCalls: PlannedMcpToolCall[] = [];
    let plannedAction = 'respond_directly';

    const graphOut = await this.langGraphAgent.invokeTurn({
      session_id: memory.session_id,
      organization_id: orgId,
      citizen_id: memory.citizen_id,
      user_role: input.auth?.role ?? 'unauthenticated',
      auth_token_present: Boolean(input.auth),
      workflow_stage: memory.workflow_stage,
      active_task: memory.active_task,
      locked_language: memory.locked_language ?? memory.detected_language,
      messages: memory.conversation_window ?? [],
      user_input: transcript,
      form_state: formState,
      auth_draft: memory.auth_draft,
      field_provenance: memory.field_provenance ?? {},
      field_fill_history: memory.field_fill_history ?? [],
      editing_field: memory.editing_field ?? null,
      suspended_tasks: memory.suspended_tasks ?? [],
      hooks: {
        memory,
        prevFormSnapshot,
        auth: input.auth,
        uiLanguageHint: input.languageHint,
        uiExplicitSwitch: input.languageExplicitSwitch,
        whisperDetectedLanguage: whisperDetectedLang,
        isTelephonyMode: input.isTelephonyMode,
        imageBase64: input.imageBase64,
        imageMimeType: input.imageMimeType,
        docType: input.docType,
        buildLocalizedFallbackReply: (fallbackLang) => {
          if (memory.workflow_stage === 'RELIEF_FORM') {
            const nextM = memory.editing_field ?? computeMissingFields(formState)[0] ?? 'district';
            return localizedReliefQuestion(fallbackLang, nextM, formState);
          }
          if (memory.workflow_stage === 'HOME_WELCOME' || memory.workflow_stage === 'ROLE_IDENTIFICATION') {
            return localizedHomeWelcome(fallbackLang);
          }
          return localizedOpenHubGreeting(fallbackLang, input.auth?.displayName ?? formState.name ?? 'Citizen');
        },
        runDomainPlanner: async ({ lockedLanguage, isPureLanguageSwitch }): Promise<PlannerTurnOutcome> => {
          const lang = lockedLanguage;
          reasoningSteps.push(
            `Step 1 [Hard Language Lock]: locked_language='${lang}', workflow_stage='${memory.workflow_stage}', active_task='${memory.active_task}', editing_field='${memory.editing_field ?? 'none'}', suspended_tasks=${memory.suspended_tasks.length}.`,
          );

          // 3. Multimodal Document / Scam Screenshot Upload via Real MCP SDK Client
          if (input.imageBase64) {
            intentDetected = 'multimodal_document_scan';
            plannedAction = 'extract_document_info';
            const docCall = await this.mcpClient.callToolViaProtocol(
              'extract_document_info',
              {
                image_base64: input.imageBase64,
                doc_type: input.docType ?? 'mock_identity_document',
                mime_type: input.imageMimeType ?? 'image/png',
              },
              input.auth,
            );
            turnMcpCalls.push(docCall);
            const docRes = docCall.result as Record<string, unknown> | null;
            if (docRes?.scam_analysis) {
              scamAlert = docRes.scam_analysis;
              uiAction = 'SHOW_SCAM_ALERT';
              replyText =
                lang === 'en'
                  ? 'Caution! The uploaded screenshot shows scam indicators. Never share OTPs or pay any relief fee.'
                  : 'خبردار! اپ لوڈ کیے گئے اسکرین شاٹ میں فراڈ کے آثار ہیں۔ کبھی بھی OTP کوڈ یا کوئی فیس نہ دیں۔';
            } else if (docRes?.extracted_fields && typeof docRes.extracted_fields === 'object') {
              const ef = docRes.extracted_fields as Record<string, unknown>;
              const mutated = monotonicMergeFormState(formState, {
                name: typeof ef.full_name === 'string' ? ef.full_name : undefined,
                cnic: typeof ef.mock_identity_reference === 'string' ? ef.mock_identity_reference : undefined,
                district: typeof ef.district === 'string' ? ef.district : undefined,
                monthly_income: typeof ef.monthly_income === 'number' ? ef.monthly_income : undefined,
                household_size: typeof ef.household_size === 'number' ? ef.household_size : undefined,
              });
              for (const f of mutated) pushFillHistory(memory.field_fill_history!, f);
              memoryAction = 'SAVED';
              memorySummary = 'Populated form draft fields from multimodal document extraction.';
            }
          }

          // 4. Greeting Turn OR Instant UI Language Sync Turn (No transcript & no image)
          if (!transcript && !input.imageBase64) {
            intentDetected = input.languageExplicitSwitch ? 'ui_language_sync' : 'open_greeting';
            plannedAction = intentDetected;
            if (memory.workflow_stage === 'HOME_WELCOME' || memory.workflow_stage === 'ROLE_IDENTIFICATION') {
              replyText = localizedHomeWelcome(lang);
              uiAction = 'STAY_HOME';
            } else if (memory.workflow_stage === 'LANGUAGE_SELECT') {
              replyText =
                lang === 'en'
                  ? 'Assalam-o-Alaikum! Welcome to Amaanat Awaaz Saathi. Speak your language (English, Urdu, Sindhi, Punjabi, Pashto, Balochi) to begin automatically.'
                  : localizedHomeWelcome(lang);
            } else if (memory.workflow_stage === 'CITIZEN_ACCOUNT_CHECK') {
              replyText = localizedCitizenAccountCheck(lang, Boolean(memory.auth_draft.wants_account_question_asked));
              uiAction = 'STAY_HOME';
            } else if (memory.workflow_stage === 'AUTH_GATE') {
              if (memory.auth_draft.mode === 'login') {
                replyText = localizedGoingToLogin(lang, memory.auth_draft.target_role);
                uiAction = 'NAVIGATE_LOGIN';
              } else if (memory.auth_draft.mode === 'signup') {
                const nextAuth = computeMissingAuthSignupFields(memory.auth_draft)[0] ?? 'full_name';
                replyText = localizedAuthSignupQuestion(lang, nextAuth, memory.auth_draft);
                uiAction = 'NAVIGATE_SIGNUP';
              } else {
                replyText = localizedAuthGateAskMode(lang);
                uiAction = 'NAVIGATE_AUTH';
              }
            } else if (memory.workflow_stage === 'AGENT_HUB') {
              replyText = localizedOpenHubGreeting(lang, input.auth?.displayName ?? formState.name ?? 'Citizen');
              uiAction = 'NAVIGATE_HUB';
            } else {
              const nextMissing = memory.editing_field ?? computeMissingFields(formState)[0] ?? 'district';
              replyText = localizedReliefQuestion(lang, nextMissing, formState);
            }
            reasoningSteps.push(
              `Step 2 [${input.languageExplicitSwitch ? 'Instant Language Sync' : 'Greeting'}]: Emitted '${lang}' prompt for stage '${memory.workflow_stage}' without resetting state.`,
            );
          } else if (transcript) {
            memory.conversation_history.push({ role: 'user', text: transcript, timestamp: new Date().toISOString() });
            if (memory.conversation_history.length > 40) {
              memory.conversation_history = memory.conversation_history.slice(-40);
            }

            if (/\b(ruko|stop|wait|pehle|urgent|jaldi|رکو|پہلے|فوراً)\b/i.test(transcript)) {
              moodOrContextSwitch = 'interruption_urgent';
            } else if (/\b(ghalat|galat|wrong|angry|unfair|complaint|غلط|شکایت)\b/i.test(transcript)) {
              moodOrContextSwitch = 'frustrated';
            } else if (/\b(scam|fake|fraud|فراڈ|جعلی)\b/i.test(transcript)) {
              moodOrContextSwitch = 'anxious_scam_concern';
            }

            // --- INTENT DETECTION SIGNALS ---
            const isScamIntent =
              /scam|fake|fraud|phishing|lottery|8171.*(?:fee|otp|500|rupay)|otp.*(?:share|fee|500|policy)|فراڈ|جعلی|انعام|لاٹری|کوڈ مانگ|فیس مانگ|اسکیم/i.test(
                transcript,
              );
            const isPolicyIntent =
              /\b(who is eligible|income limit|what documents|policy|rules|eligibility)\b/i.test(transcript) ||
              /(کون اہل ہے|کتنی آمدنی والا|کون سے کاغذات|پالیسی کیا ہے|اہلیت کیا ہے)/.test(transcript);
            const isStatusIntent =
              /\b(claim\s+status|check\s+status|status\s+check|mera\s+status|meri\s+status|application\s+status|application\s+ka\s+status|my\s+status|my\s+applications?|track\s+claim|status\s+batao|AWZ-[A-Z0-9]+)\b/i.test(
                transcript,
              ) || /(درخواست کا اسٹیٹس|درخواست کی حیثیت|اسٹیٹس بتائیں|اسٹیٹس بتاؤ|اسٹیٹس چیک|حالت بتائیں)/.test(transcript);

            const isCheckOfficerReplyIntent =
              /\b(officer\s+ka\s+jawab|officer\s+ne\s+kya\s+jawab|officer\s+reply|officer\s+replied|officer\s+messages?|did\s+officer\s+reply|afsar\s+ka\s+jawab|jawab\s+aaya)\b/i.test(
                transcript,
              ) || /(افسر کا جواب|افسر نے کیا جواب|آفیسر کا جواب|جواب آیا)/.test(transcript);

            const isAskOfficerIntent =
              !isCheckOfficerReplyIntent &&
              (/\b((?:direct\s+)?(?:department\s+)?officer\s+se\s+(?:pooch\w*|puch\w*|sawal)|ask\s+(?:a\s+)?(?:department\s+)?officer|officer\s+ko\s+sawal|message\s+(?:department\s+)?officer|department\s+officer\s+se\s+sawal)\b/i.test(
                transcript,
              ) ||
                /(محکمہ افسر سے پوچھ|افسر سے پوچھ|آفیسر سے پوچھ|افسر کو سوال)/.test(transcript));

            const outOfScopeDraft = isAskOfficerIntent ? null : detectOutOfScopeEscalation(transcript);

            const isSpokenStopCmd =
              /\b(bas\s+ruko|ruko\s+abhi|chup\s+ho\s+jao|chup\s+karo|stop\s+listening|stop\s+talking|pause\s+voice|be\s+quiet|abhi\s+baat\s+nahi\s+karni|baat\s+nahi\s+karni)\b/i.test(
                transcript,
              ) || /(بس رکو|چپ ہو جاؤ|بات نہیں کرنی|ابھی بات نہیں کرنی|رک جاؤ|خاموش)/.test(transcript);

            const isConfirmYes =
              /\b(haan|han|yes|ji|confirm|forward|bhej\s+dein|send\s+it|ok|theek|sure|bilkul|bana\s+hua|submit)\b/i.test(
                transcript,
              ) || /(ہاں|جی ہاں|فارورڈ|بھیج دیں|ٹھیک ہے|بلکل|ها|هو|ہئو|سبمٹ)/.test(transcript);
            const isConfirmNo =
              /\b(nahi|nahin|no|nope|na\b|naa\b|not\s+yet|not\s+created|isn'?t\s+created|is\s+not\s+created|haven'?t\s+created|nahi\s+bana|bana\s+nahi|bna\s+nahi|account\s+nahi|no\s+account|don'?t\s+have|do\s+not\s+have|don'?t\s+create|mat\s+banao|rehne\s+do)\b/i.test(
                transcript,
              ) || /(نہیں|نه|نہ|نہیں بنا|بنا نہیں|اکاؤنٹ نہیں|مت بناؤ|رہنے دو)/.test(transcript);

            const isResumeIntent =
              memory.suspended_tasks.length > 0 &&
              (/\b(wapis|resume|continue|mukammal|complete|form|application|submit|haan|yes|ji)\b/i.test(transcript) ||
                /(واپس|مکمل|فارم|درخواست|سبمٹ|ہاں|جی)/.test(transcript));
            const isStartReliefIntent =
              /\b(apply\s+for\s+relief|relief\s+application|relief\s+claim|relief\s+form|form\s+fill|imdad\s+ki\s+darkhwast|darkhwast\s+deni|want\s+to\s+apply|new\s+claim|form\s+bharna)\b/i.test(
                transcript,
              ) || /(ریلیف کی درخواست|امداد کی درخواست|فارم بھرنا|امداد کے لیے درخواست)/.test(transcript);

            // PHASE 1: SPOKEN HARD-STOP / STANDBY COMMAND (works across EVERY stage without resetting state!)
            if (isSpokenStopCmd) {
              intentDetected = 'voice_pause_command';
              plannedAction = 'pause_voice_agent';
              uiAction = 'PAUSE_VOICE_AGENT';
              memoryAction = 'NONE';
              memorySummary = 'User requested voice pause via spoken stop command; entering IDLE_STOPPED standby while preserving session.';
              reasoningSteps.push(
                'Step 2 [Voice Standby]: Detected spoken stop command; locking voice agent into IDLE_STOPPED without losing session state.',
              );
              replyText = localizedVoicePaused(lang);
            }

            // MODULE 4 (CHALLENGE 06): VOICE CONSENT STATUS / WITHDRAWAL / AI CONSENT ENFORCEMENT GUARD
            else if (
              input.auth?.role === 'citizen' &&
              this.deps.consentEnforcementService &&
              (/\b(withdraw\s+(?:my\s+)?consent|revoke\s+consent|take\s+back\s+my\s+data|ijazat\s+wapis|consent\s+wapis)\b/i.test(
                transcript,
              ) ||
                /(اجازت واپس|ڈیٹا واپس)/.test(transcript))
            ) {
              intentDetected = 'withdraw_all_consent';
              const call = await this.mcpClient.callToolViaProtocol('withdraw_all_consent', {}, input.auth);
              turnMcpCalls.push(call);
              uiAction = 'NAVIGATE_HUB';
              memoryAction = 'SAVED';
              memorySummary = 'Citizen withdrew all data-sharing consent via voice; Officer & AI access immediately revoked.';
              reasoningSteps.push('Step 2 [Consent Revocation]: Executed withdraw_all_consent MCP tool.');
              replyText =
                lang === 'en'
                  ? 'Your consent has been withdrawn immediately. Relief Officers and AI voice processing can no longer access your personal data until you re-enable consent in My Data & Consent.'
                  : 'آپ کی اجازت فوری طور پر واپس لے لی گئی ہے۔ اب کوئی بھی محکمہ افسر یا AI آپ کا ذاتی ڈیٹا نہیں دیکھ سکتا جب تک آپ دوبارہ اجازت نہ دیں۔';
            } else if (
              input.auth?.role === 'citizen' &&
              this.deps.consentEnforcementService &&
              !(await this.deps.consentEnforcementService.isAiProcessingAllowedForUser(orgId, input.auth.userId))
            ) {
              const wantsRegrant =
                /\b(grant\s+consent|re-?enable\s+consent|allow\s+ai|give\s+consent|ijazat\s+deta|dobara\s+ijazat)\b/i.test(
                  transcript,
                ) || /(دوبارہ اجازت|اجازت دیتا|اجازت دیتی)/.test(transcript);
              if (wantsRegrant) {
                await this.deps.consentEnforcementService.grantAllConsent(input.auth);
                intentDetected = 'consent_regranted';
                uiAction = 'NAVIGATE_HUB';
                replyText =
                  lang === 'en'
                    ? 'Thank you! Your data-sharing and AI processing consent has been restored. How may I help you today?'
                    : 'شکریہ! آپ کی ڈیٹا اور AI اجازت بحال کر دی گئی ہے۔ بتائیں میں آپ کی کیا مدد کر سکتا ہوں؟';
              } else {
                intentDetected = 'ai_blocked_consent_withdrawn';
                accessControlDecision = {
                  decision: 'DENIED',
                  actor_role: input.auth.role,
                  authenticated: true,
                  rule_reason: 'CONSENT_WITHDRAWN: Citizen revoked AI voice processing consent.',
                };
                await this.deps.consentEnforcementService.recordAccessBlocked({
                  auth: input.auth,
                  citizenId: memory.citizen_id ?? input.auth.userId,
                  operation: 'POST /voice/session (AI processing blocked)',
                });
                uiAction = 'NAVIGATE_HUB';
                reasoningSteps.push('Step 2 [Consent Guard]: Blocked AI personal-data processing because citizen withdrew consent.');
                replyText =
                  lang === 'en'
                    ? 'You withdrew data-sharing consent, so I cannot read or process your personal relief data right now. Open "My Data & Consent" or say "grant consent" whenever you want to restore access.'
                    : 'آپ نے ڈیٹا شیئرنگ کی اجازت واپس لے رکھی ہے، اس لیے میں آپ کی ذاتی معلومات پر کارروائی نہیں کر سکتا۔ دوبارہ شروع کرنے کے لیے "My Data & Consent" کھولیں یا "دوبارہ اجازت دیتا ہوں" کہیں۔';
              }
            }

            // INSTANT 1-TURN EXPLICIT LANGUAGE SWITCH COMMAND (preserves 100% of state across EVERY stage!)
            else if (isPureLanguageSwitch && memory.workflow_stage !== 'LANGUAGE_SELECT') {
              intentDetected = 'mid_conversation_language_switch';
              plannedAction = 'explicit_language_switch';
              memoryAction = 'SAVED';
              memorySummary = `Switched locked_language to '${lang}' immediately in 1 turn while preserving all fields & session state.`;
              reasoningSteps.push(`Step 2 [Explicit Language Switch]: Switched locked_language='${lang}' without resetting form_state or session_id.`);
              if (memory.workflow_stage === 'RELIEF_FORM') {
                const nextField = memory.editing_field ?? computeMissingFields(formState)[0] ?? 'district';
                replyText =
                  lang === 'en'
                    ? `Switched to English! All your saved details remain intact. ${localizedReliefQuestion('en', nextField, formState)}`
                    : `اردو زبان منتخب ہو گئی ہے! آپ کی تمام محفوظ معلومات بالکل محفوظ ہیں۔ ${localizedReliefQuestion(lang, nextField, formState)}`;
                uiAction = nextField === 'consent_confirmed' ? 'ASK_CONFIRMATION' : 'UPDATE_FORM';
              } else if (memory.workflow_stage === 'AUTH_GATE' && memory.auth_draft.mode === 'signup') {
                const nextAuth = computeMissingAuthSignupFields(memory.auth_draft)[0] ?? 'full_name';
                replyText = localizedAuthSignupQuestion(lang, nextAuth, memory.auth_draft);
                uiAction = 'NAVIGATE_SIGNUP';
              } else if (memory.workflow_stage === 'AUTH_GATE' && memory.auth_draft.mode === 'login') {
                replyText = localizedGoingToLogin(lang, memory.auth_draft.target_role);
                uiAction = 'NAVIGATE_LOGIN';
              } else if (memory.workflow_stage === 'AGENT_HUB') {
                replyText =
                  lang === 'en'
                    ? `Switched to English! ${localizedOpenHubGreeting('en', input.auth?.displayName ?? formState.name ?? 'Citizen')}`
                    : `جی بالکل، اب ہم اردو میں بات کریں گے! ${localizedOpenHubGreeting(lang, input.auth?.displayName ?? formState.name ?? 'Citizen')}`;
                uiAction = 'NAVIGATE_HUB';
              } else {
                replyText = localizedHomeWelcome(lang);
                uiAction = 'STAY_HOME';
              }
            }

            // A0. PHASE 2 — HOME SCREEN ROLE IDENTIFICATION (Supports compound "Main aam user hoon, account login karna hai"!)
            else if (
              (memory.workflow_stage === 'HOME_WELCOME' || memory.workflow_stage === 'ROLE_IDENTIFICATION') &&
              !input.auth &&
              !isScamIntent &&
              !isPolicyIntent
            ) {
              const isOfficerRole =
                /\b(department\s+officer|dept\s+officer|officer|afsar|mahkama|officer_hamza|officer_sana)\b/i.test(transcript) ||
                /(محکمہ افسر|افسر|آفیسر|کاتي جو آفيسر|د ادارې افسر)/.test(transcript);
              const isAdminRole =
                /\b(super\s+admin|admin|administrator|admin_ayesha|auditor_bilal)\b/i.test(transcript) ||
                /(سپر ایڈمن|ایڈمن|ايڊمن|مدیر)/.test(transcript);
              const isHelperRole =
                /\b(community\s+helper|helper|muawin|madadgar|helper_salma)\b/i.test(transcript) ||
                /(کمیونٹی معاون|معاون|مددگار|مرستیال)/.test(transcript);
              const isCitizenRole =
                /\b(aam\s+user|normal\s+user|normal\s+citizen|citizen|shahri|shehri|aam\s+shahri|public\s+user|citizen_zainab)\b/i.test(
                  transcript,
                ) || /(عام صارف|عام شہری|شہری|شهري|عادي وګړی|عادي کاروونکی)/.test(transcript);
              const wantsLoginInSameTurn =
                /\b(login|log\s*in|sign\s*in|account\s+login|login\s+karna)\b/i.test(transcript) ||
                /(لاگ ان)/.test(transcript);
              const wantsSignupInSameTurn =
                /\b(naya\s+account|new\s+account|create\s+account|sign\s*up|register|account\s+banana)\b/i.test(transcript) ||
                /(نیا اکاؤنٹ|اکاؤنٹ بنانا)/.test(transcript);

              if (isOfficerRole || isAdminRole || isHelperRole) {
                const targetRole: 'officer' | 'admin' | 'helper' = isOfficerRole
                  ? 'officer'
                  : isAdminRole
                    ? 'admin'
                    : 'helper';
                memory.auth_draft.target_role = targetRole;

                const creds = extractMixedCredentials(transcript);
                if (creds.identifier) memory.auth_draft.identifier = creds.identifier;
                if (creds.secret) memory.auth_draft.pin = creds.secret;

                if (memory.auth_draft.identifier && memory.auth_draft.pin) {
                  intentDetected = `role_selected_${targetRole}_login`;
                  memory.auth_draft.mode = 'login';
                  memory.workflow_stage = 'AUTH_GATE';
                  memory.active_task = 'auth_login';
                  plannedAction = 'execute_voice_login';
                  pendingToolCalls.push({
                    name: 'login_citizen_voice_account',
                    args: {
                      identifier: memory.auth_draft.identifier,
                      pin_or_password: memory.auth_draft.pin,
                    },
                  });
                } else if (wantsLoginInSameTurn && !isConfirmNo) {
                  intentDetected = `role_selected_${targetRole}_login`;
                  memory.auth_draft.mode = 'login';
                  memory.workflow_stage = 'AUTH_GATE';
                  memory.active_task = 'auth_login';
                  uiAction = 'NAVIGATE_LOGIN';
                  navigateTo = '/login';
                  memoryAction = 'SAVED';
                  memorySummary = `Identified '${targetRole}' explicitly requesting login; navigating to /login.`;
                  replyText = localizedGoingToLogin(lang, targetRole);
                } else if (isConfirmNo) {
                  intentDetected = 'role_no_account_ask_create';
                  memory.auth_draft.wants_account_question_asked = true;
                  memory.workflow_stage = 'CITIZEN_ACCOUNT_CHECK';
                  memory.active_task = 'role_routing';
                  uiAction = 'STAY_HOME';
                  navigateTo = null;
                  memoryAction = 'SAVED';
                  memorySummary = `Identified '${targetRole}' without account; asking explicit consent before signup.`;
                  replyText = localizedCitizenAccountCheck(lang, true);
                } else {
                  // Always ask whether their account is already created or not (same explicit consent flow as Citizen!)
                  intentDetected = `role_selected_${targetRole}`;
                  memory.auth_draft.wants_account_question_asked = false;
                  memory.workflow_stage = 'CITIZEN_ACCOUNT_CHECK';
                  memory.active_task = 'role_routing';
                  uiAction = 'STAY_HOME';
                  navigateTo = null;
                  memoryAction = 'SAVED';
                  memorySummary = `Identified '${targetRole}' on Home screen; asking whether account is already created before navigating.`;
                  reasoningSteps.push(
                    `Step 2 [Role Routing]: Identified '${targetRole}' role.`,
                    `Step 3 [Account Check]: Asking whether '${targetRole}' already has an account before navigating.`,
                  );
                  replyText = localizedCitizenAccountCheck(lang, false);
                }
              } else if (isCitizenRole) {
                memory.auth_draft.target_role = 'citizen';
                const creds = extractMixedCredentials(transcript);
                if (creds.identifier) memory.auth_draft.identifier = creds.identifier;
                if (creds.secret) memory.auth_draft.pin = creds.secret;

                if (wantsLoginInSameTurn || (memory.auth_draft.identifier && memory.auth_draft.pin)) {
                  intentDetected = 'role_selected_citizen_login';
                  memory.auth_draft.mode = 'login';
                  memory.workflow_stage = 'AUTH_GATE';
                  memory.active_task = 'auth_login';
                  if (memory.auth_draft.identifier && memory.auth_draft.pin) {
                    plannedAction = 'execute_voice_login';
                    pendingToolCalls.push({
                      name: 'login_citizen_voice_account',
                      args: {
                        identifier: memory.auth_draft.identifier,
                        pin_or_password: memory.auth_draft.pin,
                      },
                    });
                  } else {
                    uiAction = 'NAVIGATE_LOGIN';
                    navigateTo = '/login';
                    memoryAction = 'SAVED';
                    memorySummary = 'Identified Normal Citizen requesting account login; navigating directly to /login.';
                    replyText = localizedGoingToLogin(lang, 'citizen');
                  }
                } else if (wantsSignupInSameTurn && !isConfirmNo) {
                  intentDetected = 'role_selected_citizen_signup';
                  memory.auth_draft.mode = 'signup';
                  memory.workflow_stage = 'AUTH_GATE';
                  memory.active_task = 'auth_signup';
                  uiAction = 'NAVIGATE_SIGNUP';
                  navigateTo = '/signup';
                  memoryAction = 'SAVED';
                  memorySummary = 'Identified Normal Citizen requesting new voice account; navigating directly to /signup.';
                  replyText = localizedGoingToSignup(lang);
                } else if (isConfirmNo) {
                  // Citizen explicitly said they do NOT have an account yet -> ask explicit consent before creating!
                  intentDetected = 'citizen_no_account_ask_create';
                  memory.auth_draft.wants_account_question_asked = true;
                  memory.workflow_stage = 'CITIZEN_ACCOUNT_CHECK';
                  memory.active_task = 'role_routing';
                  uiAction = 'STAY_HOME';
                  memoryAction = 'SAVED';
                  memorySummary = 'Citizen stated they do not have an account; asking explicit consent before creating a new account.';
                  reasoningSteps.push(
                    `Step 2 [Role Routing]: Identified Normal Citizen without account.`,
                    `Step 3 [Explicit Consent]: Asking user to confirm before opening account creation.`,
                  );
                  replyText = localizedCitizenAccountCheck(lang, true);
                } else {
                  intentDetected = 'role_selected_citizen';
                  memory.auth_draft.wants_account_question_asked = false;
                  memory.workflow_stage = 'CITIZEN_ACCOUNT_CHECK';
                  memory.active_task = 'role_routing';
                  uiAction = 'STAY_HOME';
                  memoryAction = 'SAVED';
                  memorySummary = 'Identified Normal Citizen (Aam User); asking whether citizen already has an account.';
                  reasoningSteps.push(
                    `Step 2 [Role Routing]: Identified Normal Citizen ('citizen').`,
                    `Step 3 [Account Branching]: Asking whether citizen already has an account.`,
                  );
                  replyText = localizedCitizenAccountCheck(lang, false);
                }
              } else {
                intentDetected = 'home_role_clarify';
                uiAction = 'STAY_HOME';
                replyText = localizedHomeWelcome(lang);
              }
            }

      // A1. PHASE 2 — CITIZEN ACCOUNT BRANCHING (Has account? Yes -> /login | No -> Explicit consent to create? Yes -> /signup | No -> Return Home + Pause!)
      else if (memory.workflow_stage === 'CITIZEN_ACCOUNT_CHECK' && !input.auth && !isScamIntent && !isPolicyIntent) {
        const hasNegation =
          isConfirmNo ||
          /\b(not\s+created|isn'?t\s+created|is\s+not\s+created|haven'?t\s+created|no\s+account|account\s+nahi|nahi\s+bana|bana\s+nahi|bna\s+nahi|don'?t\s+have|do\s+not\s+have|don'?t\s+create|mat\s+banao|rehne\s+do|cancel)\b/i.test(
            transcript,
          ) ||
          /(نہیں بنا|بنا نہیں|اکاؤنٹ نہیں|کوئی اکاؤنٹ نہیں|نہیں بنانا|مت بناؤ|رہنے دو)/.test(transcript);

        const directSignupCmd =
          !hasNegation &&
          (/\b(naya\s+account|new\s+account|create\s+(?:a\s+)?(?:new\s+)?account|sign\s*up|register|account\s+banao|account\s+banana)\b/i.test(
            transcript,
          ) ||
            /(نیا اکاؤنٹ|اکاؤنٹ بنانا|نئون اڪائونٽ|نواں اکاؤنٹ|نوی حساب)/.test(transcript));

        const directLoginCmd =
          !hasNegation &&
          (/\b(login|log\s*in|sign\s*in|pehle\s+se\s+bana|bana\s+hua\s+hai|account\s+is\s+created|account\s+created|existing\s+account|already\s+have)\b/i.test(
            transcript,
          ) ||
            /(پہلے سے بنا|لاگ ان|موجودہ اکاؤنٹ|اکاؤنٹ بنا ہوا)/.test(transcript));

        const credsInCheck = extractMixedCredentials(transcript);
        if (credsInCheck.identifier && credsInCheck.secret) {
          intentDetected = 'account_check_direct_login';
          memory.auth_draft.mode = 'login';
          memory.auth_draft.identifier = credsInCheck.identifier;
          memory.auth_draft.pin = credsInCheck.secret;
          memory.workflow_stage = 'AUTH_GATE';
          memory.active_task = 'auth_login';
          plannedAction = 'execute_voice_login';
          pendingToolCalls.push({
            name: 'login_citizen_voice_account',
            args: {
              identifier: credsInCheck.identifier,
              pin_or_password: credsInCheck.secret,
            },
          });
        } else if (!memory.auth_draft.wants_account_question_asked) {
          // Step 1: Understand whether the user already has an account — NEVER jump straight to signup on a negative reply!
          if (hasNegation) {
            intentDetected = 'citizen_no_account_ask_create';
            memory.auth_draft.wants_account_question_asked = true;
            uiAction = 'STAY_HOME';
            memoryAction = 'SAVED';
            memorySummary = 'User stated they have no account; asking explicit consent before creating a new account.';
            reasoningSteps.push(
              `Step 2 [Account Branch B]: User has no account -> asking explicit consent ("Are you sure you want me to create a new account?").`,
            );
            replyText = localizedCitizenAccountCheck(lang, true);
          } else if (directLoginCmd || isConfirmYes) {
            // Branch A: Already has account -> /login
            intentDetected = 'citizen_has_account_login';
            memory.auth_draft.mode = 'login';
            memory.workflow_stage = 'AUTH_GATE';
            memory.active_task = 'auth_login';
            uiAction = 'NAVIGATE_LOGIN';
            navigateTo = '/login';
            memoryAction = 'SAVED';
            memorySummary = 'User confirmed existing account; auto-navigating to /login.';
            reasoningSteps.push(`Step 2 [Account Branch A]: Existing account confirmed -> NAVIGATE_LOGIN.`);
            replyText = localizedGoingToLogin(lang, memory.auth_draft.target_role ?? 'citizen');
          } else if (directSignupCmd) {
            // Even when user says "create account" directly here, ask explicit consent once unless already asked
            intentDetected = 'citizen_ask_create_consent';
            memory.auth_draft.wants_account_question_asked = true;
            uiAction = 'STAY_HOME';
            memoryAction = 'SAVED';
            memorySummary = 'Citizen mentioned new account; requesting explicit consent before opening signup.';
            reasoningSteps.push(`Step 2 [Account Branch B]: Asking explicit consent before creating a new account.`);
            replyText = localizedCitizenAccountCheck(lang, true);
          } else {
            intentDetected = 'citizen_account_clarify';
            uiAction = 'STAY_HOME';
            replyText = localizedCitizenAccountCheck(lang, false);
          }
        } else {
          // Step 2: Explicit consent question already asked ("Are you sure you want me to create a new account?")
          if (hasNegation) {
            intentDetected = 'citizen_decline_create_account';
            memory.workflow_stage = 'HOME_WELCOME';
            memory.active_task = 'idle';
            memory.auth_draft.wants_account_question_asked = false;
            memory.auth_draft.declined_signup = true;
            uiAction = 'PAUSE_VOICE_AGENT';
            navigateTo = '/';
            memoryAction = 'SAVED';
            memorySummary =
              'Citizen declined account creation consent; returning to Home screen (HOME_WELCOME) and pausing voice agent (IDLE_STOPPED).';
            reasoningSteps.push(
              `Step 2 [Account Branch B2]: Citizen declined account creation -> returning to '/' and emitting PAUSE_VOICE_AGENT so agent stops asking further.`,
            );
            replyText = localizedDeclinedSignup(lang);
          } else if (isConfirmYes || directSignupCmd) {
            intentDetected = 'citizen_confirm_create_account';
            memory.auth_draft.mode = 'signup';
            memory.auth_draft.declined_signup = false;
            memory.auth_draft.wants_account_question_asked = false;
            memory.workflow_stage = 'AUTH_GATE';
            memory.active_task = 'auth_signup';
            uiAction = 'NAVIGATE_SIGNUP';
            navigateTo = '/signup';
            memoryAction = 'SAVED';
            memorySummary = 'Citizen explicitly confirmed consent to create a new account; auto-navigating to /signup.';
            reasoningSteps.push(`Step 2 [Account Branch B1]: Explicit consent confirmed -> NAVIGATE_SIGNUP.`);
            replyText = localizedGoingToSignup(lang);
          } else {
            intentDetected = 'citizen_create_clarify';
            uiAction = 'STAY_HOME';
            replyText = localizedCitizenAccountCheck(lang, true);
          }
        }
      }

      // A2. LEGACY STAGE 1 — ZERO-TOUCH VOICE LANGUAGE SELECTION (Preserved for /citizen & Vitest!)
      else if (memory.workflow_stage === 'LANGUAGE_SELECT' && !input.auth && !isScamIntent && !isPolicyIntent) {
        intentDetected = 'language_select';
        memory.workflow_stage = 'AUTH_GATE';
        memory.active_task = 'auth_signup';
        uiAction = 'NAVIGATE_AUTH';
        memoryAction = 'SAVED';
        memorySummary = `Auto-detected language '${lang}' on Language screen and auto-navigated to Auth Gate.`;
        reasoningSteps.push(
          `Step 2 [RBAC]: Public language selection ALLOWED.`,
          `Step 3 [Plan & Act]: Locked language='${lang}' and emitted ui_action='NAVIGATE_AUTH' without button click.`,
        );
        replyText = localizedAuthGateAskMode(lang);
      }

      // B0. COMPOUND MULTI-TOOL TURN (e.g., "Mera status check karo aur scam OTP policy batao" -> runs multiple MCP tools via LangGraph node_mcp_tool_executor!)
      else if (input.auth && isStatusIntent && (isScamIntent || isPolicyIntent)) {
        intentDetected = 'compound_status_scam_policy';
        plannedAction = 'compound_status_scam_policy';
        const suspended = this.suspendActiveReliefTask(
          memory,
          formState,
          'Mid-form compound status + scam/policy check interruption',
        );
        if (suspended) {
          moodOrContextSwitch = 'mid_form_compound_interruption';
          memoryAction = 'SUSPEND_TASK';
          memorySummary = `Suspended active 'relief_form' draft (${summarizeFormDraftFields(formState, 'en')}) for compound status + scam/OTP policy check.`;
        }
        const refFilter = transcript.match(/AWZ-[A-Z0-9]+/i)?.[0];
        pendingToolCalls.push({
          name: 'get_my_applications_status',
          args: refFilter ? { reference_filter: refFilter } : {},
        });
        if (isScamIntent) {
          pendingToolCalls.push({
            name: 'check_suspicious_message',
            args: { message_text: transcript },
          });
        }
        if (isPolicyIntent) {
          pendingToolCalls.push({
            name: 'query_policy_rag',
            args: { question: transcript, language: lang },
          });
        }
      }

      // B. PUBLIC TOOLS ALLOWED AT ANY STAGE (Scam Check & Policy RAG) — WITH WORKING MEMORY SUSPEND!
      else if (isScamIntent) {
        intentDetected = 'scam_check';
        plannedAction = 'scam_check';
        const suspended = this.suspendActiveReliefTask(memory, formState, 'Mid-form scam SMS verification interruption');
        if (suspended) {
          moodOrContextSwitch = 'mid_form_interruption_scam_check';
          memoryAction = 'SUSPEND_TASK';
          memorySummary = `Suspended active 'relief_form' draft (${summarizeFormDraftFields(formState, 'en')}) to handle urgent scam SMS check.`;
          reasoningSteps.push(
            `Step 2 [Memory Interrupt]: Suspended active relief_form draft safely in agent_memory_sessions.`,
          );
        }
        pendingToolCalls.push({
          name: 'check_suspicious_message',
          args: { message_text: transcript },
        });
      } else if (isPolicyIntent) {
        intentDetected = 'policy_rag';
        plannedAction = 'policy_rag';
        const suspended = this.suspendActiveReliefTask(memory, formState, 'Mid-form policy RAG question');
        if (suspended) {
          moodOrContextSwitch = 'mid_form_interruption_policy_question';
          memoryAction = 'SUSPEND_TASK';
          memorySummary = `Suspended active 'relief_form' draft to answer policy question.`;
        }
        pendingToolCalls.push({
          name: 'query_policy_rag',
          args: { question: transcript, language: lang },
        });
      }

      // C. STAGE 2 — VOICE AUTH GATE (Signup & Login for Citizens AND Staff with Mixed-Language NLU + Rollback/Edit!)
      else if (memory.workflow_stage === 'AUTH_GATE' && !input.auth) {
        if (isStatusIntent || outOfScopeDraft || isStartReliefIntent || isAskOfficerIntent || isCheckOfficerReplyIntent) {
          intentDetected = isStatusIntent
            ? 'claim_status'
            : outOfScopeDraft
              ? 'out_of_scope_escalation'
              : isAskOfficerIntent
                ? 'ask_department_officer'
                : 'start_relief_form';
          accessControlDecision = {
            decision: 'DENIED',
            actor_role: 'unauthenticated',
            authenticated: false,
            rule_reason:
              'RBAC Guardrail: Protected actions (relief claims, personal claim status, officer messaging, human admin escalation) require an authenticated session.',
          };
          uiAction = memory.auth_draft.mode === 'login' ? 'NAVIGATE_LOGIN' : 'NAVIGATE_AUTH';
          reasoningSteps.push(`Step 2 [RBAC DENIED]: Blocked unauthenticated attempt for '${intentDetected}'.`);
          replyText =
            lang === 'en'
              ? 'For your privacy and security, please sign in or create your voice account first before accessing claims or personal records. Would you like me to create a new account or log you into an existing one?'
              : 'آپ کی سیکیورٹی اور پرائیویسی کے لیے درخواست جمع کرنے یا ریکارڈ دیکھنے سے پہلے اکاؤنٹ بنانا یا لاگ ان کرنا ضروری ہے۔ کیا میں آپ کا نیا اکاؤنٹ بنا دوں یا آپ پہلے سے موجود اکاؤنٹ میں لاگ ان کریں گے؟';
        } else {
          const hasAuthNegation =
            isConfirmNo ||
            /\b(not\s+created|isn'?t\s+created|is\s+not\s+created|haven'?t\s+created|no\s+account|account\s+nahi|nahi\s+bana|bana\s+nahi|bna\s+nahi|don'?t\s+have|do\s+not\s+have|don'?t\s+create|mat\s+banao|rehne\s+do|cancel)\b/i.test(
              transcript,
            ) ||
            /(نہیں بنا|بنا نہیں|اکاؤنٹ نہیں|کوئی اکاؤنٹ نہیں|نہیں بنانا|مت بناؤ|رہنے دو)/.test(transcript);

          const wantsLogin =
            !hasAuthNegation &&
            (/\b(login|log\s*in|sign\s*in|existing\s+account|account\s+is\s+created|account\s+created|pehle\s+se|citizen_zainab|officer_hamza|officer_sana|admin_ayesha|helper_salma|auditor_bilal)\b/i.test(
              transcript,
            ) ||
              /(پہلے سے|لاگ ان|موجودہ اکاؤنٹ|اکاؤنٹ بنا ہوا)/.test(transcript));

          const wantsSignup =
            !hasAuthNegation &&
            (/\b(new\s+account|sign\s*up|register|create\s+(?:a\s+)?(?:new\s+)?account|naya\s+account|naya\s+banao|banao)\b/i.test(
              transcript,
            ) ||
              /(نیا اکاؤنٹ|اکاؤنٹ بنا)/.test(transcript));

          const hasDirectAuthData =
            /\b03\d{9}\b/.test(toAsciiDigits(transcript)) ||
            /\b\d{5}-?\d{7}-?\d\b/.test(toAsciiDigits(transcript)) ||
            /\b(naam|name|mera\s+naam|my\s+name)\b/i.test(transcript) ||
            /(میرا نام|نالو|ناں)/.test(transcript);

          // Explicit account-creation consent gate when AUTH_GATE mode is still undecided
          if (memory.auth_draft.mode === 'undecided' && !wantsLogin) {
            if (!memory.auth_draft.wants_account_question_asked && hasAuthNegation && !hasDirectAuthData) {
              intentDetected = 'citizen_no_account_ask_create';
              memory.auth_draft.wants_account_question_asked = true;
              uiAction = 'NAVIGATE_AUTH';
              memoryAction = 'SAVED';
              memorySummary =
                'User stated they do not have an account on Auth Gate; asking explicit consent before creating a new account.';
              reasoningSteps.push(
                'Step 2 [Auth Consent Gate]: Detected no-account statement; requesting explicit consent before signup.',
              );
              replyText = localizedCitizenAccountCheck(lang, true);
            } else if (memory.auth_draft.wants_account_question_asked) {
              if (hasAuthNegation) {
                intentDetected = 'citizen_decline_create_account';
                memory.workflow_stage = 'HOME_WELCOME';
                memory.active_task = 'idle';
                memory.auth_draft.mode = 'undecided';
                memory.auth_draft.wants_account_question_asked = false;
                memory.auth_draft.declined_signup = true;
                uiAction = 'PAUSE_VOICE_AGENT';
                navigateTo = '/';
                memoryAction = 'SAVED';
                memorySummary =
                  'User declined account creation consent on Auth Gate; returning to Home screen and pausing voice agent.';
                reasoningSteps.push(
                  'Step 2 [Auth Consent Declined]: Returning to Home ("/") and emitting PAUSE_VOICE_AGENT (IDLE_STOPPED).',
                );
                replyText = localizedDeclinedSignup(lang);
              } else if (isConfirmYes || wantsSignup || hasDirectAuthData) {
                memory.auth_draft.mode = 'signup';
                memory.auth_draft.wants_account_question_asked = false;
                memory.active_task = 'auth_signup';
              } else {
                intentDetected = 'citizen_create_clarify';
                uiAction = 'NAVIGATE_AUTH';
                replyText = localizedCitizenAccountCheck(lang, true);
              }
            } else if (wantsSignup || hasDirectAuthData) {
              memory.auth_draft.mode = 'signup';
              memory.active_task = 'auth_signup';
            } else if (isConfirmYes) {
              memory.auth_draft.mode = 'login';
              memory.active_task = 'auth_login';
            } else {
              intentDetected = 'citizen_account_clarify';
              uiAction = 'NAVIGATE_AUTH';
              replyText = localizedCitizenAccountCheck(lang, false);
            }
          } else if (wantsLogin && memory.auth_draft.mode !== 'signup') {
            memory.auth_draft.mode = 'login';
            memory.active_task = 'auth_login';
          } else if (wantsSignup && memory.auth_draft.mode !== 'login') {
            memory.auth_draft.mode = 'signup';
            memory.active_task = 'auth_signup';
          }

          if (memory.auth_draft.mode === 'undecided') {
            // Waiting for explicit user decision (consent question or decline handled above)
          } else if (memory.auth_draft.mode === 'login') {
            intentDetected = 'auth_login';
            uiAction = 'NAVIGATE_LOGIN';
            const creds = extractMixedCredentials(transcript);
            if (creds.identifier) memory.auth_draft.identifier = creds.identifier;
            if (creds.secret) memory.auth_draft.pin = creds.secret;

            // If user already gave identifier on previous turn and now speaks ONLY their password/PIN
            if (memory.auth_draft.identifier && !memory.auth_draft.pin && !creds.identifier) {
              const singleSecret = toAsciiDigits(transcript).trim();
              if (/^[A-Za-z0-9!@#$%^&*_.-]{4,32}$/.test(singleSecret)) {
                memory.auth_draft.pin = singleSecret;
              }
            }
            // If user has no identifier yet and speaks a single token (username / CNIC / phone / email)
            if (!memory.auth_draft.identifier && !creds.identifier) {
              const singleId = toAsciiDigits(transcript)
                .replace(/\b(?:underscore|under\s+score)\b/gi, '_')
                .replace(/\s+_\s+/g, '_')
                .trim();
              if (
                singleId.length >= 3 &&
                !/^(login|log in|sign in|haan|yes|ok|لاگ ان)$/i.test(singleId) &&
                singleId.split(/\s+/).length <= 3
              ) {
                memory.auth_draft.identifier = singleId;
              }
            }

            if (memory.auth_draft.identifier && memory.auth_draft.pin) {
              reasoningSteps.push(`Step 3 [MCP Act]: Invoking login_citizen_voice_account with parsed credentials.`);
              const loginCall = await this.mcpClient.callToolViaProtocol('login_citizen_voice_account', {
                identifier: memory.auth_draft.identifier,
                pin_or_password: memory.auth_draft.pin,
              });
              turnMcpCalls.push(loginCall);
              const lRes = loginCall.result as {
                authenticated?: boolean;
                access_token?: string;
                user?: AuthSessionUser;
                citizen?: { id: string; display_name: string; mock_identity_reference: string } | null;
                error?: string;
              };
              if (lRes?.authenticated && lRes.access_token && lRes.user) {
                memory.user_id = lRes.user.id;
                memory.citizen_id = lRes.citizen?.id ?? null;
                memory.workflow_stage = 'AGENT_HUB';
                memory.active_task = 'idle';
                if (lRes.citizen) {
                  monotonicMergeFormState(formState, {
                    name: lRes.citizen.display_name,
                    cnic: lRes.citizen.mock_identity_reference,
                  });
                }
                authSessionOut = {
                  access_token: lRes.access_token,
                  user: lRes.user,
                  citizen: lRes.citizen,
                };
                memoryAction = 'SAVED';
                if (lRes.user.active_role === 'officer') {
                  uiAction = 'NAVIGATE_OFFICER_PORTAL';
                  navigateTo = '/officer';
                  memorySummary = `Authenticated Department Officer '${lRes.user.display_name}' -> /officer.`;
                  replyText =
                    lang === 'en'
                      ? `Welcome ${lRes.user.display_name}! Signed in as Department Officer. Opening the Officer Dashboard now.`
                      : `خوش آمدید ${lRes.user.display_name}! بطور محکمہ افسر لاگ ان کامیاب رہا۔ اب افسر ڈیش بورڈ کھولا جا رہا ہے۔`;
                } else if (lRes.user.active_role === 'admin') {
                  uiAction = 'NAVIGATE_ADMIN_PORTAL';
                  navigateTo = '/admin';
                  memorySummary = `Authenticated Super Admin '${lRes.user.display_name}' -> /admin.`;
                  replyText =
                    lang === 'en'
                      ? `Welcome ${lRes.user.display_name}! Signed in as Admin. Opening the Admin Console now.`
                      : `خوش آمدید ${lRes.user.display_name}! بطور ایڈمن لاگ ان کامیاب رہا۔ اب ایڈمن پینل کھولا جا رہا ہے۔`;
                } else if (lRes.user.active_role === 'helper') {
                  uiAction = 'NAVIGATE_HELPER_PORTAL';
                  navigateTo = '/helper';
                  memorySummary = `Authenticated Community Helper '${lRes.user.display_name}' -> /helper.`;
                  replyText =
                    lang === 'en'
                      ? `Welcome ${lRes.user.display_name}! Signed in as Community Helper. Opening the Helper Portal now.`
                      : `خوش آمدید ${lRes.user.display_name}! بطور کمیونٹی معاون لاگ ان کامیاب رہا۔ اب معاون پورٹل کھولا جا رہا ہے۔`;
                } else {
                  uiAction = 'NAVIGATE_HUB';
                  navigateTo = '/citizen';
                  memorySummary = `Authenticated citizen '${lRes.user.display_name}' -> /citizen Agent Hub.`;
                  replyText = localizedOpenHubGreeting(lang, lRes.user.display_name);
                }
              } else {
                memory.auth_draft.pin = '';
                validationErrors.push({
                  field: 'pin',
                  message: lRes?.error ?? 'Invalid identifier or PIN/password.',
                  received: '****',
                });
                replyText =
                  lang === 'en'
                    ? 'Those login details did not match. Please repeat your username/CNIC and 4-digit PIN or password.'
                    : 'لاگ ان تفصیلات درست نہیں ہیں۔ براہِ کرم اپنا یوزرنیم یا CNIC اور 4 ہندسوں کا PIN/پاسورڈ دوبارہ بتائیں۔';
              }
            } else if (!memory.auth_draft.identifier) {
              replyText =
                lang === 'en'
                  ? 'Please tell me your registered CNIC, mobile number, or username (e.g., citizen_zainab or officer_hamza) to sign in.'
                  : 'لاگ ان کے لیے اپنا رجسٹرڈ CNIC، موبائل نمبر یا یوزرنیم (مثلاً citizen_zainab یا officer_hamza) بتائیں۔';
            } else {
              replyText =
                lang === 'en'
                  ? `Got ${memory.auth_draft.identifier}. Now please provide your 4-digit PIN or password.`
                  : `${memory.auth_draft.identifier} درج ہو گیا۔ اب اپنا 4 ہندسوں کا PIN یا پاسورڈ بتائیں۔`;
            }
          } else {
            // SIGNUP MODE WITH LLM-FIRST SEMANTIC NLU + RAG + ROLLBACK & CLEAN ZERO-FILLER EXTRACTION!
            intentDetected = 'auth_signup';
            uiAction = navigateTo === '/signup' ? 'NAVIGATE_SIGNUP' : 'NAVIGATE_AUTH';
            const authHistory = memory.auth_draft.field_fill_history ?? [];
            memory.auth_draft.field_fill_history = authHistory;

            const isPureIntentPhrase =
              /^(naya account|new account|sign ?up|create account|نیا اکاؤنٹ|نیا اکاؤنٹ بنائیں|نیا اکاؤنٹ بنا دو|اکاؤنٹ بنانا ہے)$/i.test(
                transcript.trim(),
              );

            const missingBefore = computeMissingAuthSignupFields(memory.auth_draft);
            const activeAuthEditField = memory.auth_draft.editing_field as 'full_name' | 'cnic' | 'phone' | 'pin' | null;

            const authSemanticNlu = !isPureIntentPhrase
              ? await this.nluRagService.analyzeTurnSemantically({
                  transcript,
                  organizationId: orgId,
                  activeStage: 'AUTH_GATE',
                  currentlyAskedField: activeAuthEditField ?? missingBefore[0] ?? 'full_name',
                  editingField: activeAuthEditField,
                  formState: formState as unknown as Record<string, unknown>,
                  authDraft: memory.auth_draft,
                  fieldFillHistory: authHistory,
                  fieldProvenance: memory.field_provenance ?? {},
                  conversationWindow: memory.conversation_window ?? [],
                  contextSummary: memory.context_summary ?? '',
                  currentLanguage: lang,
                })
              : null;

            if (authSemanticNlu) {
              retrievedRagMatches = authSemanticNlu.rag_matches;
              semanticNluSummary = this.buildSemanticNluAuditSummary(authSemanticNlu);
              reasoningSteps.push(
                `Step 2 [Semantic NLU + RAG (${authSemanticNlu.parser_mode})]: intent=${authSemanticNlu.primary_intent}, target=${authSemanticNlu.target_field ?? 'auto'}, rag_hits=${authSemanticNlu.rag_matches.length} — ${authSemanticNlu.reasoning_summary}`,
              );
            }

            const validAuthFields = new Set(['full_name', 'cnic', 'phone', 'pin']);
            const authInlineTarget =
              authSemanticNlu?.target_field && validAuthFields.has(authSemanticNlu.target_field)
                ? authSemanticNlu.target_field
                : Object.keys(authSemanticNlu?.extracted_fields ?? {}).find((k) => validAuthFields.has(k)) ?? null;
            const isAuthInlineCorrection = Boolean(
              authSemanticNlu &&
                authInlineTarget &&
                authSemanticNlu.extracted_fields[authInlineTarget] &&
                (authSemanticNlu.primary_intent === 'INLINE_CORRECTION' ||
                  ((authSemanticNlu.primary_intent === 'EDIT_SPECIFIC_FIELD' ||
                    authSemanticNlu.is_user_dissatisfied_with_filled_value) &&
                    authSemanticNlu.extracted_fields[authInlineTarget])),
            );
            const isAuthRollbackIntent =
              !isAuthInlineCorrection &&
              (isRelativeRollbackRequest(transcript) ||
                authSemanticNlu?.primary_intent === 'ROLLBACK_LAST_FIELD' ||
                (authSemanticNlu?.is_user_dissatisfied_with_filled_value &&
                  Object.keys(authSemanticNlu.extracted_fields).length === 0));

            if (isAuthRollbackIntent && authHistory.length > 0) {
              const requestedTarget =
                authSemanticNlu?.target_field && validAuthFields.has(authSemanticNlu.target_field)
                  ? authSemanticNlu.target_field
                  : null;
              const lastField = requestedTarget ?? authHistory[authHistory.length - 1]!;
              memory.auth_draft.editing_field = lastField;
              memory.editing_field = lastField;
              const currVal = getAuthFieldCurrentValue(memory.auth_draft, lastField);
              memoryAction = 'SAVED';
              memorySummary = `Semantic NLU rolled back signup focus to '${lastField}' (current: ${currVal}).`;
              const savedMem = await this.nluRagService.learnFromInteraction({
                organizationId: orgId,
                source: 'LEARNED_FROM_CORRECTION',
                rawUtterance: transcript,
                resolvedIntent: 'ROLLBACK_LAST_FIELD',
                targetField: lastField,
                cleanValue: null,
                language: lang,
              });
              if (savedMem) {
                learnedMemorySaved = {
                  id: savedMem.id,
                  raw_utterance: savedMem.raw_utterance,
                  resolved_intent: savedMem.resolved_intent,
                  target_field: savedMem.target_field,
                  clean_value: savedMem.clean_value,
                };
              }
              replyText =
                lang === 'en'
                  ? `I apologize! Going back to ${fieldDisplayLabel(lastField, 'en')} (currently: ${currVal}). Please tell me the corrected value.`
                  : `معذرت! ہم واپس ${fieldDisplayLabel(lastField, lang)} (موجودہ: ${currVal}) پر آ گئے ہیں۔ براہِ کرم درست تفصیل بتائیں۔`;
            } else {
              const explicitOverwrite = detectExplicitFieldCorrection(transcript);
              if (activeAuthEditField) explicitOverwrite.add(activeAuthEditField);
              if (isAuthInlineCorrection && authInlineTarget) explicitOverwrite.add(authInlineTarget);

              const targetEditField =
                (isAuthInlineCorrection && authInlineTarget
                  ? (authInlineTarget as 'full_name' | 'cnic' | 'phone' | 'pin')
                  : undefined) ??
                (authSemanticNlu?.primary_intent === 'EDIT_SPECIFIC_FIELD' &&
                authSemanticNlu.target_field &&
                validAuthFields.has(authSemanticNlu.target_field)
                  ? (authSemanticNlu.target_field as 'full_name' | 'cnic' | 'phone' | 'pin')
                  : undefined) ??
                (['full_name', 'cnic', 'phone', 'pin'] as const).find((f) => explicitOverwrite.has(f));

              const expectedAuthField = activeAuthEditField ?? targetEditField ?? missingBefore[0];

              if (!isPureIntentPhrase) {
                const updatedFields: string[] = [];
                if (authSemanticNlu) {
                  const semUpdated = this.applySemanticAuthFields(
                    authSemanticNlu,
                    memory.auth_draft,
                    explicitOverwrite,
                    validationErrors,
                    isAuthInlineCorrection && authInlineTarget ? new Set([authInlineTarget]) : undefined,
                  );
                  updatedFields.push(...semUpdated);
                }
                // Run strict fallback extractor for any signup fields not yet filled (e.g. CNIC/phone/PIN patterns)
                if (!(activeAuthEditField && updatedFields.includes(activeAuthEditField)) && !isAuthInlineCorrection) {
                  const fallbackUpdated = this.extractAuthSignupFields(
                    transcript,
                    memory.auth_draft,
                    expectedAuthField,
                    explicitOverwrite,
                    validationErrors,
                  );
                  for (const f of fallbackUpdated) {
                    if (!updatedFields.includes(f)) updatedFields.push(f);
                  }
                }

                for (const f of updatedFields) {
                  pushFillHistory(authHistory, f);
                  turnFieldsTouched.push(f);
                  const val =
                    f === 'full_name'
                      ? memory.auth_draft.full_name
                      : f === 'cnic'
                        ? memory.auth_draft.cnic
                        : f === 'phone'
                          ? memory.auth_draft.phone
                          : '****';
                  this.recordFieldProvenance(
                    memory,
                    f,
                    val,
                    transcript,
                    activeAuthEditField === f || isAuthInlineCorrection ? 'corrected' : 'filled',
                  );
                }

                if (updatedFields.length > 0) {
                  const primaryUpdated = updatedFields[updatedFields.length - 1]!;
                  const shouldLearn =
                    Boolean(activeAuthEditField) ||
                    isAuthInlineCorrection ||
                    (primaryUpdated === 'full_name' &&
                      transcript.trim().split(/\s+/).length >= 4 &&
                      transcript.trim().toLowerCase() !== memory.auth_draft.full_name.toLowerCase());
                  if (shouldLearn && primaryUpdated !== 'pin') {
                    const cleanVal =
                      primaryUpdated === 'full_name'
                        ? memory.auth_draft.full_name
                        : primaryUpdated === 'cnic'
                          ? memory.auth_draft.cnic
                          : memory.auth_draft.phone;
                    const savedMem = await this.nluRagService.learnFromInteraction({
                      organizationId: orgId,
                      source:
                        activeAuthEditField || isAuthInlineCorrection
                          ? 'LEARNED_FROM_CORRECTION'
                          : 'LEARNED_FROM_CONFIRMATION',
                      rawUtterance: transcript,
                      resolvedIntent: activeAuthEditField || isAuthInlineCorrection ? 'INLINE_CORRECTION' : 'PROVIDE_FIELD',
                      targetField: primaryUpdated,
                      cleanValue: cleanVal,
                      language: lang,
                    });
                    if (savedMem) {
                      learnedMemorySaved = {
                        id: savedMem.id,
                        raw_utterance: savedMem.raw_utterance,
                        resolved_intent: savedMem.resolved_intent,
                        target_field: savedMem.target_field,
                        clean_value: savedMem.clean_value,
                      };
                    }
                  }

                  memory.auth_draft.editing_field = null;
                  memory.editing_field = null;
                  memoryAction = 'SAVED';
                  memorySummary = `Updated signup field(s): ${updatedFields.join(', ')}.`;
                } else if (targetEditField && validationErrors.length === 0) {
                  memory.auth_draft.editing_field = targetEditField;
                  memory.editing_field = targetEditField;
                  const currVal = getAuthFieldCurrentValue(memory.auth_draft, targetEditField);
                  replyText =
                    lang === 'en'
                      ? `Sure, let's edit ${fieldDisplayLabel(targetEditField, 'en')} (currently: ${currVal}). Please tell me the new value.`
                      : `ٹھیک ہے، ${fieldDisplayLabel(targetEditField, lang)} (موجودہ: ${currVal}) تبدیل کرتے ہیں۔ نئی درست تفصیل بتائیں۔`;
                }
              }

              if (!replyText) {
                const missingAfter = computeMissingAuthSignupFields(memory.auth_draft);
                if (validationErrors.length > 0) {
                  reasoningSteps.push(
                    `Step 3 [Validation Rejected]: Strict signup validation rejected ${validationErrors.map((e) => e.field).join(', ')}.`,
                  );
                  const errDetails = validationErrors.map((e) => e.message).join(' ');
                  const nextField =
                    (memory.auth_draft.editing_field as 'full_name' | 'cnic' | 'phone' | 'pin' | null) ??
                    missingAfter[0] ??
                    'full_name';
                  replyText =
                    lang === 'en'
                      ? `Validation failed: ${errDetails} Please try again. ${localizedAuthSignupQuestion('en', nextField, memory.auth_draft)}`
                      : `غلط ان پٹ: ${errDetails} براہِ کرم دوبارہ درست تفصیل بتائیں۔ ${localizedAuthSignupQuestion(lang, nextField, memory.auth_draft)}`;
                } else if (missingAfter.length === 0) {
                  reasoningSteps.push(
                    `Step 3 [MCP Act]: All 4 signup fields strictly validated. Invoking register_citizen_voice_account.`,
                  );
                  const regCall = await this.mcpClient.callToolViaProtocol('register_citizen_voice_account', {
                    full_name: memory.auth_draft.full_name,
                    cnic: memory.auth_draft.cnic,
                    phone: memory.auth_draft.phone,
                    pin: memory.auth_draft.pin,
                    language: lang,
                  });
                  turnMcpCalls.push(regCall);
                  const rRes = regCall.result as {
                    registered?: boolean;
                    access_token?: string;
                    user?: AuthSessionUser;
                    citizen?: { id: string; display_name: string; mock_identity_reference: string };
                    error?: string;
                  };
                  if (rRes?.registered && rRes.access_token && rRes.user) {
                    memory.user_id = rRes.user.id;
                    memory.citizen_id = rRes.citizen?.id ?? null;
                    memory.workflow_stage = 'AGENT_HUB';
                    memory.active_task = 'idle';
                    memory.editing_field = null;
                    memory.auth_draft.editing_field = null;
                    monotonicMergeFormState(formState, {
                      name: rRes.citizen?.display_name ?? memory.auth_draft.full_name,
                      cnic: rRes.citizen?.mock_identity_reference ?? memory.auth_draft.cnic,
                    });
                    authSessionOut = {
                      access_token: rRes.access_token,
                      user: rRes.user,
                      citizen: rRes.citizen,
                    };
                    uiAction = 'NAVIGATE_HUB';
                    navigateTo = '/citizen';
                    memoryAction = 'SAVED';
                    memorySummary = `Created authenticated citizen account '${rRes.user.display_name}' (${memory.auth_draft.cnic}), auto-logged in, and navigated to /citizen Hub.`;
                    replyText = localizedOpenHubGreeting(lang, rRes.user.display_name);
                  } else {
                    validationErrors.push({
                      field: 'signup',
                      message: rRes?.error ?? 'Could not create account.',
                      received: '',
                    });
                    replyText =
                      lang === 'en'
                        ? `Could not create account: ${rRes?.error}. Please verify your details.`
                        : `اکاؤنٹ بنانے میں مسئلہ آیا: ${rRes?.error}۔ براہِ کرم اپنی تفصیل دوبارہ چیک کریں۔`;
                  }
                } else {
                  const nextField = missingAfter[0]!;
                  replyText = localizedAuthSignupQuestion(lang, nextField, memory.auth_draft);
                }
              }
            }
          }
        }
      }

      // D. PROTECTED ACTIONS GUARDRAIL
      else if (!input.auth && !input.isTelephonyMode) {
        intentDetected = 'unauthenticated_protected_request';
        accessControlDecision = {
          decision: 'DENIED',
          actor_role: 'unauthenticated',
          authenticated: false,
          rule_reason:
            'RBAC Guardrail: Authentication is required before accessing personal relief workflows, claim status, officer messages, or human escalations.',
        };
        memory.workflow_stage = 'AUTH_GATE';
        uiAction = 'NAVIGATE_AUTH';
        reasoningSteps.push(`Step 2 [RBAC DENIED]: Redirected unauthenticated caller to AUTH_GATE.`);
        replyText =
          lang === 'en'
            ? 'Please create your voice account or sign in first so I can securely assist with your relief claim or personal status.'
            : 'براہِ کرم پہلے اپنا وائس اکاؤنٹ بنائیں یا لاگ ان کریں تاکہ میں محفوظ طریقے سے آپ کی ریلیف درخواست یا اسٹیٹس میں مدد کر سکوں۔';
      }

      // E. PILLAR 5 — PENDING ESCALATION CONFIRMATION
      else if (memory.pending_escalation && isConfirmYes) {
        intentDetected = 'confirm_human_escalation';
        capabilityCheck = 'OUT_OF_SCOPE_ESCALATED';
        const esc = memory.pending_escalation;
        reasoningSteps.push(
          `Step 2 [RBAC]: Authenticated citizen confirmed escalation to ${esc.assigned_admin}.`,
          `Step 3 [MCP Act]: Invoking escalate_to_human_admin tool.`,
        );

        const summaryLines = memory.conversation_history
          .slice(-6)
          .map((h) => `${h.role}: ${h.text}`)
          .join(' | ');

        const escCall = await this.mcpClient.callToolViaProtocol(
          'escalate_to_human_admin',
          {
            citizen_id: memory.citizen_id ?? input.auth?.userId ?? 'citizen',
            session_id: memory.session_id,
            assigned_admin: esc.assigned_admin,
            reason_out_of_scope: esc.reason_out_of_scope,
            conversation_summary: `${esc.user_request_text} || Context: ${summaryLines.slice(0, 400)}`,
          },
          input.auth,
        );
        turnMcpCalls.push(escCall);
        const eRes = escCall.result as {
          escalated?: boolean;
          escalation_id?: string;
          ticket_reference?: string;
          assigned_admin?: string;
          status?: 'OPEN';
        };
        memory.pending_escalation = null;
        memory.workflow_stage = 'AGENT_HUB';
        memory.active_task = 'idle';
        uiAction = 'SHOW_ESCALATION_TICKET';
        memoryAction = 'SAVED';
        memorySummary = `Escalated out-of-scope request to ${esc.assigned_admin} (Ticket: ${eRes.ticket_reference ?? 'ESC-CREATED'}). Preserved ${memory.suspended_tasks.length} suspended task(s).`;

        escalationOut = {
          escalation_id: eRes.escalation_id,
          ticket_reference: eRes.ticket_reference,
          assigned_admin: eRes.assigned_admin ?? esc.assigned_admin,
          reason_out_of_scope: esc.reason_out_of_scope,
          status: 'OPEN',
        };

        replyText =
          lang === 'en'
            ? `Done! I have forwarded your request and full context to ${escalationOut.assigned_admin}. Your Escalation Ticket Reference is ${escalationOut.ticket_reference}. They will review it directly in the Admin Portal. Can I help you with anything else?`
            : `بہت اچھا! میں نے آپ کی درخواست اور مکمل تفصیل ${escalationOut.assigned_admin} کو فارورڈ کر دی ہے۔ آپ کا ایسکیلیشن ٹکٹ ریفرنس نمبر ${escalationOut.ticket_reference} ہے۔ وہ ایڈمن پورٹل میں خود اس پر کارروائی کریں گے۔ کیا میں کسی اور معاملے میں آپ کی مدد کر سکتا ہوں؟`;
      }

      // F. PHASE 4 — CHECK DIRECT DEPARTMENT OFFICER REPLIES ("Officer ka jawab aaya?")
      else if (isCheckOfficerReplyIntent) {
        intentDetected = 'get_officer_messages';
        const suspended = this.suspendActiveReliefTask(memory, formState, 'Mid-form check for Department Officer reply');
        if (suspended) {
          memoryAction = 'SUSPEND_TASK';
          memorySummary = 'Suspended active relief_form to check Department Officer replies.';
        }
        reasoningSteps.push(`Step 3 [MCP Act]: Invoking get_officer_messages scoped to authenticated citizen.`);
        const msgCall = await this.mcpClient.callToolViaProtocol('get_officer_messages', {}, input.auth);
        turnMcpCalls.push(msgCall);
        const mRes = msgCall.result as {
          count?: number;
          answered_count?: number;
          inquiries?: OfficerInquiryRecord[];
        };
        const inquiries = mRes?.inquiries ?? [];
        officerInquiriesOut = inquiries;
        uiAction = 'SHOW_OFFICER_INQUIRY';

        const latestAnswered = inquiries.find((i) => i.status === 'ANSWERED' && i.officer_reply);
        if (latestAnswered) {
          replyText =
            lang === 'en'
              ? `Yes! ${latestAnswered.assigned_officer_name} replied to your inquiry ${latestAnswered.tracking_reference}: "${latestAnswered.officer_reply}". Would you like to ask anything else?`
              : lang === 'sd'
                ? `ها! ${latestAnswered.assigned_officer_name} توهان جي سوال (${latestAnswered.tracking_reference}) جو جواب ڏنو آهي: "${latestAnswered.officer_reply}".`
                : lang === 'pa'
                  ? `ہاں! ${latestAnswered.assigned_officer_name} نے تہاڈے سوال (${latestAnswered.tracking_reference}) دا جواب بھیجیا اے: "${latestAnswered.officer_reply}"۔`
                  : lang === 'ps'
                    ? `هو! ${latestAnswered.assigned_officer_name} ستاسو پوښتنې (${latestAnswered.tracking_reference}) ته ځواب ورکړی: "${latestAnswered.officer_reply}".`
                    : `جی ہاں! ${latestAnswered.assigned_officer_name} نے آپ کے سوال (${latestAnswered.tracking_reference}) کا سرکاری جواب بھیجا ہے: "${latestAnswered.officer_reply}"۔ کیا آپ کوئی اور مدد چاہتے ہیں؟`;
        } else if (inquiries.length > 0) {
          const latestOpen = inquiries[0]!;
          replyText =
            lang === 'en'
              ? `Your inquiry ${latestOpen.tracking_reference} is currently OPEN and assigned to ${latestOpen.assigned_officer_name}. They have not replied yet—please check back shortly.`
              : `آپ کا سوال (${latestOpen.tracking_reference}) اس وقت ${latestOpen.assigned_officer_name} کے پاس موجود ہے اور ابھی جواب کا انتظار ہے۔ جواب آتے ہی میں آپ کو سنا دوں گا۔`;
        } else {
          replyText =
            lang === 'en'
              ? 'You have not sent any direct questions to a Department Officer yet. Tell me your question anytime to send it directly to Officer Hamza.'
              : 'آپ نے ابھی تک محکمہ افسر کو کوئی سوال نہیں بھیجا۔ اگر آپ کچھ پوچھنا چاہتے ہیں تو بس کہیں "محکمہ افسر سے پوچھو..."۔';
        }
      }

      // G. PHASE 4 — ASK DEPARTMENT OFFICER DIRECTLY ("Direct department officer se poocho...")
      else if (isAskOfficerIntent) {
        intentDetected = 'ask_department_officer';
        const suspended = this.suspendActiveReliefTask(memory, formState, 'Mid-form direct Department Officer question');
        if (suspended) {
          memoryAction = 'SUSPEND_TASK';
          memorySummary = 'Suspended active relief_form to send direct question to Department Officer.';
        }
        const cleanedQuestion =
          transcript
            .replace(
              /^(?:direct\s+)?(?:department\s+)?officer\s+se\s+(?:poocho|poochna\s+hai|pucho|sawal\s+hai)\s*(?:ke|ki|k)?\s*/i,
              '',
            )
            .replace(/^(?:ask\s+(?:a\s+)?(?:department\s+)?officer)\s*(?:that|about|:)?\s*/i, '')
            .replace(/^(?:direct\s+)?officer\s+ko\s+sawal\s+bhejo\s*(?:ke|:)?\s*/i, '')
            .trim() || transcript.trim();

        reasoningSteps.push(`Step 3 [MCP Act]: Invoking ask_department_officer (routing to Officer Hamza).`);
        const askCall = await this.mcpClient.callToolViaProtocol(
          'ask_department_officer',
          {
            question_text: cleanedQuestion,
            application_ref: formState.reference_number ?? undefined,
            language: lang,
          },
          input.auth,
        );
        turnMcpCalls.push(askCall);
        const aRes = askCall.result as {
          created?: boolean;
          tracking_reference?: string;
          assigned_officer_name?: string;
          application_ref?: string | null;
          inquiry?: OfficerInquiryRecord;
        };
        if (aRes?.inquiry) {
          officerInquiryCreatedOut = aRes.inquiry;
          officerInquiriesOut = [aRes.inquiry];
        }
        memoryAction = suspended ? 'SUSPEND_TASK' : 'SAVED';
        memorySummary = `Created direct Department Officer inquiry ${aRes?.tracking_reference ?? 'INQ-CREATED'} assigned to ${aRes?.assigned_officer_name ?? 'Officer Hamza'}.`;
        uiAction = 'SHOW_OFFICER_INQUIRY';

        const refNote = aRes?.application_ref ? ` (linked to ${aRes.application_ref})` : '';
        replyText =
          lang === 'en'
            ? `Your question has been sent directly to ${aRes?.assigned_officer_name ?? 'Officer Hamza'}${refNote}. Your tracking ID is ${aRes?.tracking_reference}. Once the officer replies, just ask "Did the officer reply?" to hear their official answer!`
            : `آپ کا سوال براہِ راست ${aRes?.assigned_officer_name ?? 'Officer Hamza'} کو بھیج دیا گیا ہے${aRes?.application_ref ? ` (درخواست حوالہ: ${aRes.application_ref})` : ''}۔ آپ کا ٹریکنگ نمبر ${aRes?.tracking_reference} ہے۔ جب افسر جواب دیں گے تو بس پوچھیں "افسر کا جواب آیا؟" اور میں آپ کو سنا دوں گا۔`;
      }

      // H. PILLAR 5 — DETECT OUT-OF-SCOPE REQUEST & OFFER GRACEFUL HUMAN ADMIN ESCALATION
      else if (outOfScopeDraft) {
        intentDetected = 'out_of_scope_escalation';
        capabilityCheck = 'OUT_OF_SCOPE_ESCALATED';
        moodOrContextSwitch = 'capability_boundary_exceeded';

        const suspended = this.suspendActiveReliefTask(memory, formState, 'Out-of-scope escalation interruption');
        if (suspended) {
          memoryAction = 'SUSPEND_TASK';
          memorySummary = `Suspended active 'relief_form' while offering human escalation to ${outOfScopeDraft.assigned_admin}.`;
        } else {
          memoryAction = 'SAVED';
          memorySummary = `Staged pending human escalation for ${outOfScopeDraft.assigned_admin}.`;
        }

        memory.pending_escalation = outOfScopeDraft;
        memory.workflow_stage = 'ESCALATION_CONFIRM';
        uiAction = 'OFFER_ESCALATION';

        escalationOut = {
          assigned_admin: outOfScopeDraft.assigned_admin,
          reason_out_of_scope: outOfScopeDraft.reason_out_of_scope,
          status: 'PENDING_CONFIRMATION',
        };

        reasoningSteps.push(
          `Step 2 [Capability Boundary]: Request '${outOfScopeDraft.category}' exceeds AI authority (${outOfScopeDraft.reason_out_of_scope}).`,
          `Step 3 [Plan]: Offered polite human handoff to ${outOfScopeDraft.assigned_admin} instead of hallucinating or refusing bluntly.`,
        );

        replyText =
          lang === 'en'
            ? `I apologize, this request is outside my AI capabilities and authority (${outOfScopeDraft.reason_out_of_scope}). I would like to forward your request and full details to ${outOfScopeDraft.assigned_admin} so a human official can handle it. Shall I forward this request to ${outOfScopeDraft.assigned_admin}?`
            : `معذرت، یہ کام میری صلاحیت اور اختیار سے باہر ہے (AI خود درخواست منظور، بینک ٹرانسفر یا سرکاری ریکارڈ تبدیل نہیں کر سکتا)۔ میں آپ کی یہ درخواست اور پوری تفصیل ${outOfScopeDraft.assigned_admin} کو فارورڈ کرنا چاہتا ہوں تاکہ وہ خود اس پر کارروائی کریں۔ کیا میں یہ درخواست ان کو بھیج دوں؟`;
      }

      // I. PHASE 4 — APPLICATION STATUS CHECK (Queued to real MCP Client Executor with strict RBAC ownership!)
      else if (isStatusIntent) {
        intentDetected = 'claim_status';
        plannedAction = 'claim_status';
        const suspended = this.suspendActiveReliefTask(memory, formState, 'Mid-form claim status inquiry');
        if (suspended) {
          memoryAction = 'SUSPEND_TASK';
          memorySummary = `Suspended active 'relief_form' to check application status.`;
        }
        const refFilter = transcript.match(/AWZ-[A-Z0-9]+/i)?.[0];
        pendingToolCalls.push({
          name: 'get_my_applications_status',
          args: refFilter ? { reference_filter: refFilter } : {},
        });
      }

      // J. RESUME SUSPENDED TASK FROM PERSISTENT WORKING MEMORY (Supports direct "Haan submit kar dein" too!)
      else if (isResumeIntent && memory.workflow_stage !== 'RELIEF_FORM') {
        intentDetected = 'resume_suspended_task';
        moodOrContextSwitch = 'resumed_suspended_task';
        const suspendedEntry = memory.suspended_tasks.find((t) => t.task_type === 'relief_form');
        if (suspendedEntry) {
          monotonicMergeFormState(formState, suspendedEntry.draft_snapshot as Partial<VoiceSessionFormState>);
          memory.suspended_tasks = memory.suspended_tasks.filter((t) => t.task_type !== 'relief_form');
        }
        memory.workflow_stage = 'RELIEF_FORM';
        memory.active_task = 'relief_form';
        memoryAction = 'RESUME_TASK';
        formState.missing_fields = computeMissingFields(formState);
        const wantsSubmitNow =
          /\b(submit|confirm|ijazat)\b/i.test(transcript) || /(سبمٹ|جمع کر|اجازت)/.test(transcript);

        if (
          wantsSubmitNow &&
          formState.missing_fields.length === 1 &&
          formState.missing_fields[0] === 'consent_confirmed' &&
          !formState.submitted_case_id
        ) {
          formState.consent_confirmed = true;
          formState.missing_fields = [];
          formState.ready_to_submit = true;
          plannedAction = 'submit_resumed_claim';
          pendingToolCalls.push(
            {
              name: 'update_consent',
              args: {
                citizen_id: memory.citizen_id ?? formState.cnic ?? input.auth?.userId ?? 'citizen',
                action: 'grant',
              },
            },
            {
              name: 'submit_relief_claim',
              args: {
                citizen_id: memory.citizen_id ?? formState.cnic ?? input.auth?.userId ?? 'citizen',
                amount: formState.amount ?? 15000,
                reason: formState.reason,
                category: formState.category,
                consent_confirmed: true,
                full_name: formState.name,
                mock_identity_reference: formState.cnic,
                district: formState.district,
                household_size: formState.household_size ?? 5,
                monthly_income: formState.monthly_income ?? 18000,
                employment_status: formState.employment_status,
                language: lang,
              },
            },
          );
        } else {
          const savedSummary = summarizeFormDraftFields(formState, lang);
          const nextMissing = formState.missing_fields[0] ?? 'amount';
          memorySummary = `Restored suspended 'relief_form' task with all previously filled fields intact (${summarizeFormDraftFields(formState, 'en')}).`;
          reasoningSteps.push(
            `Step 2 [Memory Resume]: Popped 'relief_form' from suspended_tasks. Preserved fields: ${summarizeFormDraftFields(formState, 'en')}.`,
            `Step 3 [Plan]: Continuing directly from next missing field '${nextMissing}'.`,
          );
          uiAction = nextMissing === 'consent_confirmed' ? 'ASK_CONFIRMATION' : 'UPDATE_FORM';
          replyText =
            lang === 'en'
              ? `Welcome back! I have restored your relief application — your ${savedSummary} are still saved. ${localizedReliefQuestion('en', nextMissing, formState)}`
              : `خوش آمدید! آپ کی ریلیف درخواست بحال کر دی گئی ہے — آپ کا ${savedSummary} بالکل محفوظ ہے۔ ${localizedReliefQuestion(lang, nextMissing, formState)}`;
        }
      }

      // K. START RELIEF FORM FROM OPEN-ENDED AGENT HUB
      else if (
        memory.workflow_stage === 'AGENT_HUB' &&
        (isStartReliefIntent ||
          (formState.submitted_case_id === null &&
            /\b(relief|imdad|application|form|claim|apply|flood|سیلاب|امداد|درخواست)\b/i.test(transcript)))
      ) {
        intentDetected = 'start_relief_form';
        if (formState.submitted_case_id) {
          const fresh = emptyFormState();
          Object.assign(formState, fresh);
          memory.field_fill_history = [];
          memory.editing_field = null;
        }
        if (input.auth) {
          const citizen = await this.deps.store.getCitizenByUserId(orgId, input.auth.userId);
          monotonicMergeFormState(formState, {
            name: citizen?.display_name ?? input.auth.displayName,
            cnic: citizen?.mock_identity_reference ?? '',
          });
        }
        memory.workflow_stage = 'RELIEF_FORM';
        memory.active_task = 'relief_form';
        memoryAction = 'SAVED';

        const allowOverwrite = detectExplicitFieldCorrection(transcript);
        const startSemanticNlu = await this.nluRagService.analyzeTurnSemantically({
          transcript,
          organizationId: orgId,
          activeStage: 'RELIEF_FORM',
          currentlyAskedField: computeMissingFields(formState)[0] ?? 'district',
          editingField: null,
          formState: formState as unknown as Record<string, unknown>,
          authDraft: memory.auth_draft,
          fieldFillHistory: memory.field_fill_history ?? [],
          fieldProvenance: memory.field_provenance ?? {},
          conversationWindow: memory.conversation_window ?? [],
          contextSummary: memory.context_summary ?? '',
          currentLanguage: lang,
        });
        retrievedRagMatches = startSemanticNlu.rag_matches;
        semanticNluSummary = this.buildSemanticNluAuditSummary(startSemanticNlu);

        const semMutated = this.applySemanticReliefFields(startSemanticNlu, formState, allowOverwrite, validationErrors);
        const strictMutated = this.extractReliefFieldsStrict(
          transcript,
          formState,
          undefined,
          allowOverwrite,
          validationErrors,
        );
        const mutated = [...semMutated, ...strictMutated.filter((f) => !semMutated.includes(f))];
        for (const f of mutated) {
          pushFillHistory(memory.field_fill_history!, f);
          turnFieldsTouched.push(f);
          const rawVal = this.getFormFieldRawValue(formState, f);
          if (rawVal !== null) this.recordFieldProvenance(memory, f, rawVal, transcript, 'filled');
        }

        const lookupKey = formState.cnic || formState.name;
        if (lookupKey && memory.looked_up_identifier !== lookupKey) {
          memory.looked_up_identifier = lookupKey;
          const lookupCall = await this.mcpClient.callToolViaProtocol('lookup_citizen', { identifier: lookupKey }, input.auth);
          turnMcpCalls.push(lookupCall);
        }

        formState.missing_fields = computeMissingFields(formState);
        formState.ready_to_submit = formState.missing_fields.length === 0;
        const nextMissing = formState.missing_fields[0] ?? 'district';
        memorySummary = `Started 'relief_form' with pre-filled profile (${formState.name}, ${formState.cnic}). Next missing: ${nextMissing}.`;
        reasoningSteps.push(
          `Step 2 [Plan + Semantic NLU (${startSemanticNlu.parser_mode})]: Citizen chose Relief Application from open hub. Pre-filled Name & CNIC from authenticated account (rag_hits=${startSemanticNlu.rag_matches.length}).`,
          `Step 3 [Act]: Asking for next missing slot '${nextMissing}'.`,
        );
        uiAction = 'UPDATE_FORM';
        replyText = localizedReliefQuestion(lang, nextMissing, formState);
      }

      // L. ACTIVE RELIEF FORM FILLING (3-Layer Cognitive Architecture: LLM-First Semantic NLU + Top-K RAG + Coreference Rollback + Inline Correction + Self-Learning!)
      else if (memory.workflow_stage === 'RELIEF_FORM' || input.isTelephonyMode) {
        intentDetected = 'provide_relief_field';
        memory.workflow_stage = 'RELIEF_FORM';
        memory.active_task = 'relief_form';

        if (memory.suspended_tasks.some((t) => t.task_type === 'relief_form')) {
          memory.suspended_tasks = memory.suspended_tasks.filter((t) => t.task_type !== 'relief_form');
        }

        const history = memory.field_fill_history ?? [];
        memory.field_fill_history = history;

        const activeEditingField = memory.editing_field ?? null;
        const missingBefore = computeMissingFields(formState);
        const currentlyAskedField = activeEditingField ?? missingBefore[0] ?? 'district';

        // LAYER 2 & 3 FIRST: Run LLM-First Semantic NLU + Top-5 RAG + 16-turn Sliding Window + Field Provenance!
        const semanticNlu = await this.nluRagService.analyzeTurnSemantically({
          transcript,
          organizationId: orgId,
          activeStage: 'RELIEF_FORM',
          currentlyAskedField,
          editingField: activeEditingField,
          formState: formState as unknown as Record<string, unknown>,
          authDraft: memory.auth_draft,
          fieldFillHistory: history,
          fieldProvenance: memory.field_provenance ?? {},
          conversationWindow: memory.conversation_window ?? [],
          contextSummary: memory.context_summary ?? '',
          currentLanguage: lang,
        });
        retrievedRagMatches = semanticNlu.rag_matches;
        semanticNluSummary = this.buildSemanticNluAuditSummary(semanticNlu);

        const validReliefFields = new Set(['name', 'cnic', 'district', 'monthly_income', 'amount', 'reason']);
        reasoningSteps.push(
          `Step 2 [Semantic NLU + RAG (${semanticNlu.parser_mode})]: intent=${semanticNlu.primary_intent}, target=${semanticNlu.target_field ?? 'auto'}, dissatisfied=${semanticNlu.is_user_dissatisfied_with_filled_value}, rag_hits=${semanticNlu.rag_matches.length}, clean_extracted=${JSON.stringify(semanticNluSummary.extracted_clean_values)} — ${semanticNlu.reasoning_summary}`,
        );

        const fallbackLastFilled =
          [...(['reason', 'amount', 'monthly_income', 'district', 'cnic', 'name'] as const)].find((f) =>
            this.isFormFieldFilled(formState, f),
          ) ?? 'district';
        const lastHistoryFilled =
          [...history].reverse().find((f) => validReliefFields.has(f) && this.isFormFieldFilled(formState, f)) ??
          fallbackLastFilled;

        // Detect INLINE CORRECTION (complaint + clean replacement value in the same sentence, e.g., "bhai shehar bhi ghalat pakar liya tumne main Multan nahi Sukkur se hoon")
        const inlineTargetCandidate =
          semanticNlu.target_field &&
          validReliefFields.has(semanticNlu.target_field) &&
          semanticNlu.extracted_fields[semanticNlu.target_field]
            ? semanticNlu.target_field
            : Object.keys(semanticNlu.extracted_fields).find((k) => validReliefFields.has(k)) ?? null;

        const isSemanticInlineCorrection = Boolean(
          inlineTargetCandidate &&
            (semanticNlu.primary_intent === 'INLINE_CORRECTION' ||
              ((semanticNlu.primary_intent === 'EDIT_SPECIFIC_FIELD' ||
                semanticNlu.is_user_dissatisfied_with_filled_value) &&
                semanticNlu.extracted_fields[inlineTargetCandidate])),
        );

        // Detect NATURAL ROLLBACK / DISSATISFACTION WITHOUT REPLACEMENT VALUE (e.g., "yr is field main tumne ye cheez sahi nhi likhi wapis jao us field main")
        const isSemanticRollbackOrEditFocus =
          !isSemanticInlineCorrection &&
          (semanticNlu.primary_intent === 'ROLLBACK_LAST_FIELD' ||
            semanticNlu.primary_intent === 'EDIT_SPECIFIC_FIELD' ||
            (semanticNlu.is_user_dissatisfied_with_filled_value &&
              Object.keys(semanticNlu.extracted_fields).filter((k) => validReliefFields.has(k)).length === 0) ||
            isRelativeRollbackRequest(transcript));

        if (isSemanticInlineCorrection && inlineTargetCandidate) {
          // PRIORITY 1: INLINE COLLOQUIAL CORRECTION (update ONLY the target field, preserve all others, save to Self-Learning RAG!)
          intentDetected = 'inline_field_correction';
          moodOrContextSwitch = 'inline_correction';
          const inlineOverwrite = new Set([inlineTargetCandidate]);
          const mutated = this.applySemanticReliefFields(
            semanticNlu,
            formState,
            inlineOverwrite,
            validationErrors,
            inlineOverwrite,
          );
          formState.missing_fields = computeMissingFields(formState);
          formState.ready_to_submit = formState.missing_fields.length === 0;

          if (validationErrors.length > 0) {
            memoryAction = 'SAVED';
            uiAction = 'UPDATE_FORM';
            const errText = validationErrors.map((e) => e.message).join(' ');
            replyText =
              lang === 'en'
                ? `Invalid value for ${fieldDisplayLabel(inlineTargetCandidate, 'en')}: ${errText} Please provide a valid value.`
                : `غلط اندراج (${fieldDisplayLabel(inlineTargetCandidate, lang)}): ${errText} براہِ کرم درست تفصیل بتائیں۔`;
          } else {
            memory.editing_field = null;
            if (mutated.includes(inlineTargetCandidate)) {
              pushFillHistory(history, inlineTargetCandidate);
              turnFieldsTouched.push(inlineTargetCandidate);
            }
            const newRawVal = this.getFormFieldRawValue(formState, inlineTargetCandidate);
            const newDisplayVal = getFormFieldCurrentValue(formState, inlineTargetCandidate);
            if (newRawVal !== null) {
              this.recordFieldProvenance(memory, inlineTargetCandidate, newRawVal, transcript, 'corrected');
              const savedMem = await this.nluRagService.learnFromInteraction({
                organizationId: orgId,
                source: 'LEARNED_FROM_CORRECTION',
                rawUtterance: transcript,
                resolvedIntent: 'INLINE_CORRECTION',
                targetField: inlineTargetCandidate,
                cleanValue: newRawVal,
                language: lang,
              });
              if (savedMem) {
                learnedMemorySaved = {
                  id: savedMem.id,
                  raw_utterance: savedMem.raw_utterance,
                  resolved_intent: savedMem.resolved_intent,
                  target_field: savedMem.target_field,
                  clean_value: savedMem.clean_value,
                };
              }
            }

            const nextMissing = formState.missing_fields[0] ?? 'consent_confirmed';
            uiAction = nextMissing === 'consent_confirmed' ? 'ASK_CONFIRMATION' : 'UPDATE_FORM';
            memoryAction = 'SAVED';
            memorySummary = `Inline-corrected '${inlineTargetCandidate}' -> '${newDisplayVal}' (all other fields preserved; saved pattern to Self-Learning RAG). Resuming '${nextMissing}'.`;
            reasoningSteps.push(
              `Step 3 [Inline Correction + Self-Learning RAG]: Updated '${inlineTargetCandidate}' -> '${newDisplayVal}', preserved all other fields, and saved learned correction into agent_nlu_rag_memory.`,
            );
            replyText =
              lang === 'en'
                ? `Got it, sorry for the mix-up! I have updated ${fieldDisplayLabel(inlineTargetCandidate, 'en')} to ${newDisplayVal} (all your other details remain saved). ${localizedReliefQuestion('en', nextMissing, formState)}`
                : `جی معذرت! میں نے ${fieldDisplayLabel(inlineTargetCandidate, lang)} تبدیل کر کے ${newDisplayVal} محفوظ کر دیا ہے (آپ کی باقی تمام معلومات بالکل محفوظ ہیں)۔ ${localizedReliefQuestion(lang, nextMissing, formState)}`;
          }
        } else if (isSemanticRollbackOrEditFocus) {
          // PRIORITY 2: UNIVERSAL NATURAL ROLLBACK OR TARGETED EDIT FOCUS (e.g. "yr is field main tumne ye cheez sahi nhi likhi wapis jao us field main")
          intentDetected =
            semanticNlu.primary_intent === 'EDIT_SPECIFIC_FIELD' ? 'targeted_field_edit_focus' : 'field_rollback';
          moodOrContextSwitch = 'user_correction_rollback';

          const resolvedTarget =
            semanticNlu.target_field &&
            validReliefFields.has(semanticNlu.target_field) &&
            (semanticNlu.primary_intent === 'EDIT_SPECIFIC_FIELD' ||
              this.isFormFieldFilled(formState, semanticNlu.target_field))
              ? semanticNlu.target_field
              : lastHistoryFilled;

          memory.editing_field = resolvedTarget;
          turnFieldsTouched.push(resolvedTarget);
          const currentVal = getFormFieldCurrentValue(formState, resolvedTarget);
          const savedMem = await this.nluRagService.learnFromInteraction({
            organizationId: orgId,
            source: 'LEARNED_FROM_CORRECTION',
            rawUtterance: transcript,
            resolvedIntent:
              semanticNlu.primary_intent === 'EDIT_SPECIFIC_FIELD' ? 'EDIT_SPECIFIC_FIELD' : 'ROLLBACK_LAST_FIELD',
            targetField: resolvedTarget,
            cleanValue: null,
            language: lang,
          });
          if (savedMem) {
            learnedMemorySaved = {
              id: savedMem.id,
              raw_utterance: savedMem.raw_utterance,
              resolved_intent: savedMem.resolved_intent,
              target_field: savedMem.target_field,
              clean_value: savedMem.clean_value,
            };
          }

          uiAction = 'UPDATE_FORM';
          memoryAction = 'SAVED';
          memorySummary = `Semantic NLU coreference rolled back focus to '${resolvedTarget}' (current: ${currentVal}) without wiping other fields; saved rollback phrasing to Self-Learning RAG.`;
          reasoningSteps.push(
            `Step 3 [Coreference Rollback + Self-Learning RAG]: Resolved user dissatisfaction to '${resolvedTarget}' (current: ${currentVal}), highlighted UI edit mode, and persisted phrasing to agent_nlu_rag_memory.`,
          );
          replyText =
            lang === 'en'
              ? `I apologize for the mistake! Going back to ${fieldDisplayLabel(resolvedTarget, 'en')} (currently: ${currentVal}). Please tell me the corrected value.`
              : `معذرت! ہم واپس ${fieldDisplayLabel(resolvedTarget, lang)} (موجودہ: ${currentVal}) پر آ گئے ہیں۔ براہِ کرم درست تفصیل بتائیں۔`;
        } else {
          // PRIORITY 3 & 4: COMPLETING ACTIVE EDITING FIELD OR STANDARD CLEAN MULTI-FIELD EXTRACTION
          const explicitOverwrite = detectExplicitFieldCorrection(transcript);
          const targetedEditField = (['district', 'monthly_income', 'amount', 'reason', 'name', 'cnic'] as const).find(
            (f) => explicitOverwrite.has(f),
          );

          if (activeEditingField) {
            explicitOverwrite.add(activeEditingField);
          }

          const currentExpectedField = activeEditingField ?? targetedEditField ?? computeMissingFields(formState)[0];

          // 3A. Apply LLM+RAG clean fields FIRST!
          const semMutated = this.applySemanticReliefFields(
            semanticNlu,
            formState,
            explicitOverwrite,
            validationErrors,
            activeEditingField && semanticNlu.extracted_fields[activeEditingField]
              ? new Set([activeEditingField])
              : undefined,
          );

          // 3B. If LLM detected CONFIRM_SUBMIT and all core slots are filled, grant consent cleanly
          if (
            semanticNlu.primary_intent === 'CONFIRM_SUBMIT' &&
            validationErrors.length === 0 &&
            !activeEditingField &&
            explicitOverwrite.size === 0 &&
            computeMissingFields(formState).length === 1 &&
            computeMissingFields(formState)[0] === 'consent_confirmed'
          ) {
            formState.consent_confirmed = true;
          }

          // 3C. Supplement with strict deterministic normalizer ONLY when active editing field wasn't already cleanly answered
          const fallbackMutated =
            activeEditingField && semMutated.includes(activeEditingField)
              ? []
              : this.extractReliefFieldsStrict(
                  transcript,
                  formState,
                  currentExpectedField,
                  explicitOverwrite,
                  validationErrors,
                );

          const mutatedFields = [...semMutated, ...fallbackMutated.filter((f) => !semMutated.includes(f))];

          for (const f of mutatedFields) {
            pushFillHistory(history, f);
            turnFieldsTouched.push(f);
            const rawVal = this.getFormFieldRawValue(formState, f);
            if (rawVal !== null) {
              this.recordFieldProvenance(
                memory,
                f,
                rawVal,
                transcript,
                activeEditingField === f || targetedEditField === f ? 'corrected' : 'filled',
              );
            }
          }

          const lookupKey = formState.cnic || formState.name;
          if (lookupKey && memory.looked_up_identifier !== lookupKey) {
            memory.looked_up_identifier = lookupKey;
            const lookupCall = await this.mcpClient.callToolViaProtocol('lookup_citizen', { identifier: lookupKey }, input.auth);
            turnMcpCalls.push(lookupCall);
          }

          formState.missing_fields = computeMissingFields(formState);
          formState.ready_to_submit = formState.missing_fields.length === 0;

          if (validationErrors.length > 0) {
            memoryAction = 'SAVED';
            memorySummary = `Rejected invalid field(s): ${validationErrors.map((e) => `${e.field}=${e.received}`).join(', ')}. Preserved all valid fields monotonically.`;
            reasoningSteps.push(
              `Step 3 [Strict Validation Failed]: Rejected ${validationErrors.map((e) => `${e.field} (${e.message})`).join('; ')}.`,
            );
            const nextField = activeEditingField ?? targetedEditField ?? formState.missing_fields[0] ?? 'amount';
            const errText = validationErrors.map((e) => e.message).join(' ');
            uiAction = 'UPDATE_FORM';
            replyText =
              lang === 'en'
                ? `Invalid input: ${errText} ${localizedReliefQuestion('en', nextField, formState)}`
                : `غلط اندراج: ${errText} براہِ کرم درست مقدار بتائیں۔ ${localizedReliefQuestion(lang, nextField, formState)}`;
          } else if (targetedEditField && !mutatedFields.includes(targetedEditField)) {
            intentDetected = 'targeted_field_edit_focus';
            memory.editing_field = targetedEditField;
            const currentVal = getFormFieldCurrentValue(formState, targetedEditField);
            uiAction = 'UPDATE_FORM';
            memoryAction = 'SAVED';
            memorySummary = `Focused targeted edit mode on '${targetedEditField}' (current: ${currentVal}).`;
            reasoningSteps.push(
              `Step 3 [Targeted Field Edit]: Jumping focus to '${targetedEditField}' without wiping other fields.`,
            );
            replyText =
              lang === 'en'
                ? `Sure! Let's update ${fieldDisplayLabel(targetedEditField, 'en')} (currently: ${currentVal}). What should the new value be?`
                : `جی بالکل! ${fieldDisplayLabel(targetedEditField, lang)} (موجودہ: ${currentVal}) تبدیل کرتے ہیں۔ نئی درست تفصیل بتائیں۔`;
          } else if ((activeEditingField || targetedEditField) && mutatedFields.length > 0) {
            const editedField = activeEditingField ?? targetedEditField!;
            const newVal = getFormFieldCurrentValue(formState, editedField);
            const rawNewVal = this.getFormFieldRawValue(formState, editedField);
            intentDetected = 'field_edit_applied';
            memory.editing_field = null;

            if (rawNewVal !== null) {
              const savedMem = await this.nluRagService.learnFromInteraction({
                organizationId: orgId,
                source: 'LEARNED_FROM_CORRECTION',
                rawUtterance: transcript,
                resolvedIntent: 'INLINE_CORRECTION',
                targetField: editedField,
                cleanValue: rawNewVal,
                language: lang,
              });
              if (savedMem) {
                learnedMemorySaved = {
                  id: savedMem.id,
                  raw_utterance: savedMem.raw_utterance,
                  resolved_intent: savedMem.resolved_intent,
                  target_field: savedMem.target_field,
                  clean_value: savedMem.clean_value,
                };
              }
            }

            const nextMissing = formState.missing_fields[0] ?? 'consent_confirmed';
            uiAction = nextMissing === 'consent_confirmed' ? 'ASK_CONFIRMATION' : 'UPDATE_FORM';
            memoryAction = 'SAVED';
            memorySummary = `Updated '${editedField}' to '${newVal}' (edit_mode override); preserved all other fields and saved correction to Self-Learning RAG. Resuming '${nextMissing}'.`;
            reasoningSteps.push(
              `Step 3 [Edit Applied + Self-Learning RAG]: Updated '${editedField}' -> '${newVal}' cleanly without losing other fields. Resuming '${nextMissing}'.`,
            );
            replyText =
              lang === 'en'
                ? `Updated! ${fieldDisplayLabel(editedField, 'en')} is now ${newVal} (all your other fields remain saved). ${localizedReliefQuestion('en', nextMissing, formState)}`
                : `تبدیل ہو گیا! ${fieldDisplayLabel(editedField, lang)} اب ${newVal} محفوظ ہو گیا ہے (آپ کی باقی تمام معلومات محفوظ ہیں)۔ ${localizedReliefQuestion(lang, nextMissing, formState)}`;
          } else if (formState.ready_to_submit && !formState.submitted_case_id) {
            memory.editing_field = null;
            reasoningSteps.push(
              `Step 3 [MCP Act]: All 7 relief slots validated & verbal consent confirmed. Executing update_consent + submit_relief_claim via MCP.`,
            );
            const consentCall = await this.mcpClient.callToolViaProtocol(
              'update_consent',
              {
                citizen_id: memory.citizen_id ?? formState.cnic ?? input.auth?.userId ?? 'citizen',
                action: 'grant',
              },
              input.auth,
            );
            turnMcpCalls.push(consentCall);

            const submitCall = await this.mcpClient.callToolViaProtocol(
              'submit_relief_claim',
              {
                citizen_id: memory.citizen_id ?? formState.cnic ?? input.auth?.userId ?? 'citizen',
                amount: formState.amount ?? 15000,
                reason: formState.reason,
                category: formState.category,
                consent_confirmed: true,
                full_name: formState.name,
                mock_identity_reference: formState.cnic,
                district: formState.district,
                household_size: formState.household_size ?? 5,
                monthly_income: formState.monthly_income ?? 18000,
                employment_status: formState.employment_status,
                language: lang,
              },
              input.auth,
            );
            turnMcpCalls.push(submitCall);

            const subRes = submitCall.result as {
              submitted?: boolean;
              error?: string;
              message?: string;
              case_id?: string;
              reference_number?: string;
              status?: string;
              evidence_score?: number;
              rule_version_used?: string;
              decision_tier?: DecisionTier;
              confidence_score?: number;
              is_uncertain?: boolean;
              citizen_simple_reason?: string | null;
              case_notes?: StructuredUncertaintyCaseNotes | null;
            };
            if (subRes?.submitted) {
              formState.submitted_case_id = subRes.case_id ?? null;
              formState.reference_number = subRes.reference_number ?? null;
              formState.claim_status = subRes.status ?? 'READY_FOR_OFFICER';
              formState.rule_version_used = subRes.rule_version_used ?? null;
              formState.decision_tier = subRes.decision_tier ?? null;
              formState.confidence_score = subRes.confidence_score ?? null;
              formState.citizen_simple_reason = subRes.citizen_simple_reason ?? null;
              formState.case_notes = subRes.case_notes ?? null;
              uiAction = 'SHOW_RECEIPT';
              sessionEnded = false;
              memory.workflow_stage = 'AGENT_HUB';
              memory.active_task = 'idle';
              memoryAction = 'SAVED';
              memorySummary = `Submitted relief claim ${formState.reference_number} (${formState.claim_status}, tier=${subRes.decision_tier ?? 'HUMAN_OFFICER_HANDOFF'}, rule=${subRes.rule_version_used ?? 'v1.0'}) under authenticated citizen account.`;
              const baseReceipt = localizedSubmittedReceipt(
                lang,
                formState.reference_number ?? 'AWZ-SUBMITTED',
                formState.claim_status,
                subRes.evidence_score ?? 100,
              );
              replyText = subRes.citizen_simple_reason
                ? `${baseReceipt} ${subRes.citizen_simple_reason}`
                : baseReceipt;
            } else if (subRes?.error === 'EXACT_DUPLICATE_PERSON') {
              uiAction = 'UPDATE_FORM';
              memoryAction = 'SAVED';
              replyText =
                lang === 'en'
                  ? `Duplicate identity detected: ${subRes.message ?? 'An existing record already matches this CNIC.'} A duplicate relief claim was safely prevented.`
                  : `شناختی کارڈ کا ریکارڈ پہلے سے موجود ہے، اس لیے ڈپلیکیٹ درخواست روک دی گئی ہے۔ اگر آپ کو مدد چاہیے تو افسر سے رابطہ کریں۔`;
            }
          } else if (mutatedFields.length === 0 && semanticNlu.needs_clarification) {
            // CONFIDENCE GATE (< 0.70 / ambiguous speech): politely ask to repeat without writing junk!
            intentDetected = 'nlu_clarification_requested';
            uiAction = 'UPDATE_FORM';
            const nextMissing = formState.missing_fields[0] ?? 'district';
            reasoningSteps.push(
              `Step 3 [Confidence Gate]: Low confidence / ambiguous utterance (${semanticNlu.clarification_reason ?? 'unclear'}); refused to write junk and asked for clarification.`,
            );
            replyText =
              lang === 'en'
                ? `I want to make sure I record this accurately. Could you please repeat your ${fieldDisplayLabel(nextMissing, 'en')} clearly?`
                : `میں چاہتا ہوں کہ آپ کی معلومات بالکل درست درج ہوں۔ براہِ کرم اپنا ${fieldDisplayLabel(nextMissing, lang)} واضح طور پر دوبارہ بتا دیں۔`;
          } else {
            // Online Self-Learning on messy colloquial multi-word utterances that cleanly extracted structured values!
            if (mutatedFields.length > 0 && transcript.trim().split(/\s+/).length >= 5) {
              const lastMutated = mutatedFields[mutatedFields.length - 1]!;
              const rawVal = this.getFormFieldRawValue(formState, lastMutated);
              if (rawVal !== null) {
                const savedMem = await this.nluRagService.learnFromInteraction({
                  organizationId: orgId,
                  source: 'LEARNED_FROM_CONFIRMATION',
                  rawUtterance: transcript,
                  resolvedIntent: 'PROVIDE_FIELD',
                  targetField: lastMutated,
                  cleanValue: rawVal,
                  language: lang,
                });
                if (savedMem) {
                  learnedMemorySaved = {
                    id: savedMem.id,
                    raw_utterance: savedMem.raw_utterance,
                    resolved_intent: savedMem.resolved_intent,
                    target_field: savedMem.target_field,
                    clean_value: savedMem.clean_value,
                  };
                }
              }
            }

            const nextMissing = formState.missing_fields[0] ?? 'district';
            memoryAction = 'SAVED';
            memorySummary = `Saved clean field(s) [${mutatedFields.join(', ') || 'none'}] monotonically. Next deterministic slot: '${nextMissing}'.`;
            reasoningSteps.push(
              `Step 3 [Slot Progression]: Captured clean answer (${mutatedFields.join(', ') || 'none'}); asking next missing slot '${nextMissing}'.`,
            );
            uiAction = nextMissing === 'consent_confirmed' ? 'ASK_CONFIRMATION' : 'UPDATE_FORM';
            replyText = localizedReliefQuestion(lang, nextMissing, formState);
          }
        }
      }

      // M. OPEN-ENDED AGENT HUB FALLBACK
      else {
        intentDetected = 'open_hub_conversation';
        memory.workflow_stage = 'AGENT_HUB';
        uiAction = 'NAVIGATE_HUB';
        reasoningSteps.push(
          `Step 2 [Open Hub]: Citizen is in open-ended Agent Hub; offering available services without forcing a form.`,
        );
        replyText = localizedOpenHubGreeting(lang, input.auth?.displayName ?? formState.name ?? 'Citizen');
      }
    }

          // Mirror newly learned correction into Universal RAG (`self_learning_corrections_kb`) via MCP Client Executor!
          if (learnedMemorySaved && pendingToolCalls.length === 0) {
            pendingToolCalls.push({
              name: 'rag_save_learned_correction',
              args: {
                raw_utterance: learnedMemorySaved.raw_utterance,
                resolved_intent: learnedMemorySaved.resolved_intent,
                target_field: learnedMemorySaved.target_field,
                clean_value: learnedMemorySaved.clean_value,
                language: lang,
                source: 'LEARNED_FROM_CORRECTION',
                session_id: memory.session_id,
              },
            });
          }

          return {
            workflow_stage: memory.workflow_stage,
            active_task: memory.active_task,
            form_state: formState,
            auth_draft: memory.auth_draft,
            field_fill_history:
              memory.workflow_stage === 'AUTH_GATE'
                ? [...(memory.auth_draft.field_fill_history ?? [])]
                : [...(memory.field_fill_history ?? [])],
            editing_field:
              memory.workflow_stage === 'AUTH_GATE'
                ? (memory.auth_draft.editing_field ?? null)
                : (memory.editing_field ?? null),
            suspended_tasks: memory.suspended_tasks,
            field_provenance: memory.field_provenance ?? {},
            pending_tool_calls: pendingToolCalls,
            validation_errors: validationErrors,
            rbac_decision: accessControlDecision,
            capability_check: capabilityCheck,
            planned_action: plannedAction,
            intent_detected: intentDetected,
            mood_or_context_switch: moodOrContextSwitch,
            memory_action: memoryAction,
            memory_summary: memorySummary,
            draft_reply: replyText,
            ui_action: uiAction,
            navigate_to: navigateTo,
            reasoning_steps: reasoningSteps,
            semantic_nlu_summary: semanticNluSummary,
            rag_memories_retrieved: retrievedRagMatches,
            learned_memory_saved: learnedMemorySaved,
            fields_touched: turnFieldsTouched,
            side_outputs: {},
          };
        },
        finalizeAfterTools: async ({ lockedLanguage, plannedAction: act, toolTraces }): Promise<ToolExecutionOutcome> => {
          const lang = lockedLanguage;

          if (act === 'execute_voice_login') {
            const loginTrace = toolTraces.find((t) => t.tool_name === 'login_citizen_voice_account');
            const lRes = (loginTrace?.result ?? {}) as {
              authenticated?: boolean;
              access_token?: string;
              user?: AuthSessionUser;
              citizen?: { id: string; display_name: string; mock_identity_reference: string } | null;
            };
            if (lRes?.authenticated && lRes.access_token && lRes.user) {
              memory.user_id = lRes.user.id;
              memory.citizen_id = lRes.citizen?.id ?? null;
              memory.workflow_stage = 'AGENT_HUB';
              memory.active_task = 'idle';
              if (lRes.citizen) {
                monotonicMergeFormState(formState, {
                  name: lRes.citizen.display_name,
                  cnic: lRes.citizen.mock_identity_reference,
                });
              }
              authSessionOut = {
                access_token: lRes.access_token,
                user: lRes.user,
                citizen: lRes.citizen,
              };
              const roleRoute =
                lRes.user.active_role === 'officer'
                  ? { act: 'NAVIGATE_OFFICER_PORTAL' as const, path: '/officer' as const }
                  : lRes.user.active_role === 'admin'
                    ? { act: 'NAVIGATE_ADMIN_PORTAL' as const, path: '/admin' as const }
                    : lRes.user.active_role === 'helper'
                      ? { act: 'NAVIGATE_HELPER_PORTAL' as const, path: '/helper' as const }
                      : { act: 'NAVIGATE_HUB' as const, path: '/citizen' as const };
              return {
                workflow_stage: 'AGENT_HUB',
                active_task: 'idle',
                form_state: formState,
                ui_action: roleRoute.act,
                navigate_to: roleRoute.path,
                memory_action: 'SAVED',
                memory_summary: `Authenticated ${lRes.user.active_role} '${lRes.user.display_name}' via @modelcontextprotocol/sdk Client.`,
                draft_reply:
                  lRes.user.active_role === 'citizen'
                    ? localizedOpenHubGreeting(lang, lRes.user.display_name)
                    : lang === 'en'
                      ? `Welcome ${lRes.user.display_name}! Signed in successfully. Opening your portal now.`
                      : `خوش آمدید ${lRes.user.display_name}! آپ کا لاگ ان مکمل ہو گیا ہے۔ اب آپ کا پورٹل کھولا جا رہا ہے۔`,
              };
            }
            return {
              ui_action: 'NAVIGATE_LOGIN',
              navigate_to: '/login',
              draft_reply: localizedGoingToLogin(lang, memory.auth_draft.target_role),
            };
          }

          if (act === 'compound_status_scam_policy') {
            const stTrace = toolTraces.find((t) => t.tool_name === 'get_my_applications_status');
            const scamTrace = toolTraces.find((t) => t.tool_name === 'check_suspicious_message');
            const polTrace = toolTraces.find((t) => t.tool_name === 'query_policy_rag');

            const apps = ((stTrace?.result as { applications?: CitizenApplicationStatusSummary[] } | null)?.applications) ?? [];
            applicationsStatusOut = apps;
            if (scamTrace) scamAlert = scamTrace.result;
            if (polTrace) policyAnswer = polTrace.result;

            const statusPart =
              apps.length > 0
                ? lang === 'en'
                  ? `Application Status: You have ${apps.length} application(s); latest ${apps[0]!.reference_number} is ${apps[0]!.status}.`
                  : `درخواست اسٹیٹس: آپ کی کل ${apps.length} درخواست(یں) موجود ہیں، تازہ ترین حوالہ ${apps[0]!.reference_number} کی حالت ${apps[0]!.status} ہے۔`
                : lang === 'en'
                  ? 'Application Status: You do not have any submitted relief applications yet.'
                  : 'درخواست اسٹیٹس: آپ کی ابھی تک کوئی جمع شدہ درخواست موجود نہیں ہے۔';

            const scamPolicyPart =
              lang === 'en'
                ? 'Scam & OTP Policy: Official Amaanat/8171 relief is 100% FREE. NEVER share your OTP/PIN code or pay any registration fee to anyone.'
                : 'اسکیم اور OTP پالیسی: تمام سرکاری امانت / 8171 ریلیف پروگرام 100 فیصد مفت ہیں۔ کبھی بھی اپنا خفیہ OTP یا PIN کوڈ کسی کو نہ بتائیں اور نہ کوئی فیس دیں۔';

            const savedDesc = summarizeFormDraftFields(formState, lang);
            const resumePart =
              memory.suspended_tasks.some((t) => t.task_type === 'relief_form') && savedDesc
                ? lang === 'en'
                  ? ` Your saved relief draft (${savedDesc}) is still safe — say "resume" or "submit" to continue.`
                  : ` آپ کا محفوظ ریلیف فارم (${savedDesc}) بالکل محفوظ ہے — مکمل کرنے یا سبمٹ کرنے کے لیے "ہاں" بولیں۔`
                : '';

            return {
              ui_action: 'SHOW_APPLICATION_STATUS',
              draft_reply: `${statusPart} ${scamPolicyPart}${resumePart}`,
            };
          }

          if (act === 'scam_check') {
            const scamTrace = toolTraces.find((t) => t.tool_name === 'check_suspicious_message');
            scamAlert = scamTrace?.result;
            const baseWarning =
              lang === 'en'
                ? 'Caution! That message is a FAKE SCAM (8171/OTP/fee fraud). Do NOT click any link, share OTP codes, or pay any fee—all Amaanat relief programs are 100% free.'
                : lang === 'sd'
                  ? 'خبردار! هي پيغام جعلي اسڪيم آهي. ڪنهن به لنڪ تي ڪلڪ نه ڪريو، نه OTP ڪوڊ ۽ نه ڪا فيس ڏيو. سرڪاري امداد بلڪل مفت آهي.'
                  : lang === 'ps'
                    ? 'خبردار! دا پیغام جعلي درغلي ده. هېڅکله OTP کوډ یا فیس مه ورکوئ. دولتي مرستې بالکل وړیا دي.'
                    : lang === 'pa'
                      ? 'خبردار! ایہہ میسج جعلی فراڈ اے۔ کدے وی OTP کوڈ یا فیس نہ دیو۔ سرکاری ریلیف امداد 100% مفت اے۔'
                      : 'خبردار! یہ میسج جعلی اسکیم (فراڈ) ہے، اس پر بالکل کلک نہ کریں اور نہ ہی اپنا OTP کوڈ یا کوئی فیس دیں۔ امانت ریلیف امداد 100% مفت ہے۔';

            let reply = baseWarning;
            if (memory.suspended_tasks.some((t) => t.task_type === 'relief_form')) {
              const savedDesc = summarizeFormDraftFields(formState, lang);
              const nextMissing = computeMissingFields(formState)[0] ?? 'monthly_income';
              const nextLabel = fieldDisplayLabel(nextMissing, lang);
              reply =
                lang === 'en'
                  ? `${baseWarning} Would you like to resume your saved relief application? Your ${savedDesc} are already saved — we only need your ${nextLabel} next.`
                  : `${baseWarning} کیا ہم واپس آپ کی ریلیف درخواست پر چلیں؟ آپ کا ${savedDesc} پہلے سے محفوظ ہے — اب صرف آپ کی ${nextLabel} بتانی ہے۔`;
            }
            return { ui_action: 'SHOW_SCAM_ALERT', draft_reply: reply };
          }

          if (act === 'policy_rag') {
            const ragTrace = toolTraces.find((t) => t.tool_name === 'query_policy_rag');
            const ragData = (ragTrace?.result ?? {}) as Record<string, unknown>;
            policyAnswer = ragData;
            const baseAnswer = String(
              ragData.answer ??
                (lang === 'en'
                  ? 'Households earning up to 25,000 PKR/month qualify for priority relief. All Amaanat programs are 100% free.'
                  : '25,000 روپے یا اس سے کم ماہانہ آمدنی والے خاندان ریلیف امداد کے اہل ہیں۔ تمام پروگرام 100 فیصد مفت ہیں۔'),
            );
            let reply = baseAnswer;
            if (memory.suspended_tasks.some((t) => t.task_type === 'relief_form')) {
              const nextMissing = computeMissingFields(formState)[0] ?? 'monthly_income';
              reply =
                lang === 'en'
                  ? `${baseAnswer} Would you like to return to your saved relief application (next: ${fieldDisplayLabel(nextMissing, 'en')})?`
                  : `${baseAnswer} کیا ہم واپس آپ کی محفوظ شدہ ریلیف درخواست مکمل کریں (اگلا خانہ: ${fieldDisplayLabel(nextMissing, lang)})؟`;
            }
            return { ui_action: 'SHOW_POLICY_ANSWER', draft_reply: reply };
          }

          if (act === 'claim_status') {
            const stTrace = toolTraces.find((t) => t.tool_name === 'get_my_applications_status');
            const apps = ((stTrace?.result as { applications?: CitizenApplicationStatusSummary[] } | null)?.applications) ?? [];
            applicationsStatusOut = apps;
            let reply: string;
            if (apps.length > 0) {
              const latest = apps[0]!;
              const notesSuffixEn = latest.officer_notes ? ` Officer note: "${latest.officer_notes}".` : '';
              const notesSuffixUr = latest.officer_notes ? ` افسر کا پیغام: "${latest.officer_notes}"۔` : '';
              reply =
                lang === 'en'
                  ? `You have ${apps.length} relief application(s). Latest reference ${latest.reference_number} for ${latest.requested_amount ?? 15000} PKR is currently ${latest.status} (Decision Band: ${latest.decision_band ?? latest.status}).${notesSuffixEn}`
                  : lang === 'sd'
                    ? `توهان جي رليف درخواست ${latest.reference_number} (${latest.requested_amount ?? 15000} رپيا) جو موجوده اسٽيٽس ${latest.status} آهي.`
                    : lang === 'pa'
                      ? `تہاڈی ریلیف درخواست ${latest.reference_number} (${latest.requested_amount ?? 15000} روپے) دا موجودہ اسٹیٹس ${latest.status} اے۔`
                      : lang === 'ps'
                        ? `ستاسو د مرستې غوښتنلیک ${latest.reference_number} (${latest.requested_amount ?? 15000} روپۍ) اوسنی حالت ${latest.status} دی.`
                        : `آپ کی کل ${apps.length} درخواست(یں) موجود ہیں۔ تازہ ترین ریلیف درخواست ${latest.reference_number} (مطلوبہ رقم: ${latest.requested_amount ?? 15000} روپے) کی موجودہ حیثیت ${latest.status} ہے (فیصلہ بینڈ: ${latest.decision_band ?? latest.status})۔${notesSuffixUr}`;
            } else {
              reply =
                lang === 'en'
                  ? 'You do not have any submitted relief applications yet. Would you like to start a new relief application now?'
                  : 'آپ کی ابھی تک کوئی جمع شدہ ریلیف درخواست موجود نہیں ہے۔ کیا آپ نئی ریلیف درخواست دینا چاہتے ہیں؟';
            }
            return { ui_action: 'SHOW_APPLICATION_STATUS', draft_reply: reply };
          }

          if (act === 'submit_resumed_claim') {
            const subTrace = toolTraces.find((t) => t.tool_name === 'submit_relief_claim');
            const subRes = (subTrace?.result ?? {}) as {
              submitted?: boolean;
              case_id?: string;
              reference_number?: string;
              status?: string;
              evidence_score?: number;
            };
            if (subRes?.submitted) {
              formState.submitted_case_id = subRes.case_id ?? null;
              formState.reference_number = subRes.reference_number ?? null;
              formState.claim_status = subRes.status ?? 'READY_FOR_OFFICER';
              memory.workflow_stage = 'AGENT_HUB';
              memory.active_task = 'idle';
              return {
                workflow_stage: 'AGENT_HUB',
                active_task: 'idle',
                form_state: formState,
                ui_action: 'SHOW_RECEIPT',
                memory_action: 'SAVED',
                memory_summary: `Submitted resumed relief claim ${formState.reference_number} (${formState.claim_status}) via MCP Client.`,
                draft_reply: localizedSubmittedReceipt(
                  lang,
                  formState.reference_number ?? 'AWZ-SUBMITTED',
                  formState.claim_status,
                  subRes.evidence_score ?? 100,
                ),
              };
            }
          }

          return {};
        },
      },
    });

    // Sync final LangGraph state back into persistent memory & audit trail
    const lang = graphOut.locked_language;
    const finalFormState = graphOut.form_state;
    finalFormState.missing_fields = computeMissingFields(finalFormState);
    finalFormState.ready_to_submit = finalFormState.missing_fields.length === 0;
    const finalReplyText = graphOut.final_reply;
    const allMcpCalls = [...turnMcpCalls, ...graphOut.mcp_tool_traces];
    const mcpProtocolInfo = this.mcpClient.getProtocolInfo();

    const selfReflectionCheck: AgentReasoningAuditLogRecord['self_reflection_check'] = {
      passed: true,
      self_corrected: graphOut.self_corrected,
      notes: graphOut.self_reflection_notes,
    };

    // --- STEP 6: PERSIST WORKING MEMORY (SLIDING WINDOW + PROVENANCE + HARD LANGUAGE LOCK) & REASONING AUDIT TRAIL ---
    memory.workflow_stage = graphOut.workflow_stage;
    memory.active_task = graphOut.active_task;
    memory.locked_language = lang;
    memory.detected_language = lang;
    memory.form_draft = finalFormState as unknown as Record<string, unknown>;
    memory.conversation_history.push({ role: 'agent', text: finalReplyText, timestamp: new Date().toISOString() });

    const sanitizedTranscript =
      graphOut.intent_detected === 'auth_signup' ||
      graphOut.intent_detected === 'auth_login' ||
      graphOut.intent_detected.startsWith('role_selected_')
        ? transcript.replace(/(?:pin|password|پن|پاسورڈ)\s*(?:is|hai|ہے|:)?\s*\S+/gi, 'SECRET: ****')
        : transcript;

    if (sanitizedTranscript) {
      this.appendConversationWindowTurn(
        memory,
        'user',
        sanitizedTranscript,
        lang,
        graphOut.fields_touched,
        graphOut.intent_detected,
      );
    }
    this.appendConversationWindowTurn(memory, 'agent', finalReplyText, lang, graphOut.fields_touched, graphOut.ui_action);

    await this.deps.store.upsertAgentMemorySession(memory);

    const toolNamesInvoked = new Set(allMcpCalls.map((c) => c.tool_name));
    let auditDepartmentId: ServiceDepartmentCode = 'GENERAL_INQUIRY';
    if (
      toolNamesInvoked.has('check_suspicious_message') ||
      graphOut.ui_action === 'SHOW_SCAM_ALERT' ||
      memory.active_task === 'scam_check' ||
      /scam|fraud|phish/i.test(graphOut.intent_detected)
    ) {
      auditDepartmentId = 'SCAM_CYBER_SAFETY';
    } else if (
      toolNamesInvoked.has('submit_relief_claim') ||
      toolNamesInvoked.has('get_my_applications_status') ||
      toolNamesInvoked.has('ask_department_officer') ||
      toolNamesInvoked.has('get_officer_messages') ||
      toolNamesInvoked.has('verify_eligibility_policy') ||
      toolNamesInvoked.has('extract_document_fields') ||
      memory.workflow_stage === 'RELIEF_FORM' ||
      memory.active_task === 'relief_form' ||
      memory.active_task === 'claim_status' ||
      memory.active_task === 'officer_inquiry' ||
      memory.active_task === 'policy_rag' ||
      /relief|claim|status|officer|policy|rollback|edit|correction/i.test(graphOut.intent_detected)
    ) {
      auditDepartmentId = 'RELIEF_ASSISTANCE';
    } else if (
      memory.workflow_stage === 'HOME_WELCOME' ||
      memory.workflow_stage === 'LANGUAGE_SELECT' ||
      memory.workflow_stage === 'ROLE_IDENTIFICATION' ||
      memory.workflow_stage === 'CITIZEN_ACCOUNT_CHECK' ||
      memory.workflow_stage === 'AUTH_GATE'
    ) {
      auditDepartmentId = 'SYSTEM_ONBOARDING';
    }

    const activeRuleSnapshot: DynamicRuleVersionRecord | null =
      this.deps.ruleEngineService ? this.deps.ruleEngineService.getActiveRuleVersion(orgId) : null;
    const submitToolResult = allMcpCalls.find((c) => c.tool_name === 'submit_relief_claim')?.result as
      | {
          rule_version_used?: string;
          rule_snapshot_json?: DynamicRuleVersionRecord | null;
          decision_tier?: DecisionTier;
          confidence_score?: number;
          duplicate_check_result?: EntityResolutionResult | null;
          model_version?: string;
        }
      | undefined;

    const auditRecord = await this.deps.store.appendAgentReasoningAuditLog({
      organization_id: orgId,
      department_id: auditDepartmentId,
      related_application_id: finalFormState.submitted_case_id ?? null,
      rule_version_used: submitToolResult?.rule_version_used ?? activeRuleSnapshot?.version ?? 'v1.0',
      rule_snapshot_json: submitToolResult?.rule_snapshot_json ?? activeRuleSnapshot,
      model_version: submitToolResult?.model_version ?? 'Awaaz-LangGraph-v2.0',
      confidence_score: submitToolResult?.confidence_score ?? finalFormState.confidence_score ?? 0.91,
      decision_tier: submitToolResult?.decision_tier ?? finalFormState.decision_tier ?? null,
      duplicate_check_result: submitToolResult?.duplicate_check_result ?? null,
      session_id: memory.session_id,
      citizen_id: memory.citizen_id,
      user_id: memory.user_id,
      workflow_stage: memory.workflow_stage,
      detected_language: lang,
      locked_language: lang,
      language_guard_status: graphOut.language_guard_status,
      langgraph_nodes_visited: graphOut.nodes_visited,
      universal_rag_chunks: graphOut.rag_context,
      mcp_protocol_info: mcpProtocolInfo,
      user_input: sanitizedTranscript || '[Initial Prompt / Language Sync / Image]',
      intent_detected: graphOut.intent_detected,
      mood_or_context_switch: graphOut.mood_or_context_switch,
      access_control_decision: graphOut.rbac_decision,
      capability_check: graphOut.capability_check,
      reasoning_steps: graphOut.reasoning_steps,
      self_reflection_check: selfReflectionCheck,
      memory_snapshot_diff: {
        action: graphOut.memory_action,
        active_task: memory.active_task,
        suspended_count: memory.suspended_tasks.length,
        summary: graphOut.memory_summary,
      },
      mcp_tools_invoked: allMcpCalls.map((c) => ({
        tool_name: c.tool_name,
        arguments: c.arguments,
        result_summary: JSON.stringify(c.result).slice(0, 220),
        status: c.status,
        duration_ms: c.duration_ms,
      })),
      validation_errors: graphOut.validation_errors,
      final_agent_response: finalReplyText,
      rag_memories_retrieved: graphOut.rag_memories_retrieved,
      learned_memory_saved: graphOut.learned_memory_saved,
      semantic_nlu_summary: graphOut.semantic_nlu_summary,
    });

    const audioOut = await this.trySynthesize(finalReplyText, lang, wantAudio);

    return {
      session_id: memory.session_id,
      audit_log_id: auditRecord.id,
      workflow_stage: memory.workflow_stage,
      active_task: memory.active_task,
      suspended_tasks: memory.suspended_tasks,
      memory_action: graphOut.memory_action,
      detected_language: lang,
      locked_language: lang,
      language_guard_status: graphOut.language_guard_status,
      langgraph_nodes_visited: graphOut.nodes_visited,
      universal_rag_chunks: graphOut.rag_context,
      mcp_protocol_info: mcpProtocolInfo,
      transcript,
      agent_reply_text: finalReplyText,
      agent_reply_audio: audioOut?.base64 ?? null,
      agent_reply_audio_mime: audioOut?.mimeType ?? null,
      form_state: finalFormState,
      auth_draft: {
        ...memory.auth_draft,
        pin: memory.auth_draft.pin ? '****' : '',
      },
      field_fill_history:
        memory.workflow_stage === 'AUTH_GATE'
          ? [...(memory.auth_draft.field_fill_history ?? [])]
          : [...(memory.field_fill_history ?? [])],
      editing_field:
        memory.workflow_stage === 'AUTH_GATE'
          ? (memory.auth_draft.editing_field ?? null)
          : (memory.editing_field ?? null),
      validation_errors: graphOut.validation_errors,
      access_control_decision: graphOut.rbac_decision,
      capability_check: graphOut.capability_check,
      reasoning_steps: graphOut.reasoning_steps,
      self_reflection_check: selfReflectionCheck,
      mcp_tools_called: allMcpCalls,
      ui_action: graphOut.ui_action,
      navigate_to: graphOut.navigate_to,
      session_ended: sessionEnded,
      ...(authSessionOut ? { auth_session: authSessionOut } : {}),
      ...(escalationOut ? { escalation: escalationOut } : {}),
      ...(applicationsStatusOut ? { applications_status: applicationsStatusOut } : {}),
      ...(officerInquiriesOut ? { officer_inquiries: officerInquiriesOut } : {}),
      ...(officerInquiryCreatedOut ? { officer_inquiry_created: officerInquiryCreatedOut } : {}),
      ...(scamAlert ? { scam_alert: scamAlert } : {}),
      ...(policyAnswer ? { policy_answer: policyAnswer } : {}),
      ...(graphOut.rag_memories_retrieved.length > 0 ? { rag_memories_retrieved: graphOut.rag_memories_retrieved } : {}),
      ...(graphOut.learned_memory_saved ? { learned_memory_saved: graphOut.learned_memory_saved } : {}),
      ...(graphOut.semantic_nlu_summary ? { semantic_nlu_summary: graphOut.semantic_nlu_summary } : {}),
    };
  }

  private async trySynthesize(
    text: string,
    language: LanguageCode,
    shouldSynthesize = true,
  ): Promise<{ base64: string; mimeType: string } | null> {
    if (!shouldSynthesize || !this.deps.voiceProvider.supportsTts(language)) return null;
    try {
      const res = await this.deps.voiceProvider.synthesize({ text: text.slice(0, 500), language });
      return {
        base64: res.audio.toString('base64'),
        mimeType: res.mimeType,
      };
    } catch {
      return null;
    }
  }
}
