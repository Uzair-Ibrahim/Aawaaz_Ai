'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  LANGUAGE_REGISTRY,
  type AgentAuthDraft,
  type AgentReasoningAuditLogRecord,
  type AgentTaskType,
  type AgentValidationError,
  type AgentWorkflowStage,
  type AuthSessionUser,
  type CitizenApplicationStatusSummary,
  type DecisionTier,
  type LanguageCode,
  type LanguageGuardStatus,
  type OfficerInquiryRecord,
  type RetrievedUniversalRagChunk,
  type StructuredUncertaintyCaseNotes,
  type SuspendedTaskEntry,
} from '@awaaz/shared';
import {
  AlertTriangle,
  Brain,
  Hand,
  Mic,
  RotateCcw,
  Send,
  Square,
  UserCheck,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { API_BASE_URL } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/context';
import { useI18n } from '@/lib/i18n/context';

export interface McpToolCallRecord {
  tool_name: string;
  arguments: Record<string, unknown>;
  result: unknown;
  status: 'success' | 'error';
  duration_ms: number;
  timestamp: string;
}

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
  locked_language?: LanguageCode;
  language_guard_status?: LanguageGuardStatus;
  langgraph_nodes_visited?: string[];
  universal_rag_chunks?: RetrievedUniversalRagChunk[];
  mcp_protocol_info?: {
    transport: string;
    discovered_tools_count: number;
    sdk: string;
  };
  transcript: string;
  agent_reply_text: string;
  agent_reply_audio: string | null;
  agent_reply_audio_mime: string | null;
  form_state: VoiceSessionFormState;
  auth_draft: AgentAuthDraft;
  field_fill_history?: string[];
  editing_field?: string | null;
  validation_errors: AgentValidationError[];
  access_control_decision: AgentReasoningAuditLogRecord['access_control_decision'];
  capability_check: 'IN_SCOPE' | 'OUT_OF_SCOPE_ESCALATED';
  reasoning_steps: string[];
  self_reflection_check: AgentReasoningAuditLogRecord['self_reflection_check'];
  mcp_tools_called: McpToolCallRecord[];
  ui_action:
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
  navigate_to?: '/' | '/login' | '/signup' | '/citizen' | '/officer' | '/admin' | '/helper' | null;
  session_ended?: boolean;
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
  scam_alert?: {
    is_suspicious?: boolean;
    risk_level?: string;
    scam_signals?: string[];
    safe_advice?: string;
  };
  policy_answer?: {
    answer?: string;
  };
}

/**
 * PHASE 1: Strict 4-state voice FSM.
 * IDLE_STOPPED: Complete standby — zero TTS, zero mic, zero auto-resume until explicit manual tap.
 */
export type VoiceAgentState = 'IDLE_STOPPED' | 'LISTENING' | 'THINKING' | 'SPEAKING';
export type OrbState = VoiceAgentState;

const STAFF_ROLES = new Set<string>(['officer', 'admin', 'auditor']);

function isStaffRole(role?: string | null): boolean {
  return Boolean(role && STAFF_ROLES.has(role.toLowerCase()));
}

function isStaffPathname(path: string): boolean {
  return (
    path.startsWith('/officer') ||
    path.startsWith('/admin') ||
    path.startsWith('/auditor') ||
    path.startsWith('/workspace')
  );
}

function createEmptyFormState(): VoiceSessionFormState {
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

function createEmptyAuthDraft(): AgentAuthDraft {
  return {
    mode: 'undecided',
    full_name: '',
    cnic: '',
    phone: '',
    pin: '',
    identifier: '',
    field_fill_history: [],
    editing_field: null,
  };
}

function computeClientMissingFields(s: VoiceSessionFormState): string[] {
  const missing: string[] = [];
  if (!s.name.trim()) missing.push('name');
  if (!s.cnic.trim()) missing.push('cnic');
  if (!s.district.trim()) missing.push('district');
  if (s.monthly_income === null || !Number.isFinite(s.monthly_income)) missing.push('monthly_income');
  if (s.amount === null || !Number.isFinite(s.amount)) missing.push('amount');
  if (!s.reason.trim()) missing.push('reason');
  if (!s.consent_confirmed) missing.push('consent_confirmed');
  return missing;
}

function syncClientFormState(
  prev: VoiceSessionFormState,
  incoming: VoiceSessionFormState,
): VoiceSessionFormState {
  const merged: VoiceSessionFormState = {
    name: incoming.name?.trim() ? incoming.name.trim() : prev.name,
    cnic: incoming.cnic?.trim() ? incoming.cnic.trim() : prev.cnic,
    district: incoming.district?.trim() ? incoming.district.trim() : prev.district,
    household_size: incoming.household_size ?? prev.household_size,
    monthly_income:
      incoming.monthly_income !== null && Number.isFinite(incoming.monthly_income)
        ? incoming.monthly_income
        : prev.monthly_income,
    employment_status: incoming.employment_status || prev.employment_status,
    amount:
      incoming.amount !== null && Number.isFinite(incoming.amount)
        ? incoming.amount
        : prev.amount,
    reason: incoming.reason?.trim() ? incoming.reason.trim() : prev.reason,
    category: incoming.category || prev.category,
    consent_confirmed: Boolean(incoming.consent_confirmed),
    missing_fields: [],
    ready_to_submit: false,
    submitted_case_id: incoming.submitted_case_id ?? null,
    reference_number: incoming.reference_number ?? null,
    claim_status: incoming.claim_status ?? null,
    rule_version_used: incoming.rule_version_used ?? prev.rule_version_used ?? null,
    decision_tier: incoming.decision_tier ?? prev.decision_tier ?? null,
    confidence_score: incoming.confidence_score ?? prev.confidence_score ?? null,
    citizen_simple_reason: incoming.citizen_simple_reason ?? prev.citizen_simple_reason ?? null,
    case_notes: incoming.case_notes ?? prev.case_notes ?? null,
  };
  merged.missing_fields = computeClientMissingFields(merged);
  merged.ready_to_submit = merged.missing_fields.length === 0;
  return merged;
}

function getInitialHomeGreeting(lang: LanguageCode, displayName?: string): string {
  if (displayName) {
    if (lang === 'en') return `Assalam-o-Alaikum ${displayName}! How may I help you today?`;
    if (lang === 'sd') return `السلام عليڪم ${displayName}! ٻڌايو اڄ مان توهان جي ڪهڙي مدد ڪري سگهان ٿو؟`;
    if (lang === 'pa') return `السلام علیکم ${displayName}! دسو اج میں تہاڈی کی مدد کر سکدا آں؟`;
    if (lang === 'ps') return `السلام علیکم ${displayName}! نن زه ستاسو څه مرسته کولی شم؟`;
    if (lang === 'bal') return `السلام علیکم ${displayName}! مروچی من تئی چے مدد کت کناں؟`;
    return `السلام علیکم ${displayName}! بتائیں آج میں آپ کی کیا مدد کر سکتا ہوں؟`;
  }
  switch (lang) {
    case 'en':
      return 'Assalam-o-Alaikum! Welcome to Awaaz Saathi. Tell me who you are: Citizen, Department Officer, Admin, or Community Helper?';
    case 'sd':
      return 'السلام عليڪم! آواز ساٿي ۾ ڀليڪار. ٻڌايو توهان ڪير آهيو: عام شهري، آفيسر، ايڊمن، يا مددگار؟';
    case 'pa':
      return 'السلام علیکم! آواز ساتھی وچ جی آیاں نوں۔ دسو تسی کون او: عام صارف، افسر، ایڈمن، یا معاون؟';
    case 'ps':
      return 'السلام علیکم! آواز ملګري ته ښه راغلاست. ووایاست تاسو څوک یاست: عادي وګړی، افسر، مدیر، که مرستیال؟';
    case 'bal':
      return 'السلام علیکم! آواز ساتھی ءَ وش آتک اِت۔ بگوش شما کے اِت: عام شہری، افسر، ایڈمن یا مددگار؟';
    default:
      return 'السلام علیکم! آواز ساتھی میں خوش آمدید۔ بتائیں آپ کون ہیں: عام صارف، محکمہ افسر، ایڈمن، یا کمیونٹی معاون؟';
  }
}

export interface SendTurnPayload {
  audioBlob?: Blob;
  transcript?: string;
  langHint?: LanguageCode;
  languageExplicitSwitch?: boolean;
  stageHint?: AgentWorkflowStage;
  imageBase64?: string;
  imageMimeType?: string;
  docType?: string;
  autoReopenMic?: boolean;
}

interface VoiceAgentContextValue {
  workflowStage: AgentWorkflowStage;
  activeTask: AgentTaskType;
  suspendedTasks: SuspendedTaskEntry[];
  memoryAction: VoiceSessionTurnResult['memory_action'];
  activated: boolean;
  setActivated: (v: boolean) => void;
  handsFreeVad: boolean;
  setHandsFreeVad: (v: boolean) => void;
  autoInterrupt: boolean;
  setAutoInterrupt: (v: boolean) => void;
  isVoiceDisabledForStaff: boolean;
  orbState: VoiceAgentState;
  audioLevel: number;
  detectedLang: LanguageCode;
  lockedLanguage: LanguageCode;
  languageGuardStatus: LanguageGuardStatus;
  langgraphNodesVisited: string[];
  universalRagChunks: RetrievedUniversalRagChunk[];
  mcpProtocolInfo: { transport: string; discovered_tools_count: number; sdk: string } | null;
  lastTranscript: string;
  manualText: string;
  setManualText: (v: string) => void;
  agentReply: string;
  autoplayBlocked: boolean;
  formState: VoiceSessionFormState;
  authDraft: AgentAuthDraft;
  fieldFillHistory: string[];
  editingField: string | null;
  validationErrors: AgentValidationError[];
  recentlyUpdatedFields: string[];
  mcpTrace: McpToolCallRecord[];
  reasoningSteps: string[];
  selfReflection: AgentReasoningAuditLogRecord['self_reflection_check'] | null;
  rbacDecision: AgentReasoningAuditLogRecord['access_control_decision'] | null;
  capabilityCheck: 'IN_SCOPE' | 'OUT_OF_SCOPE_ESCALATED';
  scamAlert: VoiceSessionTurnResult['scam_alert'] | null;
  policyAnswer: VoiceSessionTurnResult['policy_answer'] | null;
  escalationInfo: VoiceSessionTurnResult['escalation'] | null;
  applicationsStatus: CitizenApplicationStatusSummary[];
  officerInquiries: OfficerInquiryRecord[];
  sendSessionTurn: (payload: SendTurnPayload) => Promise<void>;
  handleActivateTouch: () => Promise<void>;
  interruptAndListen: () => Promise<void>;
  hardStopVoiceAgent: () => void;
  handleResetSession: (targetStage?: AgentWorkflowStage) => void;
  handleImageUpload: (file: File | null, docType: string) => Promise<void>;
  replayCurrentReply: () => Promise<void>;
  triggerWelcomeSpeech: () => Promise<void>;
  registerOnCaseSubmitted: (cb: (() => void) | null) => void;
}

const VoiceAgentContext = createContext<VoiceAgentContextValue | null>(null);

export function VoiceAgentProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, token, activeOrganizationId, setAuthenticatedSession } = useAuth();
  const { language, setLanguage } = useI18n();

  // PHASE 3: Completely silence & hide Voice Saathi for staff roles (officer, admin, auditor) & staff portals
  const isVoiceDisabledForStaff = isStaffRole(user?.active_role) || isStaffPathname(pathname);

  const initialStageForPath = (): AgentWorkflowStage => {
    if (user && !isStaffRole(user.active_role)) return 'AGENT_HUB';
    if (pathname === '/login' || pathname === '/signup') return 'AUTH_GATE';
    return 'HOME_WELCOME';
  };

  const [workflowStage, setWorkflowStage] = useState<AgentWorkflowStage>(initialStageForPath);
  const [activeTask, setActiveTask] = useState<AgentTaskType>('idle');
  const [suspendedTasks, setSuspendedTasks] = useState<SuspendedTaskEntry[]>([]);
  const [memoryAction, setMemoryAction] = useState<VoiceSessionTurnResult['memory_action']>('NONE');
  const [activated, setActivated] = useState(false);
  const [handsFreeVad, setHandsFreeVad] = useState(true);
  const [autoInterrupt, setAutoInterrupt] = useState(true);
  const [orbState, setOrbState] = useState<VoiceAgentState>('IDLE_STOPPED');
  const [audioLevel, setAudioLevel] = useState(0);
  const [detectedLang, setDetectedLang] = useState<LanguageCode>(language);
  const [languageGuardStatus, setLanguageGuardStatus] = useState<LanguageGuardStatus>('PASSED');
  const [langgraphNodesVisited, setLanggraphNodesVisited] = useState<string[]>([]);
  const [universalRagChunks, setUniversalRagChunks] = useState<RetrievedUniversalRagChunk[]>([]);
  const [mcpProtocolInfo, setMcpProtocolInfo] = useState<{
    transport: string;
    discovered_tools_count: number;
    sdk: string;
  } | null>(null);
  const [lastTranscript, setLastTranscript] = useState('');
  const [manualText, setManualText] = useState('');
  const [agentReply, setAgentReply] = useState(() => getInitialHomeGreeting(language, user?.display_name));
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);

  const [formState, setFormState] = useState<VoiceSessionFormState>(createEmptyFormState);
  const [authDraft, setAuthDraft] = useState<AgentAuthDraft>(createEmptyAuthDraft);
  const [fieldFillHistory, setFieldFillHistory] = useState<string[]>([]);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<AgentValidationError[]>([]);
  const [recentlyUpdatedFields, setRecentlyUpdatedFields] = useState<string[]>([]);
  const [mcpTrace, setMcpTrace] = useState<McpToolCallRecord[]>([]);
  const [reasoningSteps, setReasoningSteps] = useState<string[]>([]);
  const [selfReflection, setSelfReflection] = useState<AgentReasoningAuditLogRecord['self_reflection_check'] | null>(null);
  const [rbacDecision, setRbacDecision] = useState<AgentReasoningAuditLogRecord['access_control_decision'] | null>(null);
  const [capabilityCheck, setCapabilityCheck] = useState<'IN_SCOPE' | 'OUT_OF_SCOPE_ESCALATED'>('IN_SCOPE');
  const [scamAlert, setScamAlert] = useState<VoiceSessionTurnResult['scam_alert'] | null>(null);
  const [policyAnswer, setPolicyAnswer] = useState<VoiceSessionTurnResult['policy_answer'] | null>(null);
  const [escalationInfo, setEscalationInfo] = useState<VoiceSessionTurnResult['escalation'] | null>(null);
  const [applicationsStatus, setApplicationsStatus] = useState<CitizenApplicationStatusSummary[]>([]);
  const [officerInquiries, setOfficerInquiries] = useState<OfficerInquiryRecord[]>([]);

  // PHASE 1: Authoritative refs preventing stale closures across all async callbacks
  const userStoppedRef = useRef<boolean>(false);
  const voiceDisabledRef = useRef<boolean>(isVoiceDisabledForStaff);
  const activeAbortControllerRef = useRef<AbortController | null>(null);
  const postTtsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const autoInterruptRef = useRef<boolean>(autoInterrupt);

  const sessionIdRef = useRef<string>('');
  const tokenRef = useRef<string | null>(token);
  const orgIdRef = useRef<string | null>(activeOrganizationId);
  const pathnameRef = useRef<string>(pathname);
  const workflowStageRef = useRef<AgentWorkflowStage>(initialStageForPath());
  const formStateRef = useRef<VoiceSessionFormState>(createEmptyFormState());
  const prevFormRef = useRef<VoiceSessionFormState>(createEmptyFormState());
  const inFlightRef = useRef<boolean>(false);
  const agentSpeakingRef = useRef<boolean>(false);
  const orbStateRef = useRef<VoiceAgentState>('IDLE_STOPPED');
  const detectedLangRef = useRef<LanguageCode>(language);
  const lastSyncedLangRef = useRef<LanguageCode>(language);
  const handsFreeVadRef = useRef<boolean>(handsFreeVad);
  const startListeningRef = useRef<() => Promise<void>>(async () => {});
  const interruptAndListenRef = useRef<() => Promise<void>>(async () => {});
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const vadAnimRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const bargeInAnimRef = useRef<number | null>(null);
  const bargeInAudioCtxRef = useRef<AudioContext | null>(null);
  const bargeInStreamRef = useRef<MediaStream | null>(null);
  const onCaseSubmittedRef = useRef<(() => void) | null>(null);
  const prevUserIdRef = useRef<string | null>(user?.id ?? null);

  const updateOrbState = useCallback((next: VoiceAgentState) => {
    orbStateRef.current = next;
    setOrbState(next);
  }, []);

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  useEffect(() => {
    orgIdRef.current = activeOrganizationId;
  }, [activeOrganizationId]);

  useEffect(() => {
    handsFreeVadRef.current = handsFreeVad;
  }, [handsFreeVad]);

  useEffect(() => {
    autoInterruptRef.current = autoInterrupt;
  }, [autoInterrupt]);

  useEffect(() => {
    voiceDisabledRef.current = isVoiceDisabledForStaff;
  }, [isVoiceDisabledForStaff]);

  const highlightChangedFields = useCallback((nextState: VoiceSessionFormState) => {
    const prev = prevFormRef.current;
    const changed: string[] = [];
    if (nextState.name && nextState.name !== prev.name) changed.push('name');
    if (nextState.cnic && nextState.cnic !== prev.cnic) changed.push('cnic');
    if (nextState.district && nextState.district !== prev.district) changed.push('district');
    if (nextState.monthly_income !== null && nextState.monthly_income !== prev.monthly_income) {
      changed.push('monthly_income');
    }
    if (nextState.amount !== null && nextState.amount !== prev.amount) changed.push('amount');
    if (nextState.reason && nextState.reason !== prev.reason) changed.push('reason');
    if (nextState.consent_confirmed && !prev.consent_confirmed) changed.push('consent_confirmed');

    prevFormRef.current = nextState;
    if (changed.length > 0) {
      setRecentlyUpdatedFields(changed);
      setTimeout(() => setRecentlyUpdatedFields([]), 2600);
    }
  }, []);

  const stopVadLoop = useCallback(() => {
    if (vadAnimRef.current) {
      cancelAnimationFrame(vadAnimRef.current);
      vadAnimRef.current = null;
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    setAudioLevel(0);
  }, []);

  const stopBargeInMonitor = useCallback(() => {
    if (bargeInAnimRef.current) {
      cancelAnimationFrame(bargeInAnimRef.current);
      bargeInAnimRef.current = null;
    }
    if (bargeInAudioCtxRef.current) {
      void bargeInAudioCtxRef.current.close().catch(() => {});
      bargeInAudioCtxRef.current = null;
    }
    if (bargeInStreamRef.current) {
      bargeInStreamRef.current.getTracks().forEach((t) => t.stop());
      bargeInStreamRef.current = null;
    }
  }, []);

  const cancelAllSpeechOutputs = useCallback(() => {
    if (postTtsTimerRef.current) {
      clearTimeout(postTtsTimerRef.current);
      postTtsTimerRef.current = null;
    }
    if (activeAudioRef.current) {
      activeAudioRef.current.onended = null;
      activeAudioRef.current.onerror = null;
      try {
        activeAudioRef.current.pause();
      } catch {
        // Ignore audio pause errors
      }
      activeAudioRef.current = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore speech synthesis cancel errors
      }
    }
    agentSpeakingRef.current = false;
    stopBargeInMonitor();
  }, [stopBargeInMonitor]);

  const hardMuteAndStopMic = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try {
        recorderRef.current.ondataavailable = null;
        recorderRef.current.onstop = null;
        const stream = recorderRef.current.stream;
        recorderRef.current.stop();
        stream.getTracks().forEach((t) => t.stop());
      } catch {
        // Ignore recorder stop errors
      }
    }
    recorderRef.current = null;
    stopVadLoop();
    stopBargeInMonitor();
  }, [stopVadLoop, stopBargeInMonitor]);

  /**
   * PHASE 1: HARD STOP / COMPLETE STANDBY (`IDLE_STOPPED`).
   * Aborts any in-flight fetch cleanly (0 console errors), cancels all TTS, kills mic/VAD/timers,
   * sets userStoppedRef=true so NO async callback can ever auto-resume, while preserving session & form state.
   */
  const hardStopVoiceAgent = useCallback(() => {
    userStoppedRef.current = true;
    handsFreeVadRef.current = false;
    setHandsFreeVad(false);

    if (activeAbortControllerRef.current) {
      try {
        activeAbortControllerRef.current.abort();
      } catch {
        // Ignore abort errors
      }
      activeAbortControllerRef.current = null;
    }
    inFlightRef.current = false;
    cancelAllSpeechOutputs();
    hardMuteAndStopMic();
    updateOrbState('IDLE_STOPPED');
  }, [cancelAllSpeechOutputs, hardMuteAndStopMic, updateOrbState]);

  // PHASE 3: Immediately silence & lock voice agent whenever staff logs in or enters any staff route
  useEffect(() => {
    if (isVoiceDisabledForStaff) {
      hardStopVoiceAgent();
    }
  }, [isVoiceDisabledForStaff, hardStopVoiceAgent]);

  useEffect(() => {
    pathnameRef.current = pathname;
    if (isStaffPathname(pathname)) {
      hardStopVoiceAgent();
      return;
    }
    if (!user && !sessionIdRef.current) {
      const nextStage: AgentWorkflowStage =
        pathname === '/login' || pathname === '/signup' ? 'AUTH_GATE' : 'HOME_WELCOME';
      workflowStageRef.current = nextStage;
      setWorkflowStage(nextStage);
    }
  }, [pathname, user, hardStopVoiceAgent]);

  useEffect(() => {
    return () => {
      hardStopVoiceAgent();
    };
  }, [hardStopVoiceAgent]);

  /**
   * PHASE 1: Echo-Safe Voice Barge-In monitor while SPEAKING.
   * Captures mic with echoCancellation + noiseSuppression + autoGainControl;
   * triggers instant interruptAndListen() if sustained human speech (>= 280ms) exceeds echo floor.
   */
  const startBargeInMonitor = useCallback(async () => {
    if (
      !autoInterruptRef.current ||
      userStoppedRef.current ||
      voiceDisabledRef.current ||
      !agentSpeakingRef.current ||
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      return;
    }

    stopBargeInMonitor();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (!agentSpeakingRef.current || userStoppedRef.current || voiceDisabledRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      bargeInStreamRef.current = stream;
      const AudioCtx =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      bargeInAudioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      let speechStartMs: number | null = null;
      const checkBargeIn = () => {
        if (
          !agentSpeakingRef.current ||
          userStoppedRef.current ||
          voiceDisabledRef.current ||
          !autoInterruptRef.current
        ) {
          stopBargeInMonitor();
          return;
        }
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i] ?? 0;
        const avg = sum / dataArray.length;

        if (avg > 36) {
          if (speechStartMs === null) {
            speechStartMs = performance.now();
          } else if (performance.now() - speechStartMs >= 280) {
            stopBargeInMonitor();
            void interruptAndListenRef.current();
            return;
          }
        } else {
          speechStartMs = null;
        }
        bargeInAnimRef.current = requestAnimationFrame(checkBargeIn);
      };

      bargeInAnimRef.current = requestAnimationFrame(checkBargeIn);
    } catch {
      // Mic unavailable (e.g., headless browser) — tap-to-interrupt still works instantly!
    }
  }, [stopBargeInMonitor]);

  const playServerOrBrowserSpeech = useCallback(
    async (
      text: string,
      lang: LanguageCode,
      base64Audio: string | null,
      mimeType: string | null,
      onEnded: () => void,
      allowServerFetch = false,
    ): Promise<boolean> => {
      if (userStoppedRef.current || voiceDisabledRef.current) return false;

      cancelAllSpeechOutputs();
      hardMuteAndStopMic();
      agentSpeakingRef.current = true;
      updateOrbState('SPEAKING');

      // Kick off echo-safe barge-in monitor in parallel with TTS playback
      void startBargeInMonitor();

      const finishWithCooldown = () => {
        stopBargeInMonitor();
        if (userStoppedRef.current || voiceDisabledRef.current) {
          agentSpeakingRef.current = false;
          updateOrbState('IDLE_STOPPED');
          return;
        }
        if (postTtsTimerRef.current) clearTimeout(postTtsTimerRef.current);
        postTtsTimerRef.current = setTimeout(() => {
          postTtsTimerRef.current = null;
          agentSpeakingRef.current = false;
          if (userStoppedRef.current || voiceDisabledRef.current) {
            updateOrbState('IDLE_STOPPED');
            return;
          }
          onEnded();
        }, 380);
      };

      if (base64Audio) {
        try {
          const audio = new Audio(`data:${mimeType ?? 'audio/wav'};base64,${base64Audio}`);
          activeAudioRef.current = audio;
          audio.onended = finishWithCooldown;
          audio.onerror = finishWithCooldown;
          await audio.play();
          if (userStoppedRef.current || voiceDisabledRef.current) {
            cancelAllSpeechOutputs();
            updateOrbState('IDLE_STOPPED');
            return false;
          }
          setAutoplayBlocked(false);
          return true;
        } catch (err) {
          if (err instanceof Error && err.name === 'NotAllowedError') {
            setAutoplayBlocked(true);
            agentSpeakingRef.current = false;
            stopBargeInMonitor();
            if (!userStoppedRef.current && !voiceDisabledRef.current) onEnded();
            return false;
          }
        }
      }

      if (allowServerFetch && !userStoppedRef.current && !voiceDisabledRef.current) {
        const speakAbort = new AbortController();
        activeAbortControllerRef.current = speakAbort;
        try {
          const res = await fetch(`${API_BASE_URL}/voice/speak`, {
            method: 'POST',
            signal: speakAbort.signal,
            headers: {
              'Content-Type': 'application/json',
              ...(tokenRef.current ? { Authorization: `Bearer ${tokenRef.current}` } : {}),
              ...(orgIdRef.current ? { 'X-Organization-Id': orgIdRef.current } : {}),
            },
            body: JSON.stringify({ text: text.slice(0, 500), language: lang }),
          });
          if (userStoppedRef.current || voiceDisabledRef.current) return false;
          if (res.ok) {
            const blob = await res.blob();
            if (userStoppedRef.current || voiceDisabledRef.current) return false;
            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);
            activeAudioRef.current = audio;
            audio.onended = () => {
              URL.revokeObjectURL(url);
              finishWithCooldown();
            };
            audio.onerror = () => {
              URL.revokeObjectURL(url);
              finishWithCooldown();
            };
            await audio.play();
            setAutoplayBlocked(false);
            return true;
          }
        } catch (err) {
          if (err instanceof Error && err.name === 'AbortError') {
            return false;
          }
          if (err instanceof Error && err.name === 'NotAllowedError') {
            setAutoplayBlocked(true);
            agentSpeakingRef.current = false;
            stopBargeInMonitor();
            if (!userStoppedRef.current && !voiceDisabledRef.current) onEnded();
            return false;
          }
        } finally {
          if (activeAbortControllerRef.current === speakAbort) {
            activeAbortControllerRef.current = null;
          }
        }
      }

      if (userStoppedRef.current || voiceDisabledRef.current) return false;

      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        try {
          window.speechSynthesis.cancel();
          const utt = new SpeechSynthesisUtterance(text);
          utt.lang = LANGUAGE_REGISTRY[lang]?.provider_language_code.bcp47 ?? 'ur-PK';
          utt.onend = finishWithCooldown;
          utt.onerror = finishWithCooldown;
          window.speechSynthesis.speak(utt);
          return true;
        } catch {
          finishWithCooldown();
          return false;
        }
      } else {
        finishWithCooldown();
        return false;
      }
    },
    [cancelAllSpeechOutputs, hardMuteAndStopMic, startBargeInMonitor, stopBargeInMonitor, updateOrbState],
  );

  const speakAndMaybeReopenMic = useCallback(
    async (turn: VoiceSessionTurnResult, shouldAutoReopen: boolean, lockStoppedAfterSpeech = false) => {
      if (userStoppedRef.current || voiceDisabledRef.current) {
        updateOrbState('IDLE_STOPPED');
        return;
      }

      const onDoneSpeaking = () => {
        if (lockStoppedAfterSpeech) {
          userStoppedRef.current = true;
          handsFreeVadRef.current = false;
          setHandsFreeVad(false);
          updateOrbState('IDLE_STOPPED');
          return;
        }
        if (userStoppedRef.current || voiceDisabledRef.current) {
          updateOrbState('IDLE_STOPPED');
          return;
        }
        if (!inFlightRef.current) {
          updateOrbState('IDLE_STOPPED');
        }
        if (
          shouldAutoReopen &&
          handsFreeVadRef.current &&
          !userStoppedRef.current &&
          !voiceDisabledRef.current &&
          !inFlightRef.current &&
          !agentSpeakingRef.current
        ) {
          void startListeningRef.current();
        }
      };

      await playServerOrBrowserSpeech(
        turn.agent_reply_text,
        turn.locked_language ?? turn.detected_language,
        turn.agent_reply_audio,
        turn.agent_reply_audio_mime,
        onDoneSpeaking,
      );
    },
    [playServerOrBrowserSpeech, updateOrbState],
  );

  const sendSessionTurn = useCallback(
    async (payload: SendTurnPayload) => {
      if (voiceDisabledRef.current) return;
      if (inFlightRef.current) return;
      if (
        payload.transcript !== undefined &&
        payload.transcript.trim().length > 0 &&
        payload.transcript.trim().length < 2
      ) {
        return;
      }

      const isSilentLangSync = Boolean(payload.languageExplicitSwitch && !payload.transcript && !payload.audioBlob);
      if (isSilentLangSync && userStoppedRef.current) {
        return;
      }

      // Explicit user turn (voice / text / button click) clears standby lock
      if (!isSilentLangSync) {
        userStoppedRef.current = false;
      }

      inFlightRef.current = true;
      cancelAllSpeechOutputs();
      hardMuteAndStopMic();
      updateOrbState('THINKING');

      const controller = new AbortController();
      activeAbortControllerRef.current = controller;

      try {
        let res: Response;
        const activeToken = tokenRef.current;
        const activeOrg = orgIdRef.current;
        const headers: Record<string, string> = {
          ...(activeToken ? { Authorization: `Bearer ${activeToken}` } : {}),
          ...(activeOrg ? { 'X-Organization-Id': activeOrg } : {}),
        };

        const activeSid = sessionIdRef.current || undefined;
        const currentFormSnapshot = formStateRef.current;
        const langToSend = payload.langHint ?? detectedLangRef.current;
        const stageToSend = payload.stageHint ?? workflowStageRef.current;

        if (payload.audioBlob) {
          const form = new FormData();
          form.append('audio', payload.audioBlob, 'utterance.webm');
          if (activeSid) form.append('session_id', activeSid);
          form.append('language', langToSend);
          form.append('locked_language', detectedLangRef.current);
          form.append('workflow_stage', stageToSend);
          form.append('synthesize_audio', 'true');
          form.append('form_state', JSON.stringify(currentFormSnapshot));
          res = await fetch(`${API_BASE_URL}/voice/session`, {
            method: 'POST',
            signal: controller.signal,
            headers,
            body: form,
          });
        } else {
          res = await fetch(`${API_BASE_URL}/voice/session`, {
            method: 'POST',
            signal: controller.signal,
            headers: {
              ...headers,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              session_id: activeSid,
              transcript: payload.transcript,
              language: langToSend,
              locked_language: detectedLangRef.current,
              language_explicit_switch: Boolean(payload.languageExplicitSwitch),
              workflow_stage: stageToSend,
              image_base64: payload.imageBase64,
              image_mime_type: payload.imageMimeType,
              doc_type: payload.docType,
              synthesize_audio: isSilentLangSync ? false : true,
              form_state: currentFormSnapshot,
            }),
          });
        }

        // Guard: if Hard Stop was clicked while request was in-flight, drop silently!
        if (userStoppedRef.current || voiceDisabledRef.current || controller.signal.aborted) {
          inFlightRef.current = false;
          updateOrbState('IDLE_STOPPED');
          return;
        }

        if (!res.ok) {
          throw new Error(`Voice session error (${res.status})`);
        }

        const data = (await res.json()) as VoiceSessionTurnResult;

        if (userStoppedRef.current || voiceDisabledRef.current) {
          inFlightRef.current = false;
          updateOrbState('IDLE_STOPPED');
          return;
        }

        if (data.session_id) sessionIdRef.current = data.session_id;

        let loggedInAsStaff = false;
        if (data.auth_session?.access_token && data.auth_session.user) {
          tokenRef.current = data.auth_session.access_token;
          orgIdRef.current = data.auth_session.user.active_organization.id;
          prevUserIdRef.current = data.auth_session.user.id;
          loggedInAsStaff = isStaffRole(data.auth_session.user.active_role);
          setAuthenticatedSession(data.auth_session.access_token, data.auth_session.user);
        }

        if (data.workflow_stage) {
          workflowStageRef.current = data.workflow_stage;
          setWorkflowStage(data.workflow_stage);
        }
        if (data.active_task) setActiveTask(data.active_task);
        setSuspendedTasks(data.suspended_tasks ?? []);
        setMemoryAction(data.memory_action ?? 'NONE');

        const effectiveLang = data.locked_language ?? data.detected_language;
        if (effectiveLang) {
          detectedLangRef.current = effectiveLang;
          lastSyncedLangRef.current = effectiveLang;
          setDetectedLang(effectiveLang);
          setLanguage(effectiveLang);
        }
        if (data.language_guard_status) setLanguageGuardStatus(data.language_guard_status);
        if (Array.isArray(data.langgraph_nodes_visited)) setLanggraphNodesVisited(data.langgraph_nodes_visited);
        if (Array.isArray(data.universal_rag_chunks)) setUniversalRagChunks(data.universal_rag_chunks);
        if (data.mcp_protocol_info) setMcpProtocolInfo(data.mcp_protocol_info);
        if (data.transcript) setLastTranscript(data.transcript);
        if (data.agent_reply_text) setAgentReply(data.agent_reply_text);
        if (data.auth_draft) setAuthDraft(data.auth_draft);
        setFieldFillHistory(data.field_fill_history ?? []);
        setEditingField(data.editing_field ?? null);
        setValidationErrors(data.validation_errors ?? []);
        if (data.reasoning_steps) setReasoningSteps(data.reasoning_steps);
        if (data.self_reflection_check) setSelfReflection(data.self_reflection_check);
        if (data.access_control_decision) setRbacDecision(data.access_control_decision);
        if (data.capability_check) setCapabilityCheck(data.capability_check);

        if (data.form_state) {
          const merged = syncClientFormState(formStateRef.current, data.form_state);
          formStateRef.current = merged;
          highlightChangedFields(merged);
          setFormState(merged);
          if (merged.submitted_case_id && data.ui_action === 'SHOW_RECEIPT' && onCaseSubmittedRef.current) {
            onCaseSubmittedRef.current();
          }
        }
        if (data.mcp_tools_called?.length) {
          setMcpTrace((prev) => [...data.mcp_tools_called, ...prev]);
        }
        if (data.scam_alert) setScamAlert(data.scam_alert);
        if (data.policy_answer) setPolicyAnswer(data.policy_answer);
        if (data.escalation) setEscalationInfo(data.escalation);
        if (data.applications_status) setApplicationsStatus(data.applications_status);
        if (data.officer_inquiries) setOfficerInquiries(data.officer_inquiries);

        const navTarget =
          data.navigate_to ??
          (data.ui_action === 'NAVIGATE_LOGIN'
            ? '/login'
            : data.ui_action === 'NAVIGATE_SIGNUP'
              ? '/signup'
              : data.ui_action === 'NAVIGATE_CITIZEN_HUB'
                ? '/'
                : data.ui_action === 'NAVIGATE_OFFICER_PORTAL'
                  ? '/officer'
                  : data.ui_action === 'NAVIGATE_ADMIN_PORTAL'
                    ? '/admin'
                    : data.ui_action === 'NAVIGATE_HELPER_PORTAL'
                      ? '/helper'
                      : null);

        // PHASE 3: Staff login -> silence IMMEDIATELY before/during redirect!
        if (loggedInAsStaff || (navTarget && isStaffPathname(navTarget))) {
          inFlightRef.current = false;
          hardStopVoiceAgent();
          if (navTarget && pathnameRef.current !== navTarget) {
            router.push(navTarget);
          }
          return;
        }

        if (navTarget && pathnameRef.current !== navTarget) {
          router.push(navTarget);
        }

        inFlightRef.current = false;

        // Spoken pause command or declined account consent -> speak brief confirmation, then lock IDLE_STOPPED
        if (data.ui_action === 'PAUSE_VOICE_AGENT') {
          await speakAndMaybeReopenMic(data, false, true);
          return;
        }

        if (isSilentLangSync) {
          updateOrbState('IDLE_STOPPED');
          return;
        }

        await speakAndMaybeReopenMic(data, Boolean(payload.autoReopenMic), false);
      } catch (err) {
        inFlightRef.current = false;
        // Swallow AbortError cleanly with ZERO console errors (Phase 1 requirement)
        if (err instanceof Error && err.name === 'AbortError') {
          updateOrbState('IDLE_STOPPED');
          return;
        }
        updateOrbState('IDLE_STOPPED');
      } finally {
        if (activeAbortControllerRef.current === controller) {
          activeAbortControllerRef.current = null;
        }
      }
    },
    [
      setAuthenticatedSession,
      setLanguage,
      cancelAllSpeechOutputs,
      hardMuteAndStopMic,
      hardStopVoiceAgent,
      highlightChangedFields,
      speakAndMaybeReopenMic,
      router,
      updateOrbState,
    ],
  );

  // Language switcher sync (NEVER resets session_id or form_state; respects IDLE_STOPPED & staff silence!)
  useEffect(() => {
    detectedLangRef.current = language;
    setDetectedLang(language);

    if (language === lastSyncedLangRef.current) return;
    lastSyncedLangRef.current = language;

    if (!sessionIdRef.current) {
      setAgentReply(getInitialHomeGreeting(language, user?.display_name));
    }

    if (voiceDisabledRef.current || userStoppedRef.current) {
      return;
    }

    void sendSessionTurn({
      langHint: language,
      languageExplicitSwitch: true,
      autoReopenMic: false,
    });
  }, [language, user?.display_name, sendSessionTurn]);

  const handleResetSession = useCallback(
    (targetStage?: AgentWorkflowStage) => {
      hardStopVoiceAgent();
      userStoppedRef.current = false;
      setActivated(false);
      sessionIdRef.current = '';
      setLastTranscript('');
      setScamAlert(null);
      setPolicyAnswer(null);
      setEscalationInfo(null);
      setApplicationsStatus([]);
      setOfficerInquiries([]);
      setValidationErrors([]);
      setSuspendedTasks([]);
      setMemoryAction('NONE');
      setFieldFillHistory([]);
      setEditingField(null);
      const nextStage: AgentWorkflowStage =
        targetStage ?? (user && !isStaffRole(user.active_role) ? 'AGENT_HUB' : 'HOME_WELCOME');
      workflowStageRef.current = nextStage;
      setWorkflowStage(nextStage);
      setActiveTask('idle');
      const fresh = createEmptyFormState();
      formStateRef.current = fresh;
      prevFormRef.current = fresh;
      setFormState(fresh);
      setAuthDraft(createEmptyAuthDraft());
      setAgentReply(getInitialHomeGreeting(detectedLangRef.current, user?.display_name));
    },
    [hardStopVoiceAgent, user],
  );

  // Sync stage cleanly on login or logout
  useEffect(() => {
    const prevId = prevUserIdRef.current;
    const currId = user?.id ?? null;
    prevUserIdRef.current = currId;

    if (user && isStaffRole(user.active_role)) {
      hardStopVoiceAgent();
      return;
    }

    if (prevId && !currId) {
      handleResetSession('HOME_WELCOME');
    } else if (
      user &&
      (workflowStageRef.current === 'HOME_WELCOME' ||
        workflowStageRef.current === 'LANGUAGE_SELECT' ||
        workflowStageRef.current === 'ROLE_IDENTIFICATION' ||
        workflowStageRef.current === 'CITIZEN_ACCOUNT_CHECK' ||
        workflowStageRef.current === 'AUTH_GATE')
    ) {
      workflowStageRef.current = 'AGENT_HUB';
      setWorkflowStage('AGENT_HUB');
      setAgentReply(getInitialHomeGreeting(detectedLangRef.current, user.display_name));
    }
  }, [user, handleResetSession, hardStopVoiceAgent]);

  const startListeningWithVad = useCallback(async () => {
    if (voiceDisabledRef.current || inFlightRef.current || agentSpeakingRef.current || userStoppedRef.current) return;

    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      hardMuteAndStopMic();
      updateOrbState('IDLE_STOPPED');
      return;
    }

    cancelAllSpeechOutputs();
    updateOrbState('LISTENING');

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      // Remain cleanly in LISTENING until user speaks via input or hits Stop
      return;
    }

    try {
      // PHASE 1: Echo-safe audio capture constraints
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (userStoppedRef.current || voiceDisabledRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        updateOrbState('IDLE_STOPPED');
        return;
      }

      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      let speechFrames = 0;

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      recorder.onstop = async () => {
        stopVadLoop();
        stream.getTracks().forEach((t) => t.stop());
        if (userStoppedRef.current || voiceDisabledRef.current) {
          updateOrbState('IDLE_STOPPED');
          return;
        }
        const blob = new Blob(chunksRef.current, { type: mimeType });
        if (speechFrames >= 4 && blob.size > 1200 && !agentSpeakingRef.current && !inFlightRef.current) {
          await sendSessionTurn({ audioBlob: blob, autoReopenMic: handsFreeVadRef.current });
        } else {
          updateOrbState('IDLE_STOPPED');
        }
      };

      const AudioCtx =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      let hasSpoken = false;
      let lastSpeechTime = Date.now();
      const startedAt = Date.now();

      const checkAudioEnergy = () => {
        if (recorder.state === 'inactive' || agentSpeakingRef.current || userStoppedRef.current || voiceDisabledRef.current) {
          if (recorder.state !== 'inactive') {
            try {
              recorder.stop();
            } catch {
              // Ignore
            }
          }
          return;
        }
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i] ?? 0;
        const avg = sum / dataArray.length;
        setAudioLevel(Math.min(100, Math.round(avg * 1.8)));

        if (avg > 22) {
          speechFrames += 1;
          if (speechFrames >= 4) hasSpoken = true;
          lastSpeechTime = Date.now();
        }
        const silenceMs = Date.now() - lastSpeechTime;
        const totalMs = Date.now() - startedAt;
        if ((hasSpoken && silenceMs > 1450 && totalMs > 1200) || totalMs > 12000) {
          recorder.stop();
          return;
        }
        vadAnimRef.current = requestAnimationFrame(checkAudioEnergy);
      };

      recorder.start();
      recorderRef.current = recorder;
      updateOrbState('LISTENING');
      vadAnimRef.current = requestAnimationFrame(checkAudioEnergy);
    } catch {
      // Mic denied/unavailable (e.g. headless browser) — keep LISTENING cleanly until user taps Stop or sends text
      if (userStoppedRef.current || voiceDisabledRef.current) {
        updateOrbState('IDLE_STOPPED');
      }
    }
  }, [cancelAllSpeechOutputs, hardMuteAndStopMic, sendSessionTurn, stopVadLoop, updateOrbState]);

  /**
   * PHASE 1: Instant Tap-to-Interrupt / Voice Barge-In (`SPEAKING` -> `LISTENING` in <100ms).
   * Zero cooldown delay: immediately kills TTS + audio + timers and opens LISTENING.
   */
  const interruptAndListen = useCallback(async () => {
    if (voiceDisabledRef.current) return;
    userStoppedRef.current = false;
    setAutoplayBlocked(false);
    setActivated(true);
    cancelAllSpeechOutputs();
    // Synchronous state transition guarantees <100ms transition to LISTENING
    updateOrbState('LISTENING');
    await startListeningWithVad();
  }, [cancelAllSpeechOutputs, startListeningWithVad, updateOrbState]);

  useEffect(() => {
    startListeningRef.current = startListeningWithVad;
  }, [startListeningWithVad]);

  useEffect(() => {
    interruptAndListenRef.current = interruptAndListen;
  }, [interruptAndListen]);

  const handleActivateTouch = useCallback(async () => {
    if (voiceDisabledRef.current) return;
    if (inFlightRef.current) return;

    // Instant Barge-In if tapping Orb while SPEAKING
    if (orbStateRef.current === 'SPEAKING' || agentSpeakingRef.current) {
      await interruptAndListen();
      return;
    }

    // If currently LISTENING, stop mic cleanly
    if (orbStateRef.current === 'LISTENING') {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        try {
          recorderRef.current.stop();
        } catch {
          updateOrbState('IDLE_STOPPED');
        }
      } else {
        updateOrbState('IDLE_STOPPED');
      }
      return;
    }

    // Manual resume from IDLE_STOPPED (preserves session_id, locked_language, and filled fields!)
    userStoppedRef.current = false;
    setAutoplayBlocked(false);
    if (!activated) {
      setActivated(true);
      await sendSessionTurn({ langHint: detectedLangRef.current, autoReopenMic: handsFreeVadRef.current });
    } else {
      await startListeningWithVad();
    }
  }, [activated, interruptAndListen, sendSessionTurn, startListeningWithVad, updateOrbState]);

  const handleImageUpload = useCallback(
    async (file: File | null, docType: string) => {
      if (!file || voiceDisabledRef.current) return;
      userStoppedRef.current = false;
      setActivated(true);
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = String(reader.result ?? '');
        await sendSessionTurn({
          imageBase64: base64,
          imageMimeType: file.type || 'image/png',
          docType,
          autoReopenMic: false,
        });
      };
      reader.readAsDataURL(file);
    },
    [sendSessionTurn],
  );

  const replayCurrentReply = useCallback(async () => {
    if (voiceDisabledRef.current) return;
    userStoppedRef.current = false;
    setAutoplayBlocked(false);
    await playServerOrBrowserSpeech(
      agentReply,
      detectedLang,
      null,
      null,
      () => updateOrbState('IDLE_STOPPED'),
      true,
    );
  }, [agentReply, detectedLang, playServerOrBrowserSpeech, updateOrbState]);

  const triggerWelcomeSpeech = useCallback(async () => {
    if (voiceDisabledRef.current) return;
    userStoppedRef.current = false;
    setAutoplayBlocked(false);
    setActivated(true);
    await sendSessionTurn({ langHint: detectedLangRef.current, autoReopenMic: handsFreeVadRef.current });
  }, [sendSessionTurn]);

  const registerOnCaseSubmitted = useCallback((cb: (() => void) | null) => {
    onCaseSubmittedRef.current = cb;
  }, []);

  return (
    <VoiceAgentContext.Provider
      value={{
        workflowStage,
        activeTask,
        suspendedTasks,
        memoryAction,
        activated,
        setActivated,
        handsFreeVad,
        setHandsFreeVad,
        autoInterrupt,
        setAutoInterrupt,
        isVoiceDisabledForStaff,
        orbState,
        audioLevel,
        detectedLang,
        lockedLanguage: detectedLang,
        languageGuardStatus,
        langgraphNodesVisited,
        universalRagChunks,
        mcpProtocolInfo,
        lastTranscript,
        manualText,
        setManualText,
        agentReply,
        autoplayBlocked,
        formState,
        authDraft,
        fieldFillHistory,
        editingField,
        validationErrors,
        recentlyUpdatedFields,
        mcpTrace,
        reasoningSteps,
        selfReflection,
        rbacDecision,
        capabilityCheck,
        scamAlert,
        policyAnswer,
        escalationInfo,
        applicationsStatus,
        officerInquiries,
        sendSessionTurn,
        handleActivateTouch,
        interruptAndListen,
        hardStopVoiceAgent,
        handleResetSession,
        handleImageUpload,
        replayCurrentReply,
        triggerWelcomeSpeech,
        registerOnCaseSubmitted,
      }}
    >
      {children}
    </VoiceAgentContext.Provider>
  );
}

export function useVoiceAgent(): VoiceAgentContextValue {
  const ctx = useContext(VoiceAgentContext);
  if (!ctx) throw new Error('useVoiceAgent must be used inside VoiceAgentProvider');
  return ctx;
}

/**
 * PHASE 3 & 4: Compact Voice Saathi Dock — ONLY rendered on /login & /signup (and /helper) for non-staff users.
 * Completely hidden on `/` and `/citizen` (where the single unified VoiceSaathiOverlay lives)
 * and 100% hidden & silent for officer, admin, and auditor accounts/routes!
 */
export function GlobalVoiceSaathiDock() {
  const pathname = usePathname();
  const { user } = useAuth();
  const { dict } = useI18n();
  const va = dict.voiceAgent;
  const {
    workflowStage,
    isVoiceDisabledForStaff,
    orbState,
    detectedLang,
    lastTranscript,
    manualText,
    setManualText,
    agentReply,
    validationErrors,
    setActivated,
    sendSessionTurn,
    handleActivateTouch,
    interruptAndListen,
    hardStopVoiceAgent,
    handleResetSession,
    replayCurrentReply,
  } = useVoiceAgent();

  // PHASE 3: Absolute silence & hidden overlay for staff roles/routes, and ZERO duplicate dock on `/` or `/citizen`
  if (isVoiceDisabledForStaff || pathname === '/' || pathname === '/citizen') {
    return null;
  }

  const isActive = orbState === 'LISTENING' || orbState === 'THINKING' || orbState === 'SPEAKING';

  return (
    <section
      data-testid="global-voice-saathi-dock"
      data-workflow-stage={workflowStage}
      data-voice-state={orbState}
      className="max-w-7xl w-full mx-auto px-4 pt-4"
    >
      <div className="rounded-2xl bg-gradient-to-br from-slate-900 via-teal-950 to-slate-900 text-white p-4 shadow-lg border border-teal-700/50 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-teal-500/20 border border-teal-400/40 shrink-0">
              <Brain className="h-4 w-4 text-teal-300" />
            </span>
            <h2 className="text-base font-bold">{va.title}</h2>
            <span
              data-testid="detected-language-badge"
              className="px-2.5 py-0.5 rounded-full bg-teal-400/20 border border-teal-300/40 text-teal-200 text-xs font-bold"
            >
              {LANGUAGE_REGISTRY[detectedLang]?.native_name} ({detectedLang.toUpperCase()})
            </span>
            {user && (
              <span
                data-testid="authenticated-citizen-badge"
                className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/25 border border-emerald-300/40 text-emerald-200 text-xs font-bold"
              >
                <UserCheck className="h-3.5 w-3.5" />
                <span>{user.display_name}</span>
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {orbState === 'SPEAKING' && (
              <button
                type="button"
                data-testid="voice-interrupt-btn"
                onClick={() => void interruptAndListen()}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-bold"
              >
                <Hand className="h-3.5 w-3.5" />
                <span>{detectedLang === 'en' ? 'Interrupt & Answer' : 'روک کر جواب دیں'}</span>
              </button>
            )}
            {isActive && (
              <button
                type="button"
                data-testid="voice-stop-btn"
                onClick={() => hardStopVoiceAgent()}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold"
              >
                <VolumeX className="h-3.5 w-3.5" />
                <span>{detectedLang === 'en' ? 'Stop' : 'روکیں'}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => handleResetSession()}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-xs font-semibold"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>{va.resetBtn}</span>
            </button>
          </div>
        </div>

        <div className="flex flex-col md:flex-row items-stretch md:items-center gap-4">
          <button
            type="button"
            data-testid="voice-orb-btn"
            onClick={() => void handleActivateTouch()}
            className={`shrink-0 h-20 w-20 self-center rounded-full flex flex-col items-center justify-center border-2 shadow-lg transition-transform duration-200 ${
              orbState === 'LISTENING'
                ? 'bg-rose-600 border-rose-300 scale-105'
                : orbState === 'THINKING'
                  ? 'bg-amber-600 border-amber-200 animate-pulse'
                  : orbState === 'SPEAKING'
                    ? 'bg-emerald-600 border-emerald-300 hover:scale-105'
                    : 'bg-teal-600 border-teal-300 hover:bg-teal-500 hover:scale-105'
            }`}
            aria-label={va.tapToSpeak}
          >
            {orbState === 'LISTENING' ? (
              <Square className="h-6 w-6 text-white" />
            ) : orbState === 'SPEAKING' ? (
              <Volume2 className="h-6 w-6 text-white" />
            ) : (
              <Mic className="h-6 w-6 text-white" />
            )}
            <span className="text-[10px] font-bold uppercase mt-0.5">
              {orbState === 'LISTENING'
                ? va.listening
                : orbState === 'THINKING'
                  ? va.reasoning
                  : orbState === 'SPEAKING'
                    ? va.speaking
                    : va.tapToSpeak}
            </span>
          </button>

          <div className="flex-1 min-w-0 space-y-2">
            {lastTranscript && (
              <div
                data-testid="voice-last-transcript"
                className="px-3 py-1.5 rounded-lg bg-slate-900/90 border border-slate-700 text-xs text-amber-200 break-words"
              >
                <strong>{va.youSaid}</strong> {lastTranscript}
              </div>
            )}
            <div className="px-3.5 py-2.5 rounded-xl bg-teal-900/60 border border-teal-600/50 text-sm text-teal-50 flex items-start justify-between gap-3">
              <p data-testid="voice-agent-reply" className="break-words flex-1 leading-relaxed">
                {agentReply}
              </p>
              <button
                type="button"
                onClick={() => void replayCurrentReply()}
                className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-teal-800 hover:bg-teal-700 text-xs font-semibold border border-teal-500/40"
              >
                <Volume2 className="h-3.5 w-3.5" />
                <span>{va.replayVoice}</span>
              </button>
            </div>

            {validationErrors.length > 0 && (
              <div
                data-testid="validation-errors-box"
                className="p-2.5 rounded-xl bg-rose-950/90 border border-rose-400 text-rose-100 text-xs space-y-1"
              >
                <div className="font-bold flex items-center gap-1.5">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>{va.validationRejectedTitle}</span>
                </div>
                {validationErrors.map((err, i) => (
                  <div key={i}>
                    • <strong>{err.field}:</strong> {err.message}
                  </div>
                ))}
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!manualText.trim() || orbState === 'THINKING') return;
                const toSend = manualText.trim();
                setManualText('');
                setActivated(true);
                void sendSessionTurn({ transcript: toSend, autoReopenMic: false });
              }}
              className="w-full min-w-0 flex gap-2"
            >
              <input
                data-testid="voice-manual-input"
                type="text"
                value={manualText}
                onChange={(e) => setManualText(e.target.value)}
                placeholder={va.inputPlaceholder}
                className="flex-1 min-w-0 rounded-xl bg-slate-900/90 border border-teal-700 px-3.5 py-2 text-sm text-white placeholder:text-slate-400 focus:outline-none focus:border-teal-400"
              />
              <button
                data-testid="voice-manual-submit"
                type="submit"
                disabled={!manualText.trim() || orbState === 'THINKING'}
                className="shrink-0 px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 disabled:opacity-40 font-bold text-xs inline-flex items-center gap-1"
              >
                <Send className="h-4 w-4" />
              </button>
            </form>
          </div>
        </div>
      </div>
    </section>
  );
}
