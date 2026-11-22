# Awaaz — Project Specification (v1.0 + Multi-User SaaS Alignment)

> **Prototype Notice:** Awaaz is a hackathon/SaaS prototype using **synthetic data only**. It is **not** an official government service, does not connect to NADRA or real payment gateways, and AI never independently approves applications or initiates real payments.

## 1. Product Direction

Awaaz is an AI-powered, multi-user SaaS platform designed to host multiple public-service / civic-assistance modules under a shared SaaS foundation.

- **Current Release (Idea 1):** Multilingual, voice-first **Mock Relief-Assistance Application** workflow as defined in `implementation.md`.
- **Future Releases (Ideas 2 & 3):** Not yet specified. This codebase establishes modular boundaries (`modules/<module-id>`) and a shared SaaS core (auth, organizations/workspaces, RBAC, tenant isolation, audit logging, notifications, provider adapters, shared UI) so future ideas can be added independently without rewriting Idea 1 or the SaaS foundation.

## 2. Core User Journey (Idea 1 — Mock Relief Assistance)

1. User authenticates and selects/operates within an **Organization / Workspace** (tenant boundary).
2. Citizen (or explicitly consented Community Helper) selects a preferred language (`en`, `ur`, `pa`, `sd`, `bal`, `ps`) with RTL support where applicable.
3. Citizen reviews privacy notice and grants explicit processing consent.
4. Citizen starts a mock relief-assistance application (with idempotency key and Dexie/IndexedDB offline draft saving).
5. Guided one-question-per-screen wizard collects answers via push-to-talk voice (when a verified speech provider is configured) or text fallback, with Gemini structured extraction and mandatory citizen confirmation on critical fields.
6. Citizen uploads synthetic supporting documents (mock identity, mock proof of income, mock residence, mock application form) to private tenant-scoped storage; AI extracts fields and backend flags cross-field conflicts without auto-rejecting.
7. Citizen asks policy questions via the RAG Policy Assistant backed by synthetic policy documents, pgvector retrieval, source citations, and prompt-injection safety boundaries.
8. Deterministic Eligibility Rules Engine evaluates the application against the active versioned ruleset and computes an **Evidence Completeness Score** (0–100) with hard safety overrides.
9. Authorized Department Officer reviews assigned/workspace cases, inspects evidence/AI traces, and approves, rejects, or requests more information.
10. Approved applications may trigger a clearly labeled **Mock Payment** simulation.
11. Citizens can withdraw consent at any time; server-side enforcement immediately revokes helper access and logs the event to the append-only audit trail.

## 3. Roles & Least-Privilege Permissions

All roles operate within strict **organization (tenant) boundaries**:

| Role | Allowed Capabilities | Explicitly Denied |
|---|---|---|
| `citizen` | Own cases, own answers/confirmations, own documents, policy Q&A, own consent grant/withdrawal, own status/notifications | Other citizens' cases, modifying rules, approving cases, internal officer notes |
| `helper` | Explicitly consented citizens/cases within tenant, assist filling forms/uploading documents with active consent | Unrelated citizens, granting consent on citizen's behalf, approving cases, post-withdrawal access |
| `officer` | Assigned/department-scoped cases in tenant, review AI extractions & documents, add internal review notes, request info, approve/reject, queue/complete mock payments on approved cases | Cross-tenant access, modifying security settings, modifying rules |
| `admin` | Manage workspace users/roles/departments, configure & publish versioned eligibility rules, manage policies, view operational metrics | Modifying/deleting audit logs, reading sensitive citizen docs without operational authorization |
| `auditor` | Read-only access to tenant audit logs, AI decision traces (`ai_runs`), consent history, rule publication history | Modifying applications, approving/rejecting cases, modifying audit logs |

## 4. Explicit Out of Scope (v1.0)

- Real government integrations, NADRA verification, or real payment gateways
- Real citizen PII or real identity documents
- Paid billing / subscription checkout flows (account/organization structure is billing-ready via `plan_tier` metadata only)
- Speculative implementation of future Ideas 2 and 3
- Autonomous AI approval or rejection of applications
