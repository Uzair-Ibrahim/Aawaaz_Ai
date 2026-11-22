import { DynamicStructuredTool } from '@langchain/core/tools';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { z } from 'zod';
import type { AuthContext } from '../core/auth/auth-service';
import type { AmaanatMcpServer, McpToolCallRecord, McpToolDescriptor } from './mcp-tools';
import { createProtocolMcpServer, mcpAuthContextStorage } from './server';

export type McpLangChainTool = DynamicStructuredTool<z.ZodObject<Record<string, z.ZodTypeAny>>>;

/**
 * PHASE 2: REAL PROTOCOL-COMPLIANT MCP CLIENT (`@modelcontextprotocol/sdk`)
 * Connects directly to the real `McpServer` over `InMemoryTransport.createLinkedPair()` (zero port flakiness),
 * dynamically discovers tools via `client.listTools()`, executes real `client.callTool()` RPCs,
 * and exposes every discovered MCP tool as a LangChain `DynamicStructuredTool` for the LangGraph agent.
 */
export class AmaanatMcpClient {
  private readonly client: Client;
  private connectPromise: Promise<void> | null = null;
  private discoveredTools: McpToolDescriptor[] = [];

  constructor(private readonly coreServer: AmaanatMcpServer) {
    this.client = new Client(
      {
        name: 'awaaz-langgraph-mcp-client',
        version: '2.0.0',
      },
      {
        capabilities: {},
      },
    );
  }

  async ensureConnected(): Promise<void> {
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = (async () => {
      const protocolServer = createProtocolMcpServer(this.coreServer);
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await protocolServer.connect(serverTransport);
      await this.client.connect(clientTransport);
      const listed = await this.client.listTools();
      this.discoveredTools = listed.tools.map((t) => ({
        name: t.name,
        description: t.description ?? '',
        inputSchema: (t.inputSchema ?? { type: 'object', properties: {} }) as Record<string, unknown>,
      }));
    })();
    return this.connectPromise;
  }

  async listDiscoveredTools(): Promise<McpToolDescriptor[]> {
    await this.ensureConnected();
    return [...this.discoveredTools];
  }

  getProtocolInfo(): { transport: string; discovered_tools_count: number; sdk: string } {
    return {
      transport: 'InMemoryTransport (@modelcontextprotocol/sdk)',
      discovered_tools_count: this.discoveredTools.length,
      sdk: '@modelcontextprotocol/sdk',
    };
  }

  async callToolViaProtocol(
    toolName: string,
    args: Record<string, unknown>,
    auth?: AuthContext,
  ): Promise<McpToolCallRecord> {
    await this.ensureConnected();
    const started = Date.now();
    const sanitizedArgs: Record<string, unknown> = { ...args };
    if ('pin' in sanitizedArgs) sanitizedArgs.pin = '****';
    if ('pin_or_password' in sanitizedArgs) sanitizedArgs.pin_or_password = '****';

    try {
      const rpcRes = await mcpAuthContextStorage.run(auth, () =>
        this.client.callTool({
          name: toolName,
          arguments: args,
        }),
      );

      const contentArr = Array.isArray(rpcRes.content) ? rpcRes.content : [];
      const firstText = contentArr.find(
        (c): c is { type: 'text'; text: string } =>
          typeof c === 'object' && c !== null && (c as { type?: string }).type === 'text',
      )?.text;

      let parsedResult: unknown = firstText ?? rpcRes;
      if (typeof firstText === 'string') {
        try {
          parsedResult = JSON.parse(firstText);
        } catch {
          parsedResult = firstText;
        }
      }

      return {
        tool_name: toolName,
        arguments: sanitizedArgs,
        result: parsedResult,
        status: rpcRes.isError ? 'error' : 'success',
        duration_ms: Date.now() - started,
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      return {
        tool_name: toolName,
        arguments: sanitizedArgs,
        result: { error: err instanceof Error ? err.message : String(err) },
        status: 'error',
        duration_ms: Date.now() - started,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Dynamically wraps every MCP Server tool discovered via `client.listTools()`
   * as a LangChain `DynamicStructuredTool` that executes real `client.callTool()`.
   */
  async buildLangChainTools(
    auth: AuthContext | undefined,
    onToolTrace?: (trace: McpToolCallRecord) => void,
  ): Promise<DynamicStructuredTool[]> {
    const tools = await this.listDiscoveredTools();
    const genericSchema = z.object({}).passthrough();
    return tools.map((descriptor) => {
      return new DynamicStructuredTool({
        name: descriptor.name,
        description: descriptor.description,
        schema: genericSchema,
        func: async (inputArgs: Record<string, unknown>) => {
          const trace = await this.callToolViaProtocol(descriptor.name, inputArgs, auth);
          onToolTrace?.(trace);
          return JSON.stringify(trace.result);
        },
      }) as unknown as DynamicStructuredTool;
    });
  }
}
