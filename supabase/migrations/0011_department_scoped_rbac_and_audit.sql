-- Migration 0011: Department-Scoped RBAC, Officer Decision Reasons & Department-Tagged AI Audit Trails

-- 1. Cases: explicit assigned_department + officer decision reason attribution
alter table if exists public.cases
  add column if not exists assigned_department text default 'RELIEF_ASSISTANCE',
  add column if not exists decided_by_officer_id uuid references auth.users(id),
  add column if not exists decided_by_officer_name text,
  add column if not exists decision_reason text,
  add column if not exists decided_at timestamptz;

create index if not exists idx_cases_org_assigned_department
  on public.cases (organization_id, assigned_department, created_at desc);

-- 2. Case Reviews: persist explicit decision_reason and officer_display_name
alter table if exists public.case_reviews
  add column if not exists decision_reason text,
  add column if not exists officer_display_name text;

-- 3. Agent Reasoning Audit Logs: strict department tagging & linked application reference
alter table if exists public.agent_reasoning_audit_logs
  add column if not exists department_id text not null default 'GENERAL_INQUIRY',
  add column if not exists related_application_id uuid;

create index if not exists idx_agent_reasoning_audit_org_dept_ts
  on public.agent_reasoning_audit_logs (organization_id, department_id, timestamp desc);

-- 4. Officer Inquiries: route inquiries strictly to their department queue
alter table if exists public.officer_inquiries
  add column if not exists department_id text default 'RELIEF_ASSISTANCE';

create index if not exists idx_officer_inquiries_org_dept
  on public.officer_inquiries (organization_id, department_id, created_at desc);
