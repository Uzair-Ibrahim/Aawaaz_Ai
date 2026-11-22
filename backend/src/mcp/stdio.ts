import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadEnv } from '../config/env';
import { AuditService } from '../core/audit/audit-service';
import { AuthService } from '../core/auth/auth-service';
import { MemoryDataStore } from '../core/database/memory-store';
import { SupabaseDataStore } from '../core/database/supabase-store';
import type { DataStore } from '../core/database/types';
import { NotificationService } from '../core/notifications/notification-service';
import { createPrivateStorage } from '../core/storage/storage';
import { GeminiAIProvider } from '../integrations/ai/gemini';
import { ConsentService } from '../modules/relief-assistance/consent/consent-service';
import { DocumentService } from '../modules/relief-assistance/documents/document-service';
import { RagService } from '../modules/relief-assistance/rag/rag-service';
import { CaseService } from '../modules/relief-assistance/services/case-service';
import { UniversalRagService } from '../modules/relief-assistance/services/universal-rag-service';
import { AmaanatMcpServer } from './mcp-tools';
import { createProtocolMcpServer } from './server';

/**
 * PHASE 2: Standalone MCP Server over `stdio` transport.
 * Run with: `npm run mcp:stdio --workspace=@awaaz/backend`
 * Compatible with Gemini CLI, Claude Desktop, and MCP Inspector.
 */
async function main() {
  const env = loadEnv();
  const store: DataStore =
    env.DATA_STORE_MODE === 'supabase'
      ? new SupabaseDataStore(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
      : new MemoryDataStore(true);
  const storage = createPrivateStorage(env);
  const aiProvider = new GeminiAIProvider(env);
  const audit = new AuditService(store);
  const notifications = new NotificationService(store);
  const authService = new AuthService(env, store);
  const consentService = new ConsentService(store, audit);
  const caseService = new CaseService(store, consentService, audit, notifications);
  const documentService = new DocumentService(store, storage, aiProvider, audit, env.MAX_UPLOAD_SIZE_MB * 1024 * 1024);
  const ragService = new RagService(store, aiProvider, audit);
  const universalRagService = new UniversalRagService({ env, store, aiProvider });
  await universalRagService.ensureSeeded();

  const coreMcp = new AmaanatMcpServer({
    store,
    caseService,
    consentService,
    ragService,
    documentService,
    aiProvider,
    audit,
    authService,
    universalRagService,
  });

  const server = createProtocolMcpServer(coreMcp);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('[amaanat-relief-mcp stdio] Fatal error:', err);
  process.exit(1);
});
