-- ==============================================================================
-- Migration 0013: Complete Idempotent Supabase Schema Sync
-- Guarantees all core SaaS, Relief, Agentic, Universal RAG, Dynamic Policy Rules,
-- Granular Citizen Consent, and Document Authenticity tables exist cleanly.
-- Safe to run repeatedly on any live Supabase PostgreSQL database.
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Live Dynamic Policy Rule Versions (Challenge 04)
CREATE TABLE IF NOT EXISTS public.eligibility_rule_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  version TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  max_monthly_income_pkr NUMERIC NOT NULL DEFAULT 25000,
  act_alone_max_amount_pkr NUMERIC NOT NULL DEFAULT 5000,
  ask_proof_max_amount_pkr NUMERIC NOT NULL DEFAULT 12000,
  min_confidence_act_alone NUMERIC NOT NULL DEFAULT 0.85,
  min_confidence_ask_proof NUMERIC NOT NULL DEFAULT 0.65,
  false_approval_cost_pkr NUMERIC NOT NULL DEFAULT 15000,
  false_delay_cost_pkr NUMERIC NOT NULL DEFAULT 600,
  wrongful_rejection_cost_pkr NUMERIC NOT NULL DEFAULT 4500,
  change_reason TEXT NOT NULL DEFAULT 'Initial baseline policy v1.0',
  updated_by TEXT NOT NULL DEFAULT 'System Seed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eligibility_rule_versions_org_active
  ON public.eligibility_rule_versions (organization_id, is_active, created_at DESC);

-- 2. Granular Citizen Consent Records (Challenge 06)
CREATE TABLE IF NOT EXISTS public.citizen_consent_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  citizen_id UUID NOT NULL,
  user_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'GRANTED',
  scopes JSONB NOT NULL DEFAULT '{"share_with_relief_officer": true, "allow_ai_voice_processing": true, "allow_document_verification": true}'::JSONB,
  who_has_access JSONB NOT NULL DEFAULT '[]'::JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, user_id)
);

-- 3. Officer Inquiries (Citizen <-> Department Officer Q&A)
CREATE TABLE IF NOT EXISTS public.officer_inquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  tracking_reference TEXT NOT NULL,
  user_id UUID NULL,
  citizen_id UUID NULL,
  citizen_name TEXT NOT NULL DEFAULT 'Citizen',
  department_id TEXT NOT NULL DEFAULT 'RELIEF_ASSISTANCE',
  language TEXT NOT NULL DEFAULT 'ur',
  question_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  officer_reply TEXT NULL,
  assigned_officer_id UUID NULL,
  assigned_officer_name TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  replied_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_officer_inquiries_org_dept
  ON public.officer_inquiries (organization_id, department_id, created_at DESC);

-- 4. Agent Reasoning Audit Logs (Dual-View Audit Trace — Challenge 05)
CREATE TABLE IF NOT EXISTS public.agent_reasoning_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  department_id TEXT NOT NULL DEFAULT 'GENERAL_INQUIRY',
  related_application_id UUID NULL,
  session_id TEXT NOT NULL,
  citizen_id UUID NULL,
  user_id UUID NULL,
  workflow_stage TEXT NOT NULL DEFAULT 'AGENT_HUB',
  detected_language TEXT NOT NULL DEFAULT 'en',
  locked_language TEXT NOT NULL DEFAULT 'en',
  user_input TEXT NOT NULL DEFAULT '',
  intent_detected TEXT NOT NULL DEFAULT 'unknown',
  mood_or_context_switch TEXT NULL,
  access_control_decision JSONB NOT NULL DEFAULT '{}'::JSONB,
  capability_check TEXT NOT NULL DEFAULT 'IN_SCOPE',
  reasoning_steps JSONB NOT NULL DEFAULT '[]'::JSONB,
  self_reflection_check JSONB NOT NULL DEFAULT '{}'::JSONB,
  memory_snapshot_diff JSONB NOT NULL DEFAULT '{}'::JSONB,
  mcp_tools_invoked JSONB NOT NULL DEFAULT '[]'::JSONB,
  validation_errors JSONB NOT NULL DEFAULT '[]'::JSONB,
  rule_version_used TEXT NULL,
  rule_snapshot_json JSONB NULL,
  model_version TEXT NULL,
  confidence_score NUMERIC NULL,
  decision_tier TEXT NULL,
  duplicate_check_result JSONB NULL,
  consent_event_type TEXT NULL,
  final_agent_response TEXT NOT NULL DEFAULT '',
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_reasoning_audit_org_dept_ts
  ON public.agent_reasoning_audit_logs (organization_id, department_id, timestamp DESC);

-- 5. Agent Human-in-the-Loop Escalations
CREATE TABLE IF NOT EXISTS public.agent_escalations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  ticket_reference TEXT NOT NULL,
  session_id TEXT NOT NULL,
  citizen_id UUID NULL,
  user_id UUID NULL,
  citizen_name TEXT NOT NULL DEFAULT 'Citizen',
  detected_language TEXT NOT NULL DEFAULT 'en',
  out_of_scope_request TEXT NOT NULL,
  agent_reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  resolution_notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Universal RAG Collections & Documents (5 Hybrid Collections)
CREATE TABLE IF NOT EXISTS public.universal_rag_collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NULL,
  collection_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  document_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.universal_rag_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NULL,
  collection TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  session_id TEXT NULL,
  citizen_id UUID NULL,
  source TEXT NOT NULL DEFAULT 'SEED_KB',
  hit_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_universal_rag_docs_collection
  ON public.universal_rag_documents (collection, updated_at DESC);

-- 7. Document Authenticity Checks & Logs (Challenge 08)
CREATE TABLE IF NOT EXISTS public.document_authenticity_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  citizen_id UUID NULL,
  user_id UUID NULL,
  doc_type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  outcome TEXT NOT NULL,
  forgery_score NUMERIC NOT NULL,
  false_alarm_risk TEXT NOT NULL,
  image_quality_score NUMERIC NOT NULL,
  tamper_indicators JSONB NOT NULL DEFAULT '[]'::JSONB,
  quality_issues JSONB NOT NULL DEFAULT '[]'::JSONB,
  cross_field_mismatches JSONB NOT NULL DEFAULT '[]'::JSONB,
  extracted_fields JSONB NOT NULL DEFAULT '{}'::JSONB,
  citizen_message TEXT NOT NULL,
  false_alarm_disclaimer TEXT NOT NULL,
  non_blocking_options JSONB NOT NULL DEFAULT '[]'::JSONB,
  department_id TEXT NOT NULL DEFAULT 'RELIEF_ASSISTANCE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.document_authenticity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  citizen_id UUID NULL,
  user_id UUID NULL,
  doc_type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  outcome TEXT NOT NULL,
  forgery_score NUMERIC NOT NULL,
  false_alarm_risk TEXT NOT NULL,
  image_quality_score NUMERIC NOT NULL,
  tamper_indicators JSONB NOT NULL DEFAULT '[]'::JSONB,
  quality_issues JSONB NOT NULL DEFAULT '[]'::JSONB,
  cross_field_mismatches JSONB NOT NULL DEFAULT '[]'::JSONB,
  extracted_fields JSONB NOT NULL DEFAULT '{}'::JSONB,
  citizen_message TEXT NOT NULL,
  false_alarm_disclaimer TEXT NOT NULL,
  non_blocking_options JSONB NOT NULL DEFAULT '[]'::JSONB,
  department_id TEXT NOT NULL DEFAULT 'RELIEF_ASSISTANCE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Local / Demo Persona Credentials Table (supports short-username hackathon demo auth backed by Postgres)
CREATE TABLE IF NOT EXISTS public.awaaz_demo_credentials (
  identifier TEXT PRIMARY KEY,
  user_id UUID NOT NULL,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. Seed Universal RAG Collection registry metadata idempotently
INSERT INTO public.universal_rag_collections (collection_key, display_name, description)
VALUES
  ('relief_policies_kb', 'Relief Policies KB', 'Official synthetic relief eligibility criteria, thresholds, and appeal rules'),
  ('scam_fraud_kb', 'Scam & Cyber Safety KB', '8171 SMS scam patterns, OTP phishing rules, and fraud guidance'),
  ('nlu_corrections_kb', 'NLU Self-Learning Corrections KB', 'Learned Pakistani Urdu/Roman Urdu conversational extraction corrections'),
  ('faq_guidance_kb', 'Humanized Officer FAQ Guidance KB', 'Department Officer verified replies reused across citizen queries'),
  ('episodic_conversation_kb', 'Episodic Conversation Memory KB', 'Session-scoped working memory snapshots and citizen context')
ON CONFLICT (collection_key) DO NOTHING;
