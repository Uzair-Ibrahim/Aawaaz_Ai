-- Migration 0007: Autonomous Agentic System — Persistent Working Memory, Reasoning Audit Trail, and Human Admin Escalations

CREATE TABLE IF NOT EXISTS public.agent_memory_sessions (
  session_id TEXT PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  citizen_id UUID NULL,
  user_id UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  workflow_stage TEXT NOT NULL DEFAULT 'LANGUAGE_SELECT',
  detected_language TEXT NOT NULL DEFAULT 'ur',
  language_locked BOOLEAN NOT NULL DEFAULT FALSE,
  active_task TEXT NOT NULL DEFAULT 'idle',
  suspended_tasks JSONB NOT NULL DEFAULT '[]'::jsonb,
  auth_draft JSONB NOT NULL DEFAULT '{}'::jsonb,
  form_draft JSONB NOT NULL DEFAULT '{}'::jsonb,
  pending_escalation JSONB NULL,
  looked_up_identifier TEXT NULL,
  conversation_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_memory_sessions_org_citizen
  ON public.agent_memory_sessions (organization_id, citizen_id);

CREATE TABLE IF NOT EXISTS public.agent_reasoning_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  session_id TEXT NOT NULL,
  citizen_id UUID NULL,
  user_id UUID NULL,
  workflow_stage TEXT NOT NULL,
  detected_language TEXT NOT NULL,
  user_input TEXT NOT NULL,
  intent_detected TEXT NOT NULL,
  mood_or_context_switch TEXT NOT NULL DEFAULT 'neutral',
  access_control_decision JSONB NOT NULL,
  capability_check TEXT NOT NULL DEFAULT 'IN_SCOPE',
  reasoning_steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  self_reflection_check JSONB NOT NULL,
  memory_snapshot_diff JSONB NOT NULL,
  mcp_tools_invoked JSONB NOT NULL DEFAULT '[]'::jsonb,
  validation_errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  final_agent_response TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_reasoning_audit_logs_org_ts
  ON public.agent_reasoning_audit_logs (organization_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS public.agent_escalations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_reference TEXT NOT NULL UNIQUE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  citizen_id TEXT NOT NULL,
  user_id UUID NOT NULL,
  citizen_display_name TEXT NOT NULL,
  citizen_cnic TEXT NOT NULL DEFAULT '',
  session_id TEXT NOT NULL,
  assigned_admin TEXT NOT NULL,
  reason_out_of_scope TEXT NOT NULL,
  conversation_summary TEXT NOT NULL,
  reasoning_audit_log_id UUID NULL REFERENCES public.agent_reasoning_audit_logs(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_REVIEW', 'RESOLVED')),
  resolution_notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_escalations_org_status
  ON public.agent_escalations (organization_id, status, created_at DESC);
