import readline from 'node:readline';
import { loadEnv } from '../src/config/env';
import { AuditService } from '../src/core/audit/audit-service';
import { MemoryDataStore } from '../src/core/database/memory-store';
import { NotificationService } from '../src/core/notifications/notification-service';
import { createPrivateStorage } from '../src/core/storage/storage';
import { GeminiAIProvider } from '../src/integrations/ai/gemini';
import { ConsentService } from '../src/modules/relief-assistance/consent/consent-service';
import { DocumentService } from '../src/modules/relief-assistance/documents/document-service';
import { RagService } from '../src/modules/relief-assistance/rag/rag-service';
import { CaseService } from '../src/modules/relief-assistance/services/case-service';
import { AmaanatMcpServer } from './mcp-tools';

const env = loadEnv();
const store = new MemoryDataStore(true);
const storage = createPrivateStorage(env);
const aiProvider = new GeminiAIProvider(env);
const audit = new AuditService(store);
const notifications = new NotificationService(store);
const consentService = new ConsentService(store, audit);
const caseService = new CaseService(store, consentService, audit, notifications);
const documentService = new DocumentService(store, storage, aiProvider, audit, env.MAX_UPLOAD_SIZE_MB * 1024 * 1024);
const ragService = new RagService(store, aiProvider, audit);

const mcpServer = new AmaanatMcpServer({
  store,
  caseService,
  consentService,
  ragService,
  documentService,
  aiProvider,
  audit,
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

rl.on('line', async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const req = JSON.parse(trimmed) as {
      jsonrpc?: string;
      id?: string | number | null;
      method?: string;
      params?: Record<string, unknown>;
    };
    const id = req.id ?? null;

    if (req.method === 'initialize') {
      process.stdout.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'amaanat-relief-mcp', version: '1.0.0' },
          },
        })}\n`,
      );
      return;
    }

    if (req.method === 'tools/list') {
      process.stdout.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id,
          result: { tools: mcpServer.listTools() },
        })}\n`,
      );
      return;
    }

    if (req.method === 'tools/call') {
      const toolName = String(req.params?.name ?? '');
      const toolArgs = (req.params?.arguments as Record<string, unknown>) ?? {};
      const callRecord = await mcpServer.callTool(toolName, toolArgs);
      process.stdout.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(callRecord.result) }],
            structuredContent: callRecord.result,
            isError: callRecord.status === 'error',
          },
        })}\n`,
      );
      return;
    }

    process.stdout.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${String(req.method)}` },
      })}\n`,
    );
  } catch (err) {
    process.stdout.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: err instanceof Error ? err.message : 'Parse error' },
      })}\n`,
    );
  }
});
