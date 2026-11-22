# Awaaz — AI-Powered Multilingual Multi-User SaaS

> **Prototype Notice:** Awaaz uses **synthetic data only** and is **not** an official government service. It does not integrate with NADRA or real payment gateways, and AI never independently approves applications or initiates real payments.

## Overview

Awaaz is a multi-user SaaS platform built with **separate `frontend/` and `backend/` workspaces in the same repository directory**, plus a shared TypeScript contracts workspace (`shared/`).

- **Current Implemented Module (Idea 1):** Multilingual, voice-first **Mock Relief-Assistance Application** (`implementation.md`) with guided one-question-per-screen intake, RTL localization (`en`, `ur`, `pa`, `sd`, `bal`, `ps`), Dexie/IndexedDB offline draft sync with conflict detection, private tenant-scoped document uploads, grounded RAG Policy Assistant, deterministic versioned Eligibility Rules Engine + Evidence Completeness Scoring, human Officer Review Queue, Mock Payment simulation, Consent Grant/Withdrawal with immediate server-side revocation, and Append-Only Audit Logs.
- **Future Modules (Ideas 2 & 3):** Not invented or implemented yet. Extension points are cleanly separated in `shared/`, `backend/src/core/modules/registry.ts`, `frontend/src/lib/modules/registry.ts`, and numbered `supabase/migrations/`.

## Repository Structure

```text
├── frontend/          # Next.js 15 App Router, TypeScript, Tailwind CSS, Dexie IndexedDB, i18n/RTL
├── backend/           # Express + TypeScript REST API (/api/v1), OpenAPI/Swagger UI, SaaS Core, Adapters
├── shared/            # @awaaz/shared — Zod schemas, domain types, roles, case states, language registry
├── supabase/          # PostgreSQL migrations (0001_saas_foundation.sql, 0002_relief_assistance.sql) + RLS
├── docs/              # PROJECT_SPEC.md, ARCHITECTURE.md, IMPLEMENTATION.md, OPENAPI.yaml
├── .env.example       # Environment variable placeholders (never commit real secrets)
└── package.json       # Root npm workspaces
```

## Quick Start (Local Development)

### Prerequisites
- Node.js 22+ (tested on Node.js `v24.21.0`) and npm 11+

### 1. Install Dependencies
```bash
npm install
npm run build:shared
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env` (for backend) and `frontend/.env.local` (for frontend public vars):
```env
# frontend/.env.local
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000/api/v1
```
- **Local Development without external keys:** Leave `DATA_STORE_MODE=memory` and `AUTH_MODE=dev_local` (strictly blocked when `NODE_ENV=production`). Synthetic test accounts (`citizen@demo.awaaz.local`, `helper@demo.awaaz.local`, `officer@demo.awaaz.local`, `admin@demo.awaaz.local`, `auditor@demo.awaaz.local`, `citizen-beta@demo.awaaz.local`, password `DemoPass123!`) are seeded for local multi-tenant testing.
- **Production / Live Supabase:** Set `DATA_STORE_MODE=supabase`, `AUTH_MODE=supabase`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and apply `supabase/migrations/0001_saas_foundation.sql` followed by `0002_relief_assistance.sql`.
- **Live Gemini AI:** Set `GEMINI_API_KEY` (and optionally `GEMINI_MODEL`, `GEMINI_EMBEDDING_MODEL`).
- **Live Speech Provider:** Set `VOICE_PROVIDER=lingoscribe` with verified `VOICE_PROVIDER_BASE_URL` and `LINGOSCRIBE_API_KEY` (or `VOICE_PROVIDER=gemini` with `GEMINI_API_KEY` for STT). When unconfigured, the app transparently exposes text input fallback without fabricating transcripts.

### 3. Run Backend & Frontend Together
```bash
npm run dev
```
- Frontend UI: `http://localhost:3000`
- Backend API: `http://localhost:4000/api/v1`
- OpenAPI / Swagger Docs: `http://localhost:4000/api/v1/docs`

## Checks & Tests

```bash
npm run build:shared
npm run typecheck
npm run test
npm run build
npm run lint
```

## Adding Future Ideas (Ideas 2 & 3) as Independent Modules

1. **Shared Contracts:** Create `shared/src/modules/<idea-slug>/` and re-export from `shared/src/index.ts`.
2. **Database Schema:** Add `supabase/migrations/0003_<idea-slug>.sql` with `organization_id UUID NOT NULL REFERENCES public.organizations(id)` and RLS policies using `public.is_org_member(...)` / `public.has_org_role(...)`.
3. **Backend Module:** Create `backend/src/modules/<idea-slug>/module.ts` implementing `BackendFeatureModule` and register it in `backend/src/app.ts` via `moduleRegistry.register(...)`.
4. **Frontend Module:** Add routes under `frontend/src/app/<idea-slug>/` and register the module entry in `frontend/src/lib/modules/registry.ts`.
