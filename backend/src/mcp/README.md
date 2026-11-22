# Amaanat / Awaaz Protocol-Compliant MCP Server (`@modelcontextprotocol/sdk`)

The Amaanat Relief Assistant exposes a standards-compliant **Model Context Protocol (MCP)** server with **15 Zod-validated tools** covering citizen lookup, voice auth, relief claim submission, status tracking, scam SMS detection, policy RAG, multimodal document OCR, direct Department Officer messaging, human admin escalation, and Universal Hybrid RAG memory.

## Registered MCP Tools (15)
1. `lookup_citizen`
2. `submit_relief_claim`
3. `get_claim_status`
4. `check_suspicious_message`
5. `query_policy_rag`
6. `update_consent`
7. `extract_document_info`
8. `register_citizen_voice_account`
9. `login_citizen_voice_account`
10. `escalate_to_human_admin`
11. `get_my_applications_status`
12. `ask_department_officer`
13. `get_officer_messages`
14. `rag_universal_search`
15. `rag_save_learned_correction`

## Transport 1: HTTP JSON-RPC & SSE (Mounted on Backend)
When running `npm run dev`:
- **JSON-RPC Endpoint:** `POST http://localhost:4000/api/v1/mcp` (and convenience mount `POST http://localhost:4000/mcp`)
- **Tool Discovery REST Endpoint:** `GET http://localhost:4000/api/v1/mcp/tools`
- **SSE Stream Endpoint:** `GET http://localhost:4000/api/v1/mcp/sse`

## Transport 2: Standalone `stdio` Transport (Gemini CLI / Claude Desktop / MCP Inspector)
Run directly:
```bash
npm run mcp:stdio --workspace=@awaaz/backend
```

Example MCP client configuration:
```json
{
  "mcpServers": {
    "amaanat-relief-mcp": {
      "command": "npm",
      "args": ["run", "mcp:stdio", "--workspace=@awaaz/backend"],
      "cwd": "C:/Users/AK.COM/OneDrive/Desktop/Amaanat_Ai_Hackathon_CC_V3"
    }
  }
}
```

## Internal LangGraph Integration (`InMemoryTransport`)
Inside the backend runtime, `AmaanatMcpClient` (`backend/src/mcp/client.ts`) connects to `createProtocolMcpServer()` over `@modelcontextprotocol/sdk`'s `InMemoryTransport.createLinkedPair()`, discovers all 15 tools dynamically via `client.listTools()`, wraps them as LangChain `DynamicStructuredTool`s, and executes real `client.callTool()` RPCs with RBAC propagation.
