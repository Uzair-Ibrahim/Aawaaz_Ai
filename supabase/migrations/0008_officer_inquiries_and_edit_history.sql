-- Phase 3 & Phase 4: Field Fill History / Edit Tracking & Direct Department Officer Inquiries
ALTER TABLE IF EXISTS public.agent_memory_sessions
  ADD COLUMN IF NOT EXISTS field_fill_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS editing_field text;

CREATE TABLE IF NOT EXISTS public.officer_inquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_reference text NOT NULL UNIQUE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  citizen_id text NOT NULL,
  user_id uuid NOT NULL,
  citizen_name text NOT NULL,
  application_ref text,
  assigned_officer_id uuid,
  assigned_officer_name text NOT NULL DEFAULT 'Officer Hamza (Relief Officer)',
  question_text text NOT NULL,
  language text NOT NULL DEFAULT 'ur',
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'ANSWERED')),
  officer_reply text,
  created_at timestamptz NOT NULL DEFAULT now(),
  replied_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_officer_inquiries_org_created
  ON public.officer_inquiries (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_officer_inquiries_user_id
  ON public.officer_inquiries (user_id, created_at DESC);
