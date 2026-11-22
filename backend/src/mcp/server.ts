import { AsyncLocalStorage } from 'node:async_hooks';
import { LANGUAGE_CODES } from '@awaaz/shared';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AuthContext } from '../core/auth/auth-service';
import type { AmaanatMcpServer } from './mcp-tools';

/**
 * Request-scoped AsyncLocalStorage so authenticated RBAC context propagates cleanly
 * through the official @modelcontextprotocol/sdk McpServer protocol boundary.
 */
export const mcpAuthContextStorage = new AsyncLocalStorage<AuthContext | undefined>();

function wrapMcpResult(payload: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
    ...(isError ? { isError: true } : {}),
  };
}

/**
 * PHASE 2: REAL PROTOCOL-COMPLIANT MCP SERVER (`@modelcontextprotocol/sdk`)
 * Registers all 15 Amaanat / Awaaz Relief & Universal RAG tools with strict Zod schemas.
 */
export function createProtocolMcpServer(core: AmaanatMcpServer): McpServer {
  const server = new McpServer({
    name: 'amaanat-relief-mcp',
    version: '2.0.0',
  });

  // Typed wrapper avoids exponential TS 5.8 Zod v3/v4 ShapeOutput generic expansion across 15 tools
  // while registering the exact strict Zod inputSchema on the real @modelcontextprotocol/sdk McpServer at runtime.
  const registerTool = (
    name: string,
    config: { description: string; inputSchema: Record<string, z.ZodTypeAny> },
    cb: (args: Record<string, unknown>) => Promise<ReturnType<typeof wrapMcpResult>>,
  ) => {
    (
      server as unknown as {
        registerTool: (
          n: string,
          c: { description: string; inputSchema: Record<string, z.ZodTypeAny> },
          fn: (args: Record<string, unknown>) => Promise<ReturnType<typeof wrapMcpResult>>,
        ) => void;
      }
    ).registerTool(name, config, cb);
  };

  const invoke = async (toolName: string, args: Record<string, unknown>) => {
    const auth = mcpAuthContextStorage.getStore();
    const rec = await core.callTool(toolName, args, auth);
    return wrapMcpResult(rec.result, rec.status === 'error');
  };

  registerTool(
    'lookup_citizen',
    {
      description:
        'Find a citizen profile and their relief record by mock CNIC/identity reference (e.g., MOCK-ID-1001), phone number, email, or display name.',
      inputSchema: {
        identifier: z.string().min(1).describe('Citizen mock CNIC/ID reference, phone number, email, or full name.'),
      },
    },
    async (args) => invoke('lookup_citizen', args),
  );

  registerTool(
    'submit_relief_claim',
    {
      description:
        'Submit or update a citizen relief claim and run the deterministic eligibility and decision-band engine (READY_FOR_OFFICER vs NEEDS_MORE_INFO vs NEEDS_HUMAN_REVIEW). Requires explicit consent_confirmed=true.',
      inputSchema: {
        citizen_id: z.string().min(1).describe('Citizen ID, user ID, or mock identity reference.'),
        amount: z.coerce.number().min(0).describe('Requested relief amount in PKR (500 to 100,000).'),
        reason: z.string().min(2).describe('Reason for requesting relief assistance.'),
        category: z.string().default('flood_relief').describe('Relief category (flood_relief, widow_support, medical_relief, emergency_cash).'),
        consent_confirmed: z.boolean().describe('Must be true after explicit verbal/user confirmation.'),
        full_name: z.string().optional(),
        mock_identity_reference: z.string().optional(),
        district: z.string().optional(),
        household_size: z.coerce.number().optional(),
        monthly_income: z.coerce.number().optional(),
        employment_status: z.string().optional(),
        confidence_score: z.coerce.number().min(0).max(1).optional(),
        document_blurry_or_missing: z.boolean().optional(),
        language: z.enum(LANGUAGE_CODES).optional().default('ur'),
      },
    },
    async (args) => invoke('submit_relief_claim', args),
  );

  registerTool(
    'get_claim_status',
    {
      description:
        'Return the latest relief claim status, application reference number (AWZ-XXXXXXXX), evidence completeness score, officer notes, and mock payment reference for a citizen.',
      inputSchema: {
        citizen_id: z.string().min(1).describe('Citizen ID, case reference (AWZ-...), or mock identity reference.'),
      },
    },
    async (args) => invoke('get_claim_status', args),
  );

  registerTool(
    'check_suspicious_message',
    {
      description:
        'Analyze an SMS, WhatsApp message, or call transcript for Pakistani scam/phishing/fake-OTP/8171 registration fee indicators.',
      inputSchema: {
        message_text: z.string().min(1).describe('Suspicious SMS or message text to verify.'),
        sender: z.string().optional().default('').describe('Optional sender phone number or short-code.'),
      },
    },
    async (args) => invoke('check_suspicious_message', args),
  );

  registerTool(
    'query_policy_rag',
    {
      description:
        'Query the grounded Relief Policy RAG knowledge base. Refuses out-of-domain questions and returns cited policy answers.',
      inputSchema: {
        question: z.string().min(2).describe('Citizen policy or eligibility question.'),
        language: z.enum(LANGUAGE_CODES).optional().default('ur'),
      },
    },
    async (args) => invoke('query_policy_rag', args),
  );

  registerTool(
    'update_consent',
    {
      description: 'Grant or withdraw citizen data processing consent.',
      inputSchema: {
        citizen_id: z.string().min(1).describe('Citizen ID or user ID.'),
        action: z.enum(['grant', 'withdraw']).describe('Whether to grant or withdraw consent.'),
      },
    },
    async (args) => invoke('update_consent', args),
  );

  registerTool(
    'extract_document_info',
    {
      description:
        'Multimodal vision tool to read synthetic CNIC/identity cards, income certificates, utility bills, or scam SMS screenshots from base64 image/text data.',
      inputSchema: {
        image_base64: z.string().min(4).describe('Base64-encoded image or document content.'),
        doc_type: z.string().default('mock_identity_document').describe('Document type.'),
        mime_type: z.string().optional().default('image/png'),
      },
    },
    async (args) => invoke('extract_document_info', args),
  );

  registerTool(
    'register_citizen_voice_account',
    {
      description:
        'Create a validated citizen account via voice onboarding (full_name 3-80 letters, exact 13-digit CNIC, valid Pakistani phone, 4-digit PIN) and issue an authenticated JWT session.',
      inputSchema: {
        full_name: z.string().min(3).max(80),
        cnic: z.string().min(13).max(20),
        phone: z.string().min(10).max(20),
        pin: z.string().min(4).max(6),
        language: z.enum(LANGUAGE_CODES).optional().default('ur'),
      },
    },
    async (args) => invoke('register_citizen_voice_account', args),
  );

  registerTool(
    'login_citizen_voice_account',
    {
      description:
        'Authenticate an existing citizen or staff account by CNIC, phone, username, or email along with PIN or password, issuing an authenticated JWT session.',
      inputSchema: {
        identifier: z.string().min(3).max(120),
        pin_or_password: z.string().min(4).max(128),
      },
    },
    async (args) => invoke('login_citizen_voice_account', args),
  );

  registerTool(
    'escalate_to_human_admin',
    {
      description:
        'Escalate an out-of-scope or human-authority citizen request (claim approval, bank transfer, NADRA changes, appeal, human agent request) to Officer Hamza or Admin Ayesha.',
      inputSchema: {
        citizen_id: z.string().min(1),
        session_id: z.string().min(1),
        assigned_admin: z.string().min(2),
        reason_out_of_scope: z.string().min(5),
        conversation_summary: z.string().min(5),
        reasoning_audit_log_id: z.string().nullable().optional(),
      },
    },
    async (args) => invoke('escalate_to_human_admin', args),
  );

  registerTool(
    'get_my_applications_status',
    {
      description:
        'Return ALL relief applications belonging strictly to the logged-in citizen (RBAC ownership enforced) with reference_number, status, requested_amount, decision_band, and officer_notes.',
      inputSchema: {
        reference_filter: z.string().optional().describe('Optional AWZ-XXXXXXXX reference filter.'),
      },
    },
    async (args) => invoke('get_my_applications_status', args),
  );

  registerTool(
    'ask_department_officer',
    {
      description:
        'Send a direct question from an authenticated citizen to Department Officer Hamza, linking their latest application automatically and returning an INQ-XXXXXX tracking ID.',
      inputSchema: {
        question_text: z.string().min(3).max(1500),
        application_ref: z.string().nullable().optional(),
        language: z.enum(LANGUAGE_CODES).optional().default('ur'),
      },
    },
    async (args) => invoke('ask_department_officer', args),
  );

  registerTool(
    'get_officer_messages',
    {
      description: 'Fetch all direct Department Officer inquiries and official replies strictly belonging to the logged-in citizen.',
      inputSchema: {},
    },
    async (args) => invoke('get_officer_messages', args),
  );

  registerTool(
    'rag_universal_search',
    {
      description:
        'Search across all 5 Universal Hybrid RAG collections (policy_and_services_kb, scam_and_fraud_kb, multilingual_nlu_slang_kb, episodic_conversation_kb, self_learning_corrections_kb).',
      inputSchema: {
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
      },
    },
    async (args) => invoke('rag_universal_search', args),
  );

  registerTool(
    'rag_save_learned_correction',
    {
      description:
        'Persist a newly learned citizen correction, rollback phrasing, or normalized colloquial utterance into self_learning_corrections_kb.',
      inputSchema: {
        raw_utterance: z.string().min(2),
        resolved_intent: z.string().min(2),
        target_field: z.string().nullable().optional(),
        clean_value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional().default(null),
        language: z.enum(LANGUAGE_CODES).optional().default('ur'),
        source: z.enum(['LEARNED_FROM_CORRECTION', 'LEARNED_FROM_CONFIRMATION']).optional().default('LEARNED_FROM_CORRECTION'),
        session_id: z.string().nullable().optional(),
      },
    },
    async (args) => invoke('rag_save_learned_correction', args),
  );

  registerTool(
    'check_duplicate_and_name_variants',
    {
      description:
        'Run Pakistani phonetic & Levenshtein 3-way entity resolution to catch exact CNIC duplicates without falsely merging or blocking distinct homonyms.',
      inputSchema: {
        full_name: z.string().nullable().optional(),
        cnic: z.string().nullable().optional(),
        phone: z.string().nullable().optional(),
        district: z.string().nullable().optional(),
      },
    },
    async (args) => invoke('check_duplicate_and_name_variants', args),
  );

  registerTool(
    'get_my_consent_status',
    {
      description:
        'Show the citizen who currently has access to their data and their granular consent toggles.',
      inputSchema: {},
    },
    async (args) => invoke('get_my_consent_status', args),
  );

  registerTool(
    'update_granular_consent',
    {
      description:
        'Update granular citizen consent scopes (share_with_relief_officer, allow_ai_voice_processing, allow_document_verification).',
      inputSchema: {
        share_with_relief_officer: z.boolean().optional(),
        allow_ai_voice_processing: z.boolean().optional(),
        allow_document_verification: z.boolean().optional(),
      },
    },
    async (args) => invoke('update_granular_consent', args),
  );

  registerTool(
    'withdraw_all_consent',
    {
      description:
        'Immediately withdraw all citizen data-sharing consent and revoke officer & AI access with immutable audit logging.',
      inputSchema: {},
    },
    async (args) => invoke('withdraw_all_consent', args),
  );

  registerTool(
    'analyze_document_authenticity',
    {
      description:
        'Analyze an uploaded CNIC or relief document for tampering vs low-quality photo false alarms without blindly blocking real citizens.',
      inputSchema: {
        image_base64: z.string().optional(),
        file_name: z.string().optional(),
        doc_type: z.string().optional().default('mock_identity_document'),
        sample_preset: z.enum(['valid_cnic', 'blurry_rural_photo', 'tampered_edited_doc']).optional(),
        language: z.enum(LANGUAGE_CODES).optional().default('ur'),
      },
    },
    async (args) => invoke('analyze_document_authenticity', args),
  );

  return server;
}
