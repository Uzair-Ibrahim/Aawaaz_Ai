# Amaanat / Awaaz MCP Server (`backend/mcp_server/`)

Exposes the 7 Amaanat relief-assistance, scam-verification, policy-RAG, consent, and multimodal document tools over **Model Context Protocol (MCP)**:

1. `lookup_citizen(identifier)` — Find citizen profile by mock CNIC/identity reference (`MOCK-ID-1001`), phone, email, or name.
2. `submit_relief_claim(citizen_id, amount, reason, category, consent_confirmed)` — Runs the deterministic eligibility & decision-band engine (`READY_FOR_OFFICER` vs `NEEDS_HUMAN_REVIEW`).
3. `get_claim_status(citizen_id)` — Returns latest claim status, reference number (`AWZ-XXXXXXXX`), and payment reference.
4. `check_suspicious_message(message_text, sender)` — Detects fake OTP requests, upfront fee scams, and phishing links.
5. `query_policy_rag(question)` — Queries the grounded Policy RAG knowledge base (refuses out-of-domain questions).
6. `update_consent(citizen_id, action)` — Grants or withdraws citizen processing consent.
7. `extract_document_info(image_base64, doc_type)` — Multimodal vision tool to read synthetic CNIC/income documents or scam SMS screenshots.

---

## 1. Streamable HTTP / JSON-RPC 2.0 & SSE Endpoints (Built into Backend)

When running `npm run dev`, the MCP server is automatically mounted on the backend at:
- **JSON-RPC 2.0 (`initialize`, `tools/list`, `tools/call`):** `POST http://localhost:4000/api/v1/mcp` (and `POST http://localhost:4000/mcp`)
- **SSE Stream:** `GET http://localhost:4000/api/v1/mcp/sse`
- **REST Tool Directory:** `GET http://localhost:4000/api/v1/mcp/tools`

---

## 2. Running Standalone (`stdio` or Python FastMCP)

### Node/TypeScript `stdio` transport:
```bash
npx tsx backend/mcp_server/stdio.ts
```

### Python FastMCP transport:
```bash
pip install fastmcp
python backend/mcp_server/server.py
```

---

## 3. MCP Client Configuration (`claude_desktop_config.json` / `.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "amaanat-relief-mcp": {
      "command": "npx",
      "args": ["tsx", "backend/mcp_server/stdio.ts"],
      "env": {
        "NODE_ENV": "development"
      }
    },
    "amaanat-relief-http": {
      "url": "http://localhost:4000/api/v1/mcp"
    }
  }
}
```
