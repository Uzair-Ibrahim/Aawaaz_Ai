import {
  type AgentAuthDraft,
  type AgentMemorySessionRecord,
  type AgentReasoningAuditLogRecord,
  type AgentTaskType,
  type AgentValidationError,
  type AgentWorkflowStage,
  type ConversationWindowTurn,
  type FieldProvenanceEntry,
  type LanguageCode,
  type LanguageGuardStatus,
  type RetrievedNluRagMatch,
  type RetrievedUniversalRagChunk,
  type SuspendedTaskEntry,
  type UniversalRagCollection,
} from '@awaaz/shared';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { Annotation, END, MemorySaver, START, StateGraph } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import type { AppEnv } from '../../../config/env';
import type { AuthContext } from '../../../core/auth/auth-service';
import type { AIProvider } from '../../../integrations/ai/provider';
import type { AmaanatMcpClient } from '../../../mcp/client';
import type { McpToolCallRecord } from '../../../mcp/mcp-tools';
import type { UniversalRagService } from '../services/universal-rag-service';
import type { VoiceNavigateTarget, VoiceSessionFormState, VoiceUiAction } from '../services/voice-agent-service';
import {
  enforceReplyLanguageGuard,
  resolveHardLanguageLock,
} from './language-guard';

export interface PlannedMcpToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface PlannerTurnOutcome {
  workflow_stage: AgentWorkflowStage;
  active_task: AgentTaskType;
  form_state: VoiceSessionFormState;
  auth_draft: AgentAuthDraft;
  field_fill_history: string[];
  editing_field: string | null;
  suspended_tasks: SuspendedTaskEntry[];
  field_provenance: Record<string, FieldProvenanceEntry>;
  pending_tool_calls: PlannedMcpToolCall[];
  validation_errors: AgentValidationError[];
  rbac_decision: AgentReasoningAuditLogRecord['access_control_decision'];
  capability_check: 'IN_SCOPE' | 'OUT_OF_SCOPE_ESCALATED';
  planned_action: string;
  intent_detected: string;
  mood_or_context_switch: string;
  memory_action: 'NONE' | 'SAVED' | 'SUSPEND_TASK' | 'RESUME_TASK' | 'CLEARED';
  memory_summary: string;
  draft_reply: string;
  ui_action: VoiceUiAction;
  navigate_to: VoiceNavigateTarget;
  reasoning_steps: string[];
  semantic_nlu_summary: AgentReasoningAuditLogRecord['semantic_nlu_summary'];
  rag_memories_retrieved: RetrievedNluRagMatch[];
  learned_memory_saved: AgentReasoningAuditLogRecord['learned_memory_saved'];
  fields_touched: string[];
  side_outputs: Record<string, unknown>;
}

export interface ToolExecutionOutcome {
  workflow_stage?: AgentWorkflowStage;
  active_task?: AgentTaskType;
  form_state?: VoiceSessionFormState;
  auth_draft?: AgentAuthDraft;
  suspended_tasks?: SuspendedTaskEntry[];
  editing_field?: string | null;
  validation_errors?: AgentValidationError[];
  memory_action?: 'NONE' | 'SAVED' | 'SUSPEND_TASK' | 'RESUME_TASK' | 'CLEARED';
  memory_summary?: string;
  draft_reply?: string;
  ui_action?: VoiceUiAction;
  navigate_to?: VoiceNavigateTarget;
  reasoning_steps?: string[];
  side_outputs?: Record<string, unknown>;
  needs_replan?: boolean;
}

export interface GraphExecutionHooks {
  memory: AgentMemorySessionRecord;
  prevFormSnapshot: VoiceSessionFormState;
  auth?: AuthContext;
  uiLanguageHint?: LanguageCode;
  uiExplicitSwitch?: boolean;
  whisperDetectedLanguage?: LanguageCode;
  isTelephonyMode?: boolean;
  imageBase64?: string;
  imageMimeType?: string;
  docType?: string;
  runDomainPlanner: (ctx: {
    lockedLanguage: LanguageCode;
    explicitSwitched: boolean;
    isPureLanguageSwitch: boolean;
    ragContext: RetrievedUniversalRagChunk[];
    llmToolSuggestion?: { toolCalls: PlannedMcpToolCall[]; directReply?: string } | null;
    toolLoopCount: number;
    priorToolTraces: McpToolCallRecord[];
  }) => Promise<PlannerTurnOutcome>;
  finalizeAfterTools: (ctx: {
    lockedLanguage: LanguageCode;
    plannedAction: string;
    intentDetected: string;
    toolTraces: McpToolCallRecord[];
    ragContext: RetrievedUniversalRagChunk[];
  }) => Promise<ToolExecutionOutcome>;
  buildLocalizedFallbackReply: (lang: LanguageCode) => string;
}

export interface AgentGraphState {
  session_id: string;
  organization_id: string;
  citizen_id: string | null;
  user_role: string;
  auth_token_present: boolean;
  workflow_stage: AgentWorkflowStage;
  active_task: AgentTaskType;
  locked_language: LanguageCode;
  explicit_language_switch: boolean;
  detected_utterance_language: LanguageCode;
  language_switch_reason: string;
  is_pure_language_switch: boolean;
  messages: ConversationWindowTurn[];
  user_input: string;
  rag_context: RetrievedUniversalRagChunk[];
  form_state: VoiceSessionFormState;
  auth_draft: AgentAuthDraft;
  field_provenance: Record<string, FieldProvenanceEntry>;
  field_fill_history: string[];
  editing_field: string | null;
  suspended_tasks: SuspendedTaskEntry[];
  planned_action: string;
  intent_detected: string;
  mood_or_context_switch: string;
  pending_tool_calls: PlannedMcpToolCall[];
  mcp_tool_traces: McpToolCallRecord[];
  tool_loop_count: number;
  needs_replan: boolean;
  validation_errors: AgentValidationError[];
  rbac_decision: AgentReasoningAuditLogRecord['access_control_decision'];
  capability_check: 'IN_SCOPE' | 'OUT_OF_SCOPE_ESCALATED';
  self_reflection_notes: string;
  self_corrected: boolean;
  language_guard_status: LanguageGuardStatus;
  final_reply: string;
  ui_action: VoiceUiAction;
  navigate_to: VoiceNavigateTarget;
  memory_action: 'NONE' | 'SAVED' | 'SUSPEND_TASK' | 'RESUME_TASK' | 'CLEARED';
  memory_summary: string;
  reasoning_steps: string[];
  nodes_visited: string[];
  semantic_nlu_summary: AgentReasoningAuditLogRecord['semantic_nlu_summary'];
  rag_memories_retrieved: RetrievedNluRagMatch[];
  learned_memory_saved: AgentReasoningAuditLogRecord['learned_memory_saved'];
  fields_touched: string[];
  side_outputs: Record<string, unknown>;
}

/**
 * PHASE 4: RUNTIME LANGGRAPH STATE CHANNELS (`Annotation.Root`)
 * Registers every typed field as a real LangGraph state channel while keeping TS compilation instantaneous.
 */
const AGENT_GRAPH_CHANNELS: Record<keyof AgentGraphState, ReturnType<typeof Annotation>> = {
  session_id: Annotation(),
  organization_id: Annotation(),
  citizen_id: Annotation(),
  user_role: Annotation(),
  auth_token_present: Annotation(),
  workflow_stage: Annotation(),
  active_task: Annotation(),
  locked_language: Annotation(),
  explicit_language_switch: Annotation(),
  detected_utterance_language: Annotation(),
  language_switch_reason: Annotation(),
  is_pure_language_switch: Annotation(),
  messages: Annotation(),
  user_input: Annotation(),
  rag_context: Annotation(),
  form_state: Annotation(),
  auth_draft: Annotation(),
  field_provenance: Annotation(),
  field_fill_history: Annotation(),
  editing_field: Annotation(),
  suspended_tasks: Annotation(),
  planned_action: Annotation(),
  intent_detected: Annotation(),
  mood_or_context_switch: Annotation(),
  pending_tool_calls: Annotation(),
  mcp_tool_traces: Annotation(),
  tool_loop_count: Annotation(),
  needs_replan: Annotation(),
  validation_errors: Annotation(),
  rbac_decision: Annotation(),
  capability_check: Annotation(),
  self_reflection_notes: Annotation(),
  self_corrected: Annotation(),
  language_guard_status: Annotation(),
  final_reply: Annotation(),
  ui_action: Annotation(),
  navigate_to: Annotation(),
  memory_action: Annotation(),
  memory_summary: Annotation(),
  reasoning_steps: Annotation(),
  nodes_visited: Annotation(),
  semantic_nlu_summary: Annotation(),
  rag_memories_retrieved: Annotation(),
  learned_memory_saved: Annotation(),
  fields_touched: Annotation(),
  side_outputs: Annotation(),
};

const AgentGraphAnnotation = Annotation.Root(AGENT_GRAPH_CHANNELS);

/**
 * PHASE 4: COMPILED DYNAMIC MULTI-NODE LANGGRAPH AGENT
 * Nodes:
 *   1. node_language_and_input        (Hard Language Lock & Pakistani loanword immunity)
 *   2. node_universal_rag             (Parallel hybrid search across all 5 Universal RAG collections)
 *   3. node_dynamic_agent_planner     (LangChain LLM bound to dynamic MCP tools + Semantic NLU planner)
 *   4. node_rbac_and_validation_gate  (Deterministic RBAC & strict schema validation guardrail)
 *   5. node_mcp_tool_executor         (Real @modelcontextprotocol/sdk Client.callTool execution + cyclic loop)
 *   6. node_self_reflect_and_language_guard (Critique + Pre-TTS Hard Language Guard + Episodic/Correction RAG write)
 */
export class AwaazLangGraphAgent {
  private readonly checkpointer = new MemorySaver();
  private activeHooks = new Map<string, GraphExecutionHooks>();
  private readonly compiledGraph: {
    invoke: (
      input: AgentGraphState,
      config?: { configurable?: { thread_id: string } },
    ) => Promise<AgentGraphState>;
  };
  private readonly chatModel: ChatOpenAI | null;

  constructor(
    private readonly deps: {
      env: AppEnv;
      aiProvider?: AIProvider;
      mcpClient: AmaanatMcpClient;
      universalRagService: UniversalRagService;
    },
  ) {
    // Configure real LangChain ChatOpenAI adapter pointing at active .env Groq or GitHub Models endpoint
    if (deps.env.NODE_ENV !== 'test' && deps.env.GROQ_API_KEY?.trim()) {
      this.chatModel = new ChatOpenAI({
        apiKey: deps.env.GROQ_API_KEY.trim(),
        model: deps.env.GROQ_CHAT_MODEL || 'openai/gpt-oss-120b',
        temperature: 0.1,
        maxTokens: 500,
        timeout: 5500,
        configuration: {
          baseURL: 'https://api.groq.com/openai/v1',
        },
      });
    } else if (deps.env.NODE_ENV !== 'test' && deps.env.GITHUB_TOKEN?.trim()) {
      this.chatModel = new ChatOpenAI({
        apiKey: deps.env.GITHUB_TOKEN.trim(),
        model: deps.env.GITHUB_MODEL || 'openai/gpt-4o-mini',
        temperature: 0.1,
        maxTokens: 500,
        timeout: 5500,
        configuration: {
          baseURL: 'https://models.github.ai/inference',
        },
      });
    } else {
      this.chatModel = null;
    }

    // Build real LangGraph StateGraph non-fluently to avoid exponential TS generic re-instantiation across 41 channels
    const builder = new StateGraph(AgentGraphAnnotation) as unknown as {
      addNode: (name: string, fn: (state: AgentGraphState) => Promise<Partial<AgentGraphState>>) => unknown;
      addEdge: (from: string, to: string) => unknown;
      addConditionalEdges: (from: string, router: (state: AgentGraphState) => string) => unknown;
      compile: (opts: { checkpointer: MemorySaver }) => {
        invoke: (
          input: AgentGraphState,
          config?: { configurable?: { thread_id: string } },
        ) => Promise<AgentGraphState>;
      };
    };

    builder.addNode('node_language_and_input', (state) => this.nodeLanguageAndInput(state));
    builder.addNode('node_universal_rag', (state) => this.nodeUniversalRag(state));
    builder.addNode('node_dynamic_agent_planner', (state) => this.nodeDynamicAgentPlanner(state));
    builder.addNode('node_rbac_and_validation_gate', (state) => this.nodeRbacAndValidationGate(state));
    builder.addNode('node_mcp_tool_executor', (state) => this.nodeMcpToolExecutor(state));
    builder.addNode('node_self_reflect_and_language_guard', (state) => this.nodeSelfReflectAndLanguageGuard(state));

    builder.addEdge(START, 'node_language_and_input');
    builder.addEdge('node_language_and_input', 'node_universal_rag');
    builder.addEdge('node_universal_rag', 'node_dynamic_agent_planner');
    builder.addEdge('node_dynamic_agent_planner', 'node_rbac_and_validation_gate');
    builder.addConditionalEdges('node_rbac_and_validation_gate', (state) => {
      if (state.pending_tool_calls.length > 0 && state.rbac_decision.decision === 'ALLOWED') {
        return 'node_mcp_tool_executor';
      }
      return 'node_self_reflect_and_language_guard';
    });
    builder.addConditionalEdges('node_mcp_tool_executor', (state) => {
      if (state.needs_replan && state.tool_loop_count < 2) {
        return 'node_dynamic_agent_planner';
      }
      return 'node_self_reflect_and_language_guard';
    });
    builder.addEdge('node_self_reflect_and_language_guard', END);

    this.compiledGraph = builder.compile({ checkpointer: this.checkpointer });
  }

  private getHooks(sessionId: string): GraphExecutionHooks {
    const h = this.activeHooks.get(sessionId);
    if (!h) throw new Error(`Missing LangGraph execution hooks for session ${sessionId}`);
    return h;
  }

  // --- NODE 1: HARD LANGUAGE LOCK & ANTI-FLIP INPUT NORMALIZATION ---
  private async nodeLanguageAndInput(state: AgentGraphState): Promise<Partial<AgentGraphState>> {
    const hooks = this.getHooks(state.session_id);
    const memory = hooks.memory;
    const currentLocked = memory.locked_language ?? memory.detected_language ?? 'ur';

    const decision = resolveHardLanguageLock({
      transcript: state.user_input,
      currentLockedLanguage: currentLocked,
      wasLanguageLocked: memory.language_locked,
      uiLanguageHint: hooks.uiLanguageHint,
      uiExplicitSwitch: hooks.uiExplicitSwitch,
      whisperDetectedLanguage: hooks.whisperDetectedLanguage,
    });

    if (decision.switched) {
      if (!Array.isArray(memory.language_switch_history)) memory.language_switch_history = [];
      memory.language_switch_history.push({
        from: currentLocked,
        to: decision.locked_language,
        reason: decision.switch_reason,
        timestamp: new Date().toISOString(),
      });
    }

    memory.locked_language = decision.locked_language;
    memory.detected_language = decision.locked_language;
    if (state.user_input.trim() || hooks.uiExplicitSwitch) {
      memory.language_locked = true;
    }

    const stepNote = `Node 1 [Language Lock]: locked_language='${decision.locked_language}', utterance_detected='${decision.detected_utterance_language}', switched=${decision.switched} (${decision.switch_reason}), stage='${memory.workflow_stage}'.`;

    return {
      locked_language: decision.locked_language,
      detected_utterance_language: decision.detected_utterance_language,
      explicit_language_switch: decision.switched && (decision.switch_reason === 'explicit_ui_click' || decision.switch_reason === 'explicit_voice_command'),
      language_switch_reason: decision.switch_reason,
      is_pure_language_switch: decision.is_pure_switch_command,
      reasoning_steps: [...state.reasoning_steps, stepNote],
      nodes_visited: [...state.nodes_visited, 'node_language_and_input'],
    };
  }

  // --- NODE 2: UNIVERSAL HYBRID RAG ACROSS ALL 5 COLLECTIONS ---
  private async nodeUniversalRag(state: AgentGraphState): Promise<Partial<AgentGraphState>> {
    const queryText = state.user_input.trim() || `${state.workflow_stage} ${state.active_task}`;
    const collections: UniversalRagCollection[] = [
      'policy_and_services_kb',
      'scam_and_fraud_kb',
      'multilingual_nlu_slang_kb',
      'episodic_conversation_kb',
      'self_learning_corrections_kb',
    ];

    const chunks = await this.deps.universalRagService.searchUniversalRag({
      query: queryText,
      organizationId: state.organization_id,
      collections,
      sessionId: state.session_id,
      citizenId: state.citizen_id ?? undefined,
      topKPerCollection: 2,
      maxTotal: 8,
    });

    const hitCols = Array.from(new Set(chunks.map((c) => c.collection)));
    const stepNote = `Node 2 [Universal RAG]: Retrieved ${chunks.length} grounded chunks across [${hitCols.join(', ') || 'none'}].`;

    return {
      rag_context: chunks,
      reasoning_steps: [...state.reasoning_steps, stepNote],
      nodes_visited: [...state.nodes_visited, 'node_universal_rag'],
    };
  }

  // --- NODE 3: DYNAMIC LANGCHAIN + MCP TOOL-BOUND AGENT PLANNER ---
  private async nodeDynamicAgentPlanner(state: AgentGraphState): Promise<Partial<AgentGraphState>> {
    const hooks = this.getHooks(state.session_id);
    // Ensure real MCP Client has connected & dynamically discovered tools via protocol `listTools()`
    const discovered = await this.deps.mcpClient.listDiscoveredTools();

    // Optional live LangChain LLM + MCP DynamicStructuredTool binding on open-ended hub queries
    let llmToolSuggestion: { toolCalls: PlannedMcpToolCall[]; directReply?: string } | null = null;
    if (
      this.chatModel &&
      state.user_input.trim().length > 0 &&
      !state.is_pure_language_switch &&
      state.workflow_stage === 'AGENT_HUB' &&
      state.tool_loop_count === 0 &&
      state.auth_token_present
    ) {
      try {
        const lcTools = await this.deps.mcpClient.buildLangChainTools(hooks.auth);
        const bound = (
          this.chatModel as unknown as {
            bindTools: (tools: unknown[]) => {
              invoke: (messages: unknown[]) => Promise<{ tool_calls?: Array<{ name?: string; args?: Record<string, unknown> }>; content?: unknown }>;
            };
          }
        ).bindTools(lcTools);
        const ragSummary = state.rag_context
          .slice(0, 4)
          .map((c) => `[${c.collection}] ${c.title}: ${c.snippet}`)
          .join('\n');
        const langDirective =
          state.locked_language === 'en'
            ? 'Reply STRICTLY in clear English.'
            : `Reply STRICTLY in natural Urdu script (اردو) matching locked_language='${state.locked_language}'. NEVER reply in English.`;

        const aiMsg = await bound.invoke([
          new SystemMessage(
            `You are Amaanat Awaaz Relief Agent. ${langDirective}\nAvailable MCP tools (${discovered.length}): use tools for status, scam check, policy RAG, officer messaging, or escalations.\nUniversal RAG Context:\n${ragSummary}`,
          ),
          new HumanMessage(state.user_input),
        ]);

        const toolCalls: PlannedMcpToolCall[] = Array.isArray(aiMsg.tool_calls)
          ? aiMsg.tool_calls
              .filter((tc): tc is { name: string; args: Record<string, unknown> } => Boolean(tc?.name))
              .map((tc) => ({ name: tc.name, args: (tc.args ?? {}) as Record<string, unknown> }))
          : [];
        const textContent = typeof aiMsg.content === 'string' ? aiMsg.content.trim() : '';
        if (toolCalls.length > 0 || textContent) {
          llmToolSuggestion = { toolCalls, directReply: textContent || undefined };
        }
      } catch {
        // Gracefully continue with deterministic + Semantic NLU domain planner
      }
    }

    const plan = await hooks.runDomainPlanner({
      lockedLanguage: state.locked_language,
      explicitSwitched: state.explicit_language_switch,
      isPureLanguageSwitch: state.is_pure_language_switch,
      ragContext: state.rag_context,
      llmToolSuggestion,
      toolLoopCount: state.tool_loop_count,
      priorToolTraces: state.mcp_tool_traces,
    });

    const stepNote = `Node 3 [Dynamic Planner]: action='${plan.planned_action}', intent='${plan.intent_detected}', queued_mcp_tools=[${plan.pending_tool_calls.map((t) => t.name).join(', ') || 'none'}], discovered_mcp_tools=${discovered.length}.`;

    return {
      workflow_stage: plan.workflow_stage,
      active_task: plan.active_task,
      form_state: plan.form_state,
      auth_draft: plan.auth_draft,
      field_fill_history: plan.field_fill_history,
      editing_field: plan.editing_field,
      suspended_tasks: plan.suspended_tasks,
      field_provenance: plan.field_provenance,
      pending_tool_calls: plan.pending_tool_calls,
      validation_errors: plan.validation_errors,
      rbac_decision: plan.rbac_decision,
      capability_check: plan.capability_check,
      planned_action: plan.planned_action,
      intent_detected: plan.intent_detected,
      mood_or_context_switch: plan.mood_or_context_switch,
      memory_action: plan.memory_action,
      memory_summary: plan.memory_summary,
      final_reply: plan.draft_reply,
      ui_action: plan.ui_action,
      navigate_to: plan.navigate_to,
      semantic_nlu_summary: plan.semantic_nlu_summary,
      rag_memories_retrieved: plan.rag_memories_retrieved,
      learned_memory_saved: plan.learned_memory_saved,
      fields_touched: plan.fields_touched,
      side_outputs: { ...state.side_outputs, ...plan.side_outputs },
      needs_replan: false,
      reasoning_steps: [...state.reasoning_steps, stepNote, ...plan.reasoning_steps],
      nodes_visited: [...state.nodes_visited, 'node_dynamic_agent_planner'],
    };
  }

  // --- NODE 4: DETERMINISTIC RBAC & STRICT VALIDATION GATE ---
  private async nodeRbacAndValidationGate(state: AgentGraphState): Promise<Partial<AgentGraphState>> {
    const protectedTools = new Set([
      'submit_relief_claim',
      'get_my_applications_status',
      'ask_department_officer',
      'get_officer_messages',
      'escalate_to_human_admin',
    ]);

    const hooks = this.getHooks(state.session_id);
    const blockedProtected = state.pending_tool_calls.filter(
      (tc) => protectedTools.has(tc.name) && !state.auth_token_present && !hooks.isTelephonyMode,
    );

    if (blockedProtected.length > 0) {
      const deniedDecision: AgentReasoningAuditLogRecord['access_control_decision'] = {
        decision: 'DENIED',
        actor_role: state.user_role,
        authenticated: false,
        rule_reason: `RBAC Gate blocked unauthenticated execution of protected MCP tool(s): ${blockedProtected.map((t) => t.name).join(', ')}.`,
      };
      const fallbackMsg =
        state.locked_language === 'en'
          ? 'Please sign in or create your voice account first before accessing personal records or submitting claims.'
          : 'آپ کی سیکیورٹی کے لیے ذاتی ریکارڈ دیکھنے یا درخواست جمع کرنے سے پہلے لاگ ان یا نیا اکاؤنٹ بنانا ضروری ہے۔';

      return {
        pending_tool_calls: [],
        rbac_decision: deniedDecision,
        final_reply: fallbackMsg,
        ui_action: 'NAVIGATE_AUTH',
        reasoning_steps: [
          ...state.reasoning_steps,
          `Node 4 [RBAC & Validation Gate]: DENIED unauthenticated tools [${blockedProtected.map((t) => t.name).join(', ')}].`,
        ],
        nodes_visited: [...state.nodes_visited, 'node_rbac_and_validation_gate'],
      };
    }

    const stepNote = `Node 4 [RBAC & Validation Gate]: RBAC=${state.rbac_decision.decision}, validation_errors=${state.validation_errors.length}, approved_mcp_tools=${state.pending_tool_calls.length}.`;
    return {
      reasoning_steps: [...state.reasoning_steps, stepNote],
      nodes_visited: [...state.nodes_visited, 'node_rbac_and_validation_gate'],
    };
  }

  // --- NODE 5: REAL MCP CLIENT TOOL EXECUTOR (`@modelcontextprotocol/sdk`) ---
  private async nodeMcpToolExecutor(state: AgentGraphState): Promise<Partial<AgentGraphState>> {
    const hooks = this.getHooks(state.session_id);
    const executedTraces: McpToolCallRecord[] = [];

    for (const tc of state.pending_tool_calls) {
      const trace = await this.deps.mcpClient.callToolViaProtocol(tc.name, tc.args, hooks.auth);
      executedTraces.push(trace);
    }

    const allTraces = [...state.mcp_tool_traces, ...executedTraces];
    const postOutcome = await hooks.finalizeAfterTools({
      lockedLanguage: state.locked_language,
      plannedAction: state.planned_action,
      intentDetected: state.intent_detected,
      toolTraces: executedTraces,
      ragContext: state.rag_context,
    });

    const stepNote = `Node 5 [MCP Client Executor]: Executed ${executedTraces.length} tool(s) via @modelcontextprotocol/sdk Client [${executedTraces.map((t) => `${t.tool_name}:${t.status}(${t.duration_ms}ms)`).join(', ')}].`;

    return {
      workflow_stage: postOutcome.workflow_stage ?? state.workflow_stage,
      active_task: postOutcome.active_task ?? state.active_task,
      form_state: postOutcome.form_state ?? state.form_state,
      auth_draft: postOutcome.auth_draft ?? state.auth_draft,
      suspended_tasks: postOutcome.suspended_tasks ?? state.suspended_tasks,
      editing_field: postOutcome.editing_field !== undefined ? postOutcome.editing_field : state.editing_field,
      validation_errors: postOutcome.validation_errors ?? state.validation_errors,
      memory_action: postOutcome.memory_action ?? state.memory_action,
      memory_summary: postOutcome.memory_summary ?? state.memory_summary,
      final_reply: postOutcome.draft_reply ?? state.final_reply,
      ui_action: postOutcome.ui_action ?? state.ui_action,
      navigate_to: postOutcome.navigate_to !== undefined ? postOutcome.navigate_to : state.navigate_to,
      side_outputs: { ...state.side_outputs, ...(postOutcome.side_outputs ?? {}) },
      pending_tool_calls: [],
      mcp_tool_traces: allTraces,
      tool_loop_count: state.tool_loop_count + 1,
      needs_replan: Boolean(postOutcome.needs_replan),
      reasoning_steps: [...state.reasoning_steps, stepNote, ...(postOutcome.reasoning_steps ?? [])],
      nodes_visited: [...state.nodes_visited, 'node_mcp_tool_executor'],
    };
  }

  // --- NODE 6: SELF-REFLECTION + HARD PRE-TTS LANGUAGE GUARD + EPISODIC & CORRECTION RAG WRITE ---
  private async nodeSelfReflectAndLanguageGuard(state: AgentGraphState): Promise<Partial<AgentGraphState>> {
    const hooks = this.getHooks(state.session_id);
    const prev = hooks.prevFormSnapshot;
    const formState = { ...state.form_state };
    let selfCorrected = false;
    const notes: string[] = [];

    // 1. Monotonic state self-reflection critique
    if (prev.name && !formState.name && !formState.submitted_case_id) {
      formState.name = prev.name;
      selfCorrected = true;
      notes.push('Restored wiped full_name.');
    }
    if (prev.cnic && !formState.cnic && !formState.submitted_case_id) {
      formState.cnic = prev.cnic;
      selfCorrected = true;
      notes.push('Restored wiped cnic.');
    }
    if (prev.district && !formState.district && !formState.submitted_case_id) {
      formState.district = prev.district;
      selfCorrected = true;
      notes.push('Restored wiped district.');
    }
    if (formState.amount !== null && (formState.amount < 500 || formState.amount > 100000)) {
      formState.amount = null;
      selfCorrected = true;
      notes.push('Stripped out-of-range requested amount.');
    }
    if (formState.monthly_income !== null && (formState.monthly_income < 0 || formState.monthly_income > 500000)) {
      formState.monthly_income = null;
      selfCorrected = true;
      notes.push('Stripped out-of-range monthly income.');
    }

    // 2. PRE-TTS HARD OUTPUT LANGUAGE CONSISTENCY GUARD!
    const fallbackLocalized = hooks.buildLocalizedFallbackReply(state.locked_language);
    const rawReply = state.final_reply?.trim() || fallbackLocalized;
    const guarded = await enforceReplyLanguageGuard({
      replyText: rawReply,
      lockedLanguage: state.locked_language,
      explicitSwitched: state.explicit_language_switch,
      aiProvider: this.deps.aiProvider,
      nodeEnv: this.deps.env.NODE_ENV,
      fallbackLocalizedReply: fallbackLocalized,
    });
    if (guarded.status === 'REWRITTEN_TO_LOCKED_LANG') {
      selfCorrected = true;
      notes.push(`Pre-TTS Language Guard rewrote reply strictly into locked_language='${state.locked_language}'.`);
    }

    // 3. Index user utterance into episodic_conversation_kb for long-horizon semantic memory!
    if (state.user_input.trim().length >= 4 && !state.intent_detected.includes('login')) {
      const fieldsSummary = [
        formState.district ? `district=${formState.district}` : '',
        formState.monthly_income !== null ? `income=${formState.monthly_income}` : '',
        formState.amount !== null ? `amount=${formState.amount}` : '',
        formState.reference_number ? `ref=${formState.reference_number}` : '',
      ]
        .filter(Boolean)
        .join(', ');
      await this.deps.universalRagService.indexEpisodicTurn({
        organizationId: state.organization_id,
        sessionId: state.session_id,
        citizenId: state.citizen_id,
        language: state.locked_language,
        stage: state.workflow_stage,
        userText: state.user_input,
        intent: state.intent_detected,
        fieldsSummary,
      });
    }

    const reflectionSummary = selfCorrected
      ? notes.join(' ')
      : `Verified: locked_language=${state.locked_language} (${guarded.status}), validations=${state.validation_errors.length === 0 ? 'clean' : `${state.validation_errors.length} caught`}, RBAC=${state.rbac_decision.decision}, capability=${state.capability_check}, mcp_tools=${state.mcp_tool_traces.length}, rag_chunks=${state.rag_context.length}.`;

    const stepNote = `Node 6 [Self-Reflect & Language Guard]: ${reflectionSummary}`;

    return {
      form_state: formState,
      final_reply: guarded.replyText,
      language_guard_status: guarded.status,
      self_corrected: selfCorrected,
      self_reflection_notes: reflectionSummary,
      reasoning_steps: [...state.reasoning_steps, stepNote],
      nodes_visited: [...state.nodes_visited, 'node_self_reflect_and_language_guard'],
    };
  }

  async invokeTurn(initial: {
    session_id: string;
    organization_id: string;
    citizen_id: string | null;
    user_role: string;
    auth_token_present: boolean;
    workflow_stage: AgentWorkflowStage;
    active_task: AgentTaskType;
    locked_language: LanguageCode;
    messages: ConversationWindowTurn[];
    user_input: string;
    form_state: VoiceSessionFormState;
    auth_draft: AgentAuthDraft;
    field_provenance: Record<string, FieldProvenanceEntry>;
    field_fill_history: string[];
    editing_field: string | null;
    suspended_tasks: SuspendedTaskEntry[];
    hooks: GraphExecutionHooks;
  }): Promise<AgentGraphState> {
    this.activeHooks.set(initial.session_id, initial.hooks);
    try {
      const result = await this.compiledGraph.invoke(
        {
          session_id: initial.session_id,
          organization_id: initial.organization_id,
          citizen_id: initial.citizen_id,
          user_role: initial.user_role,
          auth_token_present: initial.auth_token_present,
          workflow_stage: initial.workflow_stage,
          active_task: initial.active_task,
          locked_language: initial.locked_language,
          explicit_language_switch: false,
          detected_utterance_language: initial.locked_language,
          language_switch_reason: 'pending',
          is_pure_language_switch: false,
          messages: initial.messages,
          user_input: initial.user_input,
          rag_context: [],
          form_state: initial.form_state,
          auth_draft: initial.auth_draft,
          field_provenance: initial.field_provenance,
          field_fill_history: initial.field_fill_history,
          editing_field: initial.editing_field,
          suspended_tasks: initial.suspended_tasks,
          planned_action: 'idle',
          intent_detected: 'open_greeting',
          mood_or_context_switch: 'neutral',
          pending_tool_calls: [],
          mcp_tool_traces: [],
          tool_loop_count: 0,
          needs_replan: false,
          validation_errors: [],
          rbac_decision: {
            decision: 'ALLOWED',
            actor_role: initial.user_role,
            authenticated: initial.auth_token_present,
            rule_reason: initial.auth_token_present
              ? `Authenticated ${initial.user_role} verified.`
              : 'Public onboarding / informational tool allowed.',
          },
          capability_check: 'IN_SCOPE',
          self_reflection_notes: '',
          self_corrected: false,
          language_guard_status: 'PASSED',
          final_reply: '',
          ui_action: 'UPDATE_FORM',
          navigate_to: null,
          memory_action: 'NONE',
          memory_summary: 'No working memory state mutation.',
          reasoning_steps: [],
          nodes_visited: [],
          semantic_nlu_summary: null,
          rag_memories_retrieved: [],
          learned_memory_saved: null,
          fields_touched: [],
          side_outputs: {},
        },
        {
          configurable: { thread_id: initial.session_id },
        },
      );
      return result;
    } finally {
      this.activeHooks.delete(initial.session_id);
    }
  }
}
