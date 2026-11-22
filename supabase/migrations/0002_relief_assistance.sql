-- ==============================================================================
-- Awaaz Idea 1: Mock Relief-Assistance Module — Migration 0002
-- Tenant-isolated tables, pgvector policy chunks, and strict RLS policies.
-- SYNTHETIC DATA ONLY — NOT AN OFFICIAL GOVERNMENT SERVICE.
-- ==============================================================================

-- 1. Citizens (tenant-scoped, synthetic identity references only)
CREATE TABLE IF NOT EXISTS public.citizens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  display_name TEXT NOT NULL,
  mock_identity_reference TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, mock_identity_reference)
);

CREATE INDEX IF NOT EXISTS idx_citizens_org_user ON public.citizens(organization_id, user_id);

-- 2. Eligibility Rules & Immutable Rule Versions (tenant-scoped)
CREATE TABLE IF NOT EXISTS public.eligibility_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  scheme_id TEXT NOT NULL,
  active_version_id UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, scheme_id)
);

CREATE TABLE IF NOT EXISTS public.rule_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  rule_id UUID NOT NULL REFERENCES public.eligibility_rules(id) ON DELETE CASCADE,
  scheme_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  rules_json JSONB NOT NULL,
  published_by UUID NOT NULL REFERENCES public.profiles(id),
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, scheme_id, version_number)
);

ALTER TABLE public.eligibility_rules
  DROP CONSTRAINT IF EXISTS fk_eligibility_rules_active_version;
ALTER TABLE public.eligibility_rules
  ADD CONSTRAINT fk_eligibility_rules_active_version
  FOREIGN KEY (active_version_id) REFERENCES public.rule_versions(id) ON DELETE SET NULL;

-- 3. Cases (tenant-scoped, explicit state machine + idempotency key)
CREATE TABLE IF NOT EXISTS public.cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  citizen_id UUID NOT NULL REFERENCES public.citizens(id) ON DELETE CASCADE,
  department_id UUID NULL REFERENCES public.departments(id) ON DELETE SET NULL,
  scheme_id TEXT NOT NULL DEFAULT 'MOCK_RELIEF_01',
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
    'DRAFT',
    'COLLECTING_INFORMATION',
    'DOCUMENT_PENDING',
    'AI_ANALYSIS',
    'NEEDS_MORE_INFO',
    'NEEDS_HUMAN_REVIEW',
    'READY_FOR_OFFICER',
    'OFFICER_REVIEW',
    'APPROVED',
    'REJECTED',
    'MOCK_PAYMENT_QUEUED',
    'MOCK_PAYMENT_COMPLETED'
  )),
  preferred_language TEXT NOT NULL DEFAULT 'en' CHECK (preferred_language IN ('en', 'ur', 'pa', 'sd', 'bal', 'ps')),
  current_step TEXT NOT NULL DEFAULT 'consent',
  rule_version_id UUID NULL REFERENCES public.rule_versions(id) ON DELETE SET NULL,
  assigned_officer_id UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  idempotency_key TEXT NOT NULL,
  analysis_result JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at TIMESTAMPTZ NULL,
  UNIQUE (organization_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_cases_org_status ON public.cases(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_cases_citizen ON public.cases(citizen_id);
CREATE INDEX IF NOT EXISTS idx_cases_officer ON public.cases(assigned_officer_id);

-- 4. Case Answers
CREATE TABLE IF NOT EXISTS public.case_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  case_id UUID NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  field_value JSONB NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('voice', 'text', 'document', 'officer', 'system')),
  confirmed_by_citizen BOOLEAN NOT NULL DEFAULT FALSE,
  extraction_confidence NUMERIC NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (case_id, field_name)
);

CREATE INDEX IF NOT EXISTS idx_case_answers_case ON public.case_answers(case_id);

-- 5. Documents (private storage paths prefixed by org/<org_id>/cases/<case_id>/...)
CREATE TABLE IF NOT EXISTS public.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  case_id UUID NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL CHECK (document_type IN (
    'mock_identity_document',
    'mock_proof_of_income',
    'mock_residence_document',
    'mock_application_form'
  )),
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  storage_path TEXT NOT NULL,
  processing_status TEXT NOT NULL DEFAULT 'UPLOADED' CHECK (processing_status IN ('UPLOADED', 'PROCESSING', 'EXTRACTED', 'NEEDS_REVIEW', 'FAILED')),
  extraction_result JSONB NULL,
  conflicts JSONB NOT NULL DEFAULT '[]'::JSONB,
  review_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (review_status IN ('PENDING', 'VERIFIED', 'FLAGGED', 'REJECTED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_documents_case ON public.documents(case_id);

-- 6. Policies & Policy Chunks (pgvector VECTOR(768) for Gemini text-embedding-004 outputDimensionality=768)
CREATE TABLE IF NOT EXISTS public.policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  document_type TEXT NOT NULL,
  version TEXT NOT NULL,
  effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
  language TEXT NOT NULL DEFAULT 'en',
  source_reference TEXT NOT NULL,
  storage_path TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.policy_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  policy_id UUID NOT NULL REFERENCES public.policies(id) ON DELETE CASCADE,
  chunk_text TEXT NOT NULL,
  embedding VECTOR(768) NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_policy_chunks_org ON public.policy_chunks(organization_id, policy_id);

-- Vector similarity helper RPC for pgvector retrieval (tenant-filtered)
CREATE OR REPLACE FUNCTION public.match_policy_chunks(
  p_organization_id UUID,
  p_query_embedding VECTOR(768),
  p_match_count INTEGER DEFAULT 5,
  p_language TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  policy_id UUID,
  chunk_text TEXT,
  metadata JSONB,
  similarity FLOAT
) AS $$
  SELECT
    pc.id,
    pc.policy_id,
    pc.chunk_text,
    pc.metadata,
    1 - (pc.embedding <=> p_query_embedding) AS similarity
  FROM public.policy_chunks pc
  JOIN public.policies p ON p.id = pc.policy_id
  WHERE pc.organization_id = p_organization_id
    AND pc.embedding IS NOT NULL
    AND (p_language IS NULL OR p.language = p_language)
  ORDER BY pc.embedding <=> p_query_embedding
  LIMIT p_match_count;
$$ LANGUAGE sql STABLE;

-- 7. Consents (processing consent & helper delegation; server-enforced withdrawal)
CREATE TABLE IF NOT EXISTS public.consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  citizen_id UUID NOT NULL REFERENCES public.citizens(id) ON DELETE CASCADE,
  helper_id UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  case_id UUID NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  consent_type TEXT NOT NULL DEFAULT 'processing' CHECK (consent_type IN ('processing', 'helper_delegation')),
  permissions JSONB NOT NULL DEFAULT '[]'::JSONB,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NULL,
  withdrawn_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_consents_org_citizen ON public.consents(organization_id, citizen_id);
CREATE INDEX IF NOT EXISTS idx_consents_helper ON public.consents(helper_id, withdrawn_at);

-- 8. AI Runs (decision traces — never store raw voice recordings)
CREATE TABLE IF NOT EXISTS public.ai_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  case_id UUID NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  model_provider TEXT NOT NULL,
  model_name TEXT NOT NULL,
  operation TEXT NOT NULL,
  input_reference TEXT NOT NULL,
  output JSONB NOT NULL,
  confidence NUMERIC NULL,
  explanation TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_runs_org_case ON public.ai_runs(organization_id, case_id, created_at DESC);

-- 9. Case Reviews (officer decisions & internal notes — hidden from citizens)
CREATE TABLE IF NOT EXISTS public.case_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  case_id UUID NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  officer_id UUID NOT NULL REFERENCES public.profiles(id),
  decision TEXT NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED', 'REQUEST_INFO', 'NOTE')),
  internal_notes TEXT NOT NULL DEFAULT '',
  citizen_message TEXT NOT NULL DEFAULT '',
  rule_version_id UUID NULL REFERENCES public.rule_versions(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_case_reviews_case ON public.case_reviews(case_id, created_at DESC);

-- 10. Mock Identity Records (explicitly synthetic)
CREATE TABLE IF NOT EXISTS public.mock_identity_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  mock_identity_reference TEXT NOT NULL,
  full_name TEXT NOT NULL,
  district TEXT NOT NULL,
  verified BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, mock_identity_reference)
);

-- 11. Mock Payment Records (explicitly synthetic — requires prior officer approval)
CREATE TABLE IF NOT EXISTS public.mock_payment_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  case_id UUID NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  initiated_by UUID NOT NULL REFERENCES public.profiles(id),
  amount_pkr NUMERIC NOT NULL CHECK (amount_pkr > 0),
  status TEXT NOT NULL DEFAULT 'MOCK_PAYMENT_QUEUED' CHECK (status IN ('MOCK_PAYMENT_QUEUED', 'MOCK_PAYMENT_COMPLETED', 'MOCK_PAYMENT_FAILED')),
  reference_code TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ NULL
);

-- ==============================================================================
-- Helper RLS Check for Citizen / Consented Helper / Officer Case Access
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.can_access_case(target_case_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.cases c
    JOIN public.citizens cit ON cit.id = c.citizen_id
    WHERE c.id = target_case_id
      AND public.is_org_member(c.organization_id)
      AND (
        -- Citizen owns the case
        cit.user_id = auth.uid()
        -- Officer or auditor in same org
        OR public.has_org_role(c.organization_id, ARRAY['officer', 'auditor'])
        -- Helper with active, non-withdrawn, non-expired consent
        OR EXISTS (
          SELECT 1
          FROM public.consents con
          WHERE con.organization_id = c.organization_id
            AND con.citizen_id = c.citizen_id
            AND con.helper_id = auth.uid()
            AND con.withdrawn_at IS NULL
            AND (con.expires_at IS NULL OR con.expires_at > NOW())
            AND (con.case_id IS NULL OR con.case_id = c.id)
        )
      )
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ==============================================================================
-- Row Level Security Policies (Idea 1 Tables)
-- ==============================================================================

ALTER TABLE public.citizens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eligibility_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rule_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policy_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mock_identity_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mock_payment_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "citizens_select" ON public.citizens
  FOR SELECT USING (
    public.is_org_member(organization_id)
    AND (
      user_id = auth.uid()
      OR public.has_org_role(organization_id, ARRAY['officer', 'auditor'])
      OR EXISTS (
        SELECT 1 FROM public.consents con
        WHERE con.organization_id = public.citizens.organization_id
          AND con.citizen_id = public.citizens.id
          AND con.helper_id = auth.uid()
          AND con.withdrawn_at IS NULL
          AND (con.expires_at IS NULL OR con.expires_at > NOW())
      )
    )
  );

CREATE POLICY "cases_select" ON public.cases
  FOR SELECT USING (public.can_access_case(id));

CREATE POLICY "case_answers_select" ON public.case_answers
  FOR SELECT USING (public.can_access_case(case_id));

CREATE POLICY "documents_select" ON public.documents
  FOR SELECT USING (public.can_access_case(case_id));

CREATE POLICY "rules_select_member" ON public.eligibility_rules
  FOR SELECT USING (public.is_org_member(organization_id));

CREATE POLICY "rules_manage_admin" ON public.eligibility_rules
  FOR ALL USING (public.has_org_role(organization_id, ARRAY['admin']));

CREATE POLICY "rule_versions_select_member" ON public.rule_versions
  FOR SELECT USING (public.is_org_member(organization_id));

CREATE POLICY "rule_versions_insert_admin" ON public.rule_versions
  FOR INSERT WITH CHECK (public.has_org_role(organization_id, ARRAY['admin']));

CREATE POLICY "policies_select_member" ON public.policies
  FOR SELECT USING (public.is_org_member(organization_id));

CREATE POLICY "policies_manage_admin" ON public.policies
  FOR ALL USING (public.has_org_role(organization_id, ARRAY['admin']));

CREATE POLICY "policy_chunks_select_member" ON public.policy_chunks
  FOR SELECT USING (public.is_org_member(organization_id));

CREATE POLICY "consents_select" ON public.consents
  FOR SELECT USING (
    public.is_org_member(organization_id)
    AND (
      helper_id = auth.uid()
      OR public.has_org_role(organization_id, ARRAY['officer', 'auditor'])
      OR EXISTS (
        SELECT 1 FROM public.citizens cit
        WHERE cit.id = public.consents.citizen_id AND cit.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "ai_runs_select_staff" ON public.ai_runs
  FOR SELECT USING (public.has_org_role(organization_id, ARRAY['officer', 'auditor', 'admin']));

-- Case reviews contain internal officer notes: strictly hidden from citizens & helpers
CREATE POLICY "case_reviews_select_staff" ON public.case_reviews
  FOR SELECT USING (public.has_org_role(organization_id, ARRAY['officer', 'auditor']));

CREATE POLICY "case_reviews_insert_officer" ON public.case_reviews
  FOR INSERT WITH CHECK (public.has_org_role(organization_id, ARRAY['officer']));

CREATE POLICY "mock_identity_select_staff" ON public.mock_identity_records
  FOR SELECT USING (public.has_org_role(organization_id, ARRAY['officer', 'admin', 'auditor']));

CREATE POLICY "mock_payments_select_authorized" ON public.mock_payment_records
  FOR SELECT USING (public.can_access_case(case_id));
