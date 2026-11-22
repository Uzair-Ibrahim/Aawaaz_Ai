# Awaaz — System Architecture

## 1. Repository Layout (Separate Frontend & Backend in Same Directory)

Per explicit project direction, Awaaz separates the **frontend** and **backend** into dedicated workspaces inside the same repository root while sharing typed contracts via `shared/`:

```text
Amaanat_Ai_Hackathon_CC_V3/
├── frontend/          # Next.js App Router (TypeScript, Tailwind CSS, Dexie IndexedDB, i18n/RTL)
├── backend/           # Express + TypeScript REST API (/api/v1), OpenAPI/Swagger UI, services, adapters
├── shared/            # @awaaz/shared — Zod schemas, domain types, role/state enums, language registry
├── supabase/          # PostgreSQL migrations (SaaS foundation + Idea 1 schema + pgvector + RLS)
├── docs/              # PROJECT_SPEC.md, ARCHITECTURE.md, IMPLEMENTATION.md, OPENAPI.yaml
├── .env.example       # Documented environment variable placeholders
└── package.json       # npm workspaces orchestrating shared, backend, and frontend
```

> **Note on `implementation.md` §3.1 deviation:** `implementation.md` originally proposed Next.js Route Handlers inside a single Next.js app. Per the explicit instruction to keep separate `backend/` and `frontend/` in the same directory, the REST API (`/api/v1/*`) lives in `backend/` (Express + TypeScript) and the UI lives in `frontend/` (Next.js App Router). This preserves the modular monolith deployment simplicity while enforcing an even cleaner boundary between UI, API/business logic, and external secrets.

## 2. Layered Boundaries

```text
[ Next.js Frontend (frontend/) ]
   ├── Shared SaaS Shell (Auth, Workspace Switcher, Role Guards, i18n/RTL, Offline Sync Bar)
   ├── Module Registry (Idea 1 registered; slots for Future Ideas 2 & 3)
   └── Idea 1 UI (Citizen Wizard, Helper, Officer, Admin, Auditor)
                │
                │ HTTPS / REST JSON + Multipart (/api/v1)
                ▼
[ Express Backend API (backend/) ]
   ├── Security Middleware (Helmet, CORS, Rate Limiting, Size Limits, Origin/CSRF check, Zod validation)
   ├── Shared SaaS Core (src/core/)
   │     ├── auth/          (Supabase Auth JWT verifier; isolated dev-local session mode for dev/test only)
   │     ├── tenancy/       (Organization resolution & strict organization_id enforcement)
   │     ├── rbac/          (5-role least-privilege permission matrix + server-side guards)
   │     ├── audit/         (Append-only audit_logs writer & query service)
   │     ├── notifications/ (Tenant-scoped notification service)
   │     ├── storage/       (Private storage adapter: Supabase Private Storage signed URLs / local dev private dir)
   │     ├── database/      (DataStore interface: Supabase PostgreSQL + isolated dev/test memory store)
   │     └── modules/       (Backend ModuleManifest registry)
   ├── Replaceable Provider Adapters (src/integrations/)
   │     ├── ai/            (AIProvider interface -> @google/genai GeminiAdapter)
   │     └── voice/         (VoiceProvider interface -> LingoscribeAdapter, optional GeminiAudioAdapter)
   └── Feature Modules (src/modules/)
         └── relief-assistance/  (Idea 1: workflow, deterministic rules, extraction, documents, RAG, consent, mock services)
                │
                ▼
[ Supabase PostgreSQL + pgvector + Supabase Auth + Private Storage ]
```

## 3. Multi-User SaaS Tenant Isolation

Every tenant-owned record carries `organization_id UUID NOT NULL REFERENCES organizations(id)`:

1. **Authentication:** Every protected `/api/v1/*` endpoint verifies the caller's bearer token / HTTP-only session cookie on the server.
2. **Tenant Context:** The server resolves the caller's active `organization_id` from `organization_memberships` (validated against `X-Organization-Id` header or user default workspace). A user can **never** pass an arbitrary `organization_id` they do not belong to.
3. **Database Enforcement:**
   - All repository queries filter by `organization_id`.
   - PostgreSQL RLS policies (`supabase/migrations/0001_saas_foundation.sql` and `0002_relief_assistance.sql`) enforce `organization_id` membership and role/ownership rules at the database layer.
   - Private storage paths are tenant-prefixed: `org/<organization_id>/cases/<case_id>/<document_id>/<filename>`.
4. **Role + Resource Authorization:**
   - Citizens can only access cases where `citizen.user_id = auth.user.id`.
   - Helpers can only access cases with an active, non-expired, non-withdrawn `consents` record matching `(helper_id, citizen_id, case_id)` within the same `organization_id`.
   - Officers can only access cases within their `organization_id` (and department if assigned).
   - Auditors have strictly read-only access within their `organization_id`.

## 4. Provider Independence & Honest Capabilities

- **Gemini AI (`@google/genai`):** Configurable `GEMINI_MODEL` and `GEMINI_EMBEDDING_MODEL`, request timeout, per-user rate limiting, strict Zod validation on all structured outputs, max 1 constrained retry, no raw audio stored in `ai_runs`.
- **Speech Provider (`VoiceProvider`):** Language registry (`en`, `ur`, `pa`, `sd`, `bal`, `ps`) keeps internal language codes decoupled from provider codes and tracks explicit `stt_supported` / `tts_supported` verification flags. Because Lingoscribe does not publish public verified REST endpoint schemas, the Lingoscribe adapter is configurable via environment variables and returns an explicit `503` error when unconfigured rather than fabricating transcripts or audio.

## 5. Extension Points for Future Ideas 2 and 3

Future Awaaz ideas plug into the platform without modifying Idea 1 or the SaaS foundation:

1. **Shared contracts:** Add `shared/src/modules/<idea-slug>/` and export from `shared/src/index.ts`.
2. **Database:** Add a new numbered migration `supabase/migrations/0003_<idea-slug>.sql` referencing `organizations(id)` and `profiles(id)` with RLS policies.
3. **Backend module:** Add `backend/src/modules/<idea-slug>/module.ts` implementing `BackendModule` (`id`, `name`, `basePath`, `router`, `requiredRoles`) and register it in `backend/src/core/modules/registry.ts`.
4. **Frontend module:** Add `frontend/src/app/<idea-slug>/` + `frontend/src/components/<idea-slug>/` and register its `FrontendModule` metadata in `frontend/src/lib/modules/registry.ts` so it appears automatically in the SaaS workspace navigation.
