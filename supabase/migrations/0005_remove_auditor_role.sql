-- ==============================================================================
-- Awaaz Migration 0005: Remove Separate Auditor Role (Audit Trail -> Super Admin Only)
-- 1. Preserves all existing audit_logs rows intact (append-only).
-- 2. Safely downgrades any legacy 'auditor' accounts to least-privilege 'citizen'
--    (never elevating them to admin or officer) and logs an audit entry.
-- 3. Restricts CHECK constraints and RLS policies to ('citizen', 'helper', 'officer', 'admin').
-- ==============================================================================

-- Record any legacy auditor memberships in audit_logs before downgrading them
INSERT INTO public.audit_logs (organization_id, actor_id, action, resource_type, resource_id, metadata)
SELECT
  m.organization_id,
  NULL,
  'role.downgraded_from_removed_auditor',
  'organization_membership',
  m.id,
  jsonb_build_object(
    'user_id', m.user_id,
    'previous_role', 'auditor',
    'reassigned_role', 'citizen',
    'reason', 'Separate auditor role removed; Super Admin owns Audit Trail access'
  )
FROM public.organization_memberships m
WHERE m.role = 'auditor';

-- Safely downgrade any legacy 'auditor' rows to lowest-privilege 'citizen' (no silent elevation)
UPDATE public.organization_memberships
SET role = 'citizen'
WHERE role = 'auditor';

UPDATE public.profiles
SET role = 'citizen', updated_at = NOW()
WHERE role = 'auditor';

-- Tighten CHECK constraints so 'auditor' can never be assigned again
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check CHECK (role IN ('citizen', 'helper', 'officer', 'admin'));

ALTER TABLE public.organization_memberships DROP CONSTRAINT IF EXISTS organization_memberships_role_check;
ALTER TABLE public.organization_memberships
  ADD CONSTRAINT organization_memberships_role_check CHECK (role IN ('citizen', 'helper', 'officer', 'admin'));

-- Update RLS policies across foundation & module tables to remove 'auditor' and keep Audit Trail Super Admin only
DROP POLICY IF EXISTS "profiles_select_self_or_org_staff" ON public.profiles;
CREATE POLICY "profiles_select_self_or_org_staff" ON public.profiles
  FOR SELECT USING (
    id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.organization_memberships m1
      JOIN public.organization_memberships m2 ON m1.organization_id = m2.organization_id
      WHERE m1.user_id = auth.uid()
        AND m1.role IN ('admin', 'officer')
        AND m2.user_id = public.profiles.id
    )
  );

DROP POLICY IF EXISTS "memberships_select_self_or_admin" ON public.organization_memberships;
CREATE POLICY "memberships_select_self_or_admin" ON public.organization_memberships
  FOR SELECT USING (
    user_id = auth.uid()
    OR public.has_org_role(organization_id, ARRAY['admin'])
  );

DROP POLICY IF EXISTS "audit_logs_select_auditor_admin" ON public.audit_logs;
CREATE POLICY "audit_logs_select_admin" ON public.audit_logs
  FOR SELECT USING (public.has_org_role(organization_id, ARRAY['admin']));

DROP POLICY IF EXISTS "departments_select_staff" ON public.departments;
CREATE POLICY "departments_select_staff" ON public.departments
  FOR SELECT USING (public.has_org_role(organization_id, ARRAY['admin', 'officer']));

CREATE OR REPLACE FUNCTION public.can_access_case(target_case_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.cases c
    JOIN public.citizens cit ON cit.id = c.citizen_id
    WHERE c.id = target_case_id
      AND public.is_org_member(c.organization_id)
      AND (
        cit.user_id = auth.uid()
        OR public.has_org_role(c.organization_id, ARRAY['officer'])
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

DROP POLICY IF EXISTS "citizens_select" ON public.citizens;
CREATE POLICY "citizens_select" ON public.citizens
  FOR SELECT USING (
    public.is_org_member(organization_id)
    AND (
      user_id = auth.uid()
      OR public.has_org_role(organization_id, ARRAY['officer'])
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

DROP POLICY IF EXISTS "consents_select" ON public.consents;
CREATE POLICY "consents_select" ON public.consents
  FOR SELECT USING (
    public.is_org_member(organization_id)
    AND (
      helper_id = auth.uid()
      OR public.has_org_role(organization_id, ARRAY['officer', 'admin'])
      OR EXISTS (
        SELECT 1 FROM public.citizens cit
        WHERE cit.id = public.consents.citizen_id AND cit.user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "ai_runs_select_staff" ON public.ai_runs;
CREATE POLICY "ai_runs_select_staff" ON public.ai_runs
  FOR SELECT USING (public.has_org_role(organization_id, ARRAY['officer', 'admin']));

DROP POLICY IF EXISTS "case_reviews_select_staff" ON public.case_reviews;
CREATE POLICY "case_reviews_select_staff" ON public.case_reviews
  FOR SELECT USING (public.has_org_role(organization_id, ARRAY['officer']));

DROP POLICY IF EXISTS "mock_identity_select_staff" ON public.mock_identity_records;
CREATE POLICY "mock_identity_select_staff" ON public.mock_identity_records
  FOR SELECT USING (public.has_org_role(organization_id, ARRAY['officer', 'admin']));

DROP POLICY IF EXISTS "assistance_requests_select" ON public.assistance_requests;
CREATE POLICY "assistance_requests_select" ON public.assistance_requests
  FOR SELECT USING (
    public.is_org_member(organization_id)
    AND (
      citizen_user_id = auth.uid()
      OR public.has_org_role(organization_id, ARRAY['officer', 'admin'])
    )
  );
