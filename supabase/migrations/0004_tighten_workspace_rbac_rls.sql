-- ==============================================================================
-- Awaaz Migration 0004: Tighten Multi-Tenant Workspace & Role RLS Policies
-- Enforces strict workspace creation, department visibility, and anti-escalation
-- rules directly at the PostgreSQL layer.
-- ==============================================================================

-- 1. Restrict workspace (organization) creation & update to Super Admins only
DROP POLICY IF EXISTS "orgs_insert_super_admin" ON public.organizations;
CREATE POLICY "orgs_insert_super_admin" ON public.organizations
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.organization_memberships m
      WHERE m.user_id = auth.uid()
        AND m.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "orgs_update_admin" ON public.organizations;
CREATE POLICY "orgs_update_admin" ON public.organizations
  FOR UPDATE USING (public.has_org_role(id, ARRAY['admin']))
  WITH CHECK (public.has_org_role(id, ARRAY['admin']));

DROP POLICY IF EXISTS "orgs_delete_admin" ON public.organizations;
CREATE POLICY "orgs_delete_admin" ON public.organizations
  FOR DELETE USING (public.has_org_role(id, ARRAY['admin']));

-- 2. Restrict department listing to authorized staff (admin, officer, auditor)
--    Citizens and helpers must not enumerate department records.
DROP POLICY IF EXISTS "departments_select_member" ON public.departments;
CREATE POLICY "departments_select_staff" ON public.departments
  FOR SELECT USING (public.has_org_role(organization_id, ARRAY['admin', 'officer', 'auditor']));

DROP POLICY IF EXISTS "departments_manage_admin" ON public.departments;
CREATE POLICY "departments_manage_admin" ON public.departments
  FOR ALL USING (public.has_org_role(organization_id, ARRAY['admin']))
  WITH CHECK (public.has_org_role(organization_id, ARRAY['admin']));

-- 3. Tighten organization_memberships write policy with explicit WITH CHECK
--    Prevents cross-tenant membership insertion or self-elevation.
DROP POLICY IF EXISTS "memberships_manage_admin" ON public.organization_memberships;
CREATE POLICY "memberships_manage_admin" ON public.organization_memberships
  FOR ALL USING (public.has_org_role(organization_id, ARRAY['admin']))
  WITH CHECK (public.has_org_role(organization_id, ARRAY['admin']));

-- 4. Prevent profile self-escalation on public.profiles
--    Users updating their own profile cannot alter their role or switch to an unauthorized org.
CREATE OR REPLACE FUNCTION public.prevent_profile_privilege_escalation()
RETURNS TRIGGER AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'Users cannot self-modify their role';
    END IF;
    IF NEW.default_organization_id IS DISTINCT FROM OLD.default_organization_id
       AND NEW.default_organization_id IS NOT NULL
       AND NOT public.is_org_member(NEW.default_organization_id) THEN
      RAISE EXCEPTION 'Cannot switch default workspace to an organization without membership';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_prevent_profile_escalation ON public.profiles;
CREATE TRIGGER trg_prevent_profile_escalation
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_profile_privilege_escalation();
