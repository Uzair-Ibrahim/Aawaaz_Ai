-- ==============================================================================
-- Awaaz Migration 0003: Super Admin Oversight & Department Humanized Chatbot Assistance
-- Tenant-isolated tables with strict PostgreSQL RLS policies.
-- ==============================================================================

-- 1. Humanized Assistance Requests (Citizen chatbot questions escalated to Department Users)
CREATE TABLE IF NOT EXISTS public.assistance_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  department_id UUID NULL REFERENCES public.departments(id) ON DELETE SET NULL,
  citizen_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  case_id UUID NULL REFERENCES public.cases(id) ON DELETE SET NULL,
  language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'ur', 'pa', 'sd', 'bal', 'ps')),
  citizen_question TEXT NOT NULL,
  chatbot_draft_answer TEXT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'ANSWERED')),
  responder_user_id UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  humanized_reply TEXT NULL,
  saved_as_guidance BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  answered_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_assistance_requests_org_status
  ON public.assistance_requests(organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assistance_requests_citizen
  ON public.assistance_requests(organization_id, citizen_user_id);

-- 2. Department Humanized Chatbot Guidance (Approved plain-language Q&A overrides per service)
CREATE TABLE IF NOT EXISTS public.humanized_guidance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  department_id UUID NULL REFERENCES public.departments(id) ON DELETE SET NULL,
  service_id TEXT NOT NULL DEFAULT 'MOCK_RELIEF_01',
  language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'ur', 'pa', 'sd', 'bal', 'ps')),
  question_pattern TEXT NOT NULL,
  humanized_answer TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_humanized_guidance_org_service
  ON public.humanized_guidance(organization_id, service_id, language);

-- RLS Policies
ALTER TABLE public.assistance_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.humanized_guidance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "assistance_requests_select" ON public.assistance_requests
  FOR SELECT USING (
    public.is_org_member(organization_id)
    AND (
      citizen_user_id = auth.uid()
      OR public.has_org_role(organization_id, ARRAY['officer', 'admin', 'auditor'])
    )
  );

CREATE POLICY "assistance_requests_insert_citizen" ON public.assistance_requests
  FOR INSERT WITH CHECK (
    public.is_org_member(organization_id)
    AND citizen_user_id = auth.uid()
  );

CREATE POLICY "assistance_requests_update_staff" ON public.assistance_requests
  FOR UPDATE USING (
    public.has_org_role(organization_id, ARRAY['officer', 'admin'])
  );

CREATE POLICY "humanized_guidance_select_member" ON public.humanized_guidance
  FOR SELECT USING (public.is_org_member(organization_id));

CREATE POLICY "humanized_guidance_manage_staff" ON public.humanized_guidance
  FOR ALL USING (public.has_org_role(organization_id, ARRAY['officer', 'admin']));
