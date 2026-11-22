# Awaaz — Implementation Decisions & Provider Verification Log

## 1. Repository Inspection (Phase 0)

- **Initial State:** Empty repository containing only `implementation.md`.
- **Runtime Toolchain Verified:** Windows, Node.js `v24.21.0`, npm `11.19.0`, Python `3.14.7`. (`pnpm` not installed; npm workspaces used.)
- **Existing Code Preserved:** `implementation.md` preserved unmodified.

## 2. Key Engineering Decisions & Documented Assumptions

| Area | Decision | Rationale |
|---|---|---|
| Repo layout | Separate `frontend/` (Next.js App Router) + `backend/` (Express + TypeScript) + `shared/` (npm workspaces) in the same root directory | Explicitly requested by user while keeping single-repo maintainability |
| Multi-user tenancy | Added `organizations` and `organization_memberships` tables with `organization_id` across all domain tables | Required for real multi-user SaaS tenant isolation and billing-ready account structure (`plan_tier` metadata, no billing checkout) |
| Data store modes | Production requires Supabase PostgreSQL + Supabase Auth + Supabase Private Storage. Development/test (`NODE_ENV !== 'production'` and `DATA_STORE_MODE=memory`) provides an isolated in-memory repository implementing the exact same interface, tenant checks, RBAC, consent revocation, and audit append-only rules | Allows full local verification & automated tests without fabricating live external services; strictly blocked in `NODE_ENV=production` |
| Auth modes | `AUTH_MODE=supabase` verifies Supabase Auth JWTs and user sessions. `AUTH_MODE=dev_local` (blocked in `NODE_ENV=production`) provides scrypt password hashing + signed HMAC tokens for local development when Supabase credentials are not yet provisioned | Avoids blocking local development while preserving Supabase Auth as the real production auth system |
| Embedding dimensions | `VECTOR(768)` using `outputDimensionality: 768` on Gemini embedding model (`GEMINI_EMBEDDING_MODEL`, default `text-embedding-004`) | Verified via official `@google/genai` SDK documentation (`ai.models.embedContent` supports `config.outputDimensionality: 768`) |
| RAG fallback when AI unconfigured | Synthetic policies are seeded and searchable via deterministic lexical/TF-IDF matching explicitly tagged `mode: "lexical_excerpt_only"` when `GEMINI_API_KEY` is absent; full vector + grounded LLM synthesis activates only when `GEMINI_API_KEY` is configured | Never pretends LLM generation happened without an API key, while keeping synthetic policy retrieval transparent and inspectable |
| Offline mode | Dexie (`IndexedDB`) stores `localDraftId`, `serverCaseId`, `organizationId`, `updatedAt`, `syncStatus`, `idempotencyKey`, `schemaVersion`, and `serverUpdatedAt`. Sync sends `idempotencyKey` and `expectedServerUpdatedAt` to detect conflicts instead of silently overwriting newer server records | Satisfies `implementation.md` §17 strictly |

## 3. External Provider Verification Log (§3.2)

### 3.1 Google Gemini API — Verified
- **Official SDK:** `@google/genai` (replaces deprecated `@google/generative-ai`).
- **Authentication:** `GEMINI_API_KEY` (server-side environment variable only).
- **Methods Verified:**
  - `ai.models.generateContent({ model, contents, config })` for structured JSON extraction, multimodal document extraction, and grounded policy Q&A.
  - `ai.models.embedContent({ model, contents, config: { outputDimensionality: 768 } })` for policy/query embeddings.
- **Model Configuration:** Configured via `GEMINI_MODEL` (default `gemini-2.5-flash`) and `GEMINI_EMBEDDING_MODEL` (default `text-embedding-004`). No single model name is hardcoded across the app.
- **Safety & Cost Controls:** Server-only key, configurable timeout (`AI_REQUEST_TIMEOUT_MS`), per-user rate limiting, max 1 constrained retry on Zod schema failure, prompt-injection fencing for retrieved policy/document text, no raw voice recordings logged in `ai_runs`.
- **Live Test Status:** Live API calls require a valid `GEMINI_API_KEY` at runtime.

### 3.2 Lingoscribe Speech Provider — Unverified Public REST Schema
- **Verification Finding:** Lingoscribe (`lingoscribe.ai`) focuses on Pakistani regional languages (Urdu, Punjabi, Sindhi, Balochi, Pashto), but does **not** publish publicly accessible, verified REST API endpoint paths, request/response schemas, or TTS API specifications without enterprise provisioning.
- **Engineering Action:**
  - Implemented `VoiceProvider` interface (`transcribe`, `synthesize`) and a configurable `LingoscribeVoiceProvider` adapter whose base URL and paths are provided via environment variables (`VOICE_PROVIDER_BASE_URL`, `LINGOSCRIBE_API_KEY`, `LINGOSCRIBE_STT_PATH`, `LINGOSCRIBE_TTS_PATH`).
  - Set `stt_supported: false` and `tts_supported: false` by default in `LanguageRegistry` (`verification_status: 'unverified_pending_provider'`) unless explicitly enabled via verified provider configuration.
  - Added an optional `GeminiAudioVoiceProvider` (`VOICE_PROVIDER=gemini`) for STT when `GEMINI_API_KEY` is configured, still clearly noting language verification status.
  - When no verified speech provider is configured, `/api/v1/voice/transcribe` and `/api/v1/voice/speak` return HTTP `503` with clear structured error codes; the frontend preserves drafts and keeps full text fallback + optional browser-native speech synthesis (explicitly labeled as browser fallback, not Lingoscribe).
