"""
Amaanat / Awaaz FastMCP Server (Python stdio & SSE bridge).
Connects external MCP clients (Claude Desktop, Cursor, FastMCP Inspector)
to the live Amaanat/Awaaz backend MCP endpoints at http://localhost:4000/api/v1/mcp.
"""

import os
import json
import urllib.request
from typing import Any, Dict
from pydantic import BaseModel, Field

try:
    from fastmcp import FastMCP
except ImportError:
    from mcp.server.fastmcp import FastMCP  # type: ignore

BACKEND_MCP_URL = os.environ.get("AMAANAT_BACKEND_MCP_URL", "http://localhost:4000/api/v1/mcp")

mcp = FastMCP("Amaanat Autonomous Multimodal Voice & Relief MCP Server")


def _call_backend_tool(tool_name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
    payload = json.dumps({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {
            "name": tool_name,
            "arguments": arguments,
        },
    }).encode("utf-8")
    req = urllib.request.Request(
        BACKEND_MCP_URL,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        body = json.loads(resp.read().decode("utf-8"))
        return body.get("result", body)


@mcp.tool()
def lookup_citizen(identifier: str) -> Dict[str, Any]:
    """Find a citizen profile by mock CNIC/ID reference (MOCK-ID-1001), phone number, email, or name."""
    return _call_backend_tool("lookup_citizen", {"identifier": identifier})


@mcp.tool()
def submit_relief_claim(
    citizen_id: str,
    amount: float,
    reason: str,
    category: str = "MOCK_RELIEF_01",
    consent_confirmed: bool = False,
) -> Dict[str, Any]:
    """Submit a relief claim and run the deterministic eligibility & decision-band engine."""
    return _call_backend_tool(
        "submit_relief_claim",
        {
            "citizen_id": citizen_id,
            "amount": amount,
            "reason": reason,
            "category": category,
            "consent_confirmed": consent_confirmed,
        },
    )


@mcp.tool()
def get_claim_status(citizen_id: str) -> Dict[str, Any]:
    """Return latest relief claim status, reference number (AWZ-XXXXXXXX), and payment reference."""
    return _call_backend_tool("get_claim_status", {"citizen_id": citizen_id})


@mcp.tool()
def check_suspicious_message(message_text: str, sender: str = "") -> Dict[str, Any]:
    """Analyze an SMS or message for scam/phishing/fake-OTP/fraudulent relief fee indicators."""
    return _call_backend_tool(
        "check_suspicious_message",
        {"message_text": message_text, "sender": sender},
    )


@mcp.tool()
def query_policy_rag(question: str) -> Dict[str, Any]:
    """Query the grounded Relief Policy RAG pipeline (refuses out-of-domain questions)."""
    return _call_backend_tool("query_policy_rag", {"question": question})


@mcp.tool()
def update_consent(citizen_id: str, action: str) -> Dict[str, Any]:
    """Grant or withdraw citizen data processing consent (action: 'grant' or 'withdraw')."""
    return _call_backend_tool("update_consent", {"citizen_id": citizen_id, "action": action})


@mcp.tool()
def extract_document_info(image_base64: str, doc_type: str = "mock_identity_document") -> Dict[str, Any]:
    """Multimodal vision tool to read synthetic CNIC/identity cards, bills, or scam screenshots."""
    return _call_backend_tool(
        "extract_document_info",
        {"image_base64": image_base64, "doc_type": doc_type},
    )


if __name__ == "__main__":
    transport = os.environ.get("MCP_TRANSPORT", "stdio")
    mcp.run(transport=transport)
