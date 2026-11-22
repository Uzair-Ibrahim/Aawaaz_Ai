-- Migration 0012: Live Dynamic Rule Engine, Cost-Backed 3-Tier Matrix,
-- Granular Citizen Consent Revocation & Document Authenticity/Forgery Tracking

-- 1. Live Dynamic Eligibility & Cost Rule Versions (Immutable Snapshots)
create table if not exists public.eligibility_rule_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  version text not null,
  is_active boolean not null default false,
  max_monthly_income_pkr numeric not null default 25000,
  act_alone_max_amount_pkr numeric not null default 5000,
  ask_proof_max_amount_pkr numeric not null default 12000,
  min_confidence_act_alone numeric not null default 0.85,
  min_confidence_ask_proof numeric not null default 0.65,
  false_approval_cost_pkr numeric not null default 15000,
  false_delay_cost_pkr numeric not null default 600,
  wrongful_rejection_cost_pkr numeric not null default 4500,
  change_reason text not null default 'Initial baseline policy v1.0',
  updated_by text not null default 'System Seed',
  created_at timestamptz not null default now()
);

create index if not exists idx_eligibility_rule_versions_org_active
  on public.eligibility_rule_versions (organization_id, is_active, created_at desc);

-- 2. Immutable Rule Snapshots, Decision Tiers & Uncertainty Case Notes on Cases
alter table if exists public.cases
  add column if not exists rule_version_used text,
  add column if not exists rule_snapshot_json jsonb,
  add column if not exists decision_tier text,
  add column if not exists confidence_score numeric,
  add column if not exists case_notes jsonb,
  add column if not exists citizen_simple_reason text,
  add column if not exists duplicate_check_result jsonb,
  add column if not exists model_version text;

-- 3. Granular Citizen Consent Records (True Access Revocation)
create table if not exists public.citizen_consent_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  citizen_id uuid not null,
  user_id uuid not null,
  status text not null default 'GRANTED',
  scopes jsonb not null default '{"share_with_relief_officer": true, "allow_ai_voice_processing": true, "allow_document_verification": true}'::jsonb,
  who_has_access jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

-- 4. Document Authenticity & Forgery Analysis Logs (False-Alarm Honesty Tracking)
create table if not exists public.document_authenticity_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  citizen_id uuid,
  user_id uuid,
  doc_type text not null,
  file_name text not null,
  outcome text not null,
  forgery_score numeric not null,
  false_alarm_risk text not null,
  image_quality_score numeric not null,
  tamper_indicators jsonb not null default '[]'::jsonb,
  quality_issues jsonb not null default '[]'::jsonb,
  cross_field_mismatches jsonb not null default '[]'::jsonb,
  extracted_fields jsonb not null default '{}'::jsonb,
  citizen_message text not null,
  false_alarm_disclaimer text not null,
  non_blocking_options jsonb not null default '[]'::jsonb,
  department_id text not null default 'RELIEF_ASSISTANCE',
  created_at timestamptz not null default now()
);

-- 5. Dual-View Audit Trace Columns on Agent Reasoning Audit Logs
alter table if exists public.agent_reasoning_audit_logs
  add column if not exists rule_version_used text,
  add column if not exists rule_snapshot_json jsonb,
  add column if not exists model_version text,
  add column if not exists confidence_score numeric,
  add column if not exists decision_tier text,
  add column if not exists duplicate_check_result jsonb,
  add column if not exists consent_event_type text;
