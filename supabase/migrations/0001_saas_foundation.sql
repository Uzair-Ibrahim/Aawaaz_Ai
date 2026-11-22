-- ==============================================================================
-- Awaaz Multi-User SaaS Foundation — Migration 0001
-- Shared multi-tenant infrastructure reused across Idea 1 and future modules.
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- 1. Organizations (Tenants / Workspaces, billing-ready metadata)
CREATE TABLE IF NOT EXISTS public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  plan_tier TEXT NOT NULL DEFAULT 'free' CHECK (plan_tier IN ('free', 'standard', 'enterprise')),
  enabled_modules TEXT[] NOT NULL DEFAULT ARRAY['relief-assistance'],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Departments (scoped to an Organization)
CREATE TABLE IF NOT EXISTS public.departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, code)
);

-- 3. User Profiles (linked 1:1 to Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'citizen' CHECK (role IN ('citizen', 'helper', 'officer', 'admin', 'auditor')),
  default_organization_id UUID NULL REFERENCES public.organizations(id) ON DELETE SET NULL,
  department_id UUID NULL REFERENCES public.departments(id) ON DELETE SET NULL,
  preferred_language TEXT NOT NULL DEFAULT 'en' CHECK (preferred_language IN ('en', 'ur', 'pa', 'sd', 'bal', 'ps')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Organization Memberships (multi-user SaaS tenant & role mapping)
CREATE TABLE IF NOT EXISTS public.organization_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('citizen', 'helper', 'officer', 'admin', 'auditor')),
  department_id UUID NULL REFERENCES public.departments(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_memberships_user ON public.organization_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_org_memberships_org ON public.organization_memberships(organization_id);

-- 5. Hashed API Keys (tenant-scoped, never store raw keys)
CREATE TABLE IF NOT EXISTS public.api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  scopes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  last_used_at TIMESTAMPTZ NULL,
  revoked_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Append-Only Audit Logs (tenant-scoped)
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_id UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id UUID NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_org_created ON public.audit_logs(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON public.audit_logs(resource_type, resource_id);

-- Enforce append-only on audit_logs at the database layer
CREATE OR REPLACE FUNCTION public.prevent_audit_log_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only; UPDATE and DELETE are forbidden';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_logs_no_update ON public.audit_logs;
CREATE TRIGGER trg_audit_logs_no_update
  BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_log_mutation();

-- 7. Notifications (tenant-scoped)
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  case_id UUID NULL,
  notification_type TEXT NOT NULL,
  message JSONB NOT NULL,
  read_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_org ON public.notifications(organization_id, user_id, created_at DESC);

-- ==============================================================================
-- Helper functions for Row Level Security (RLS)
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.is_org_member(target_org_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_memberships m
    WHERE m.organization_id = target_org_id
      AND m.user_id = auth.uid()
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION public.has_org_role(target_org_id UUID, allowed_roles TEXT[])
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_memberships m
    WHERE m.organization_id = target_org_id
      AND m.user_id = auth.uid()
      AND m.role = ANY(allowed_roles)
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ==============================================================================
-- Row Level Security Policies (Foundation Tables)
-- ==============================================================================

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Organizations: visible only to members
CREATE POLICY "orgs_select_member" ON public.organizations
  FOR SELECT USING (public.is_org_member(id));

-- Departments: visible to org members, manageable by org admins
CREATE POLICY "departments_select_member" ON public.departments
  FOR SELECT USING (public.is_org_member(organization_id));

CREATE POLICY "departments_manage_admin" ON public.departments
  FOR ALL USING (public.has_org_role(organization_id, ARRAY['admin']));

-- Profiles: users read/update own profile; org admins/officers can read profiles in their org
CREATE POLICY "profiles_select_self_or_org_staff" ON public.profiles
  FOR SELECT USING (
    id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.organization_memberships m1
      JOIN public.organization_memberships m2 ON m1.organization_id = m2.organization_id
      WHERE m1.user_id = auth.uid()
        AND m1.role IN ('admin', 'officer', 'auditor')
        AND m2.user_id = public.profiles.id
    )
  );

CREATE POLICY "profiles_update_self" ON public.profiles
  FOR UPDATE USING (id = auth.uid());

-- Memberships: users see their own memberships; org admins manage org memberships
CREATE POLICY "memberships_select_self_or_admin" ON public.organization_memberships
  FOR SELECT USING (
    user_id = auth.uid()
    OR public.has_org_role(organization_id, ARRAY['admin', 'auditor'])
  );

CREATE POLICY "memberships_manage_admin" ON public.organization_memberships
  FOR ALL USING (public.has_org_role(organization_id, ARRAY['admin']));

-- API Keys: org admins only
CREATE POLICY "api_keys_admin_only" ON public.api_keys
  FOR ALL USING (public.has_org_role(organization_id, ARRAY['admin']));

-- Audit Logs: append-only insert by authenticated org members; read only by org auditors & admins
CREATE POLICY "audit_logs_insert_member" ON public.audit_logs
  FOR INSERT WITH CHECK (public.is_org_member(organization_id));

CREATE POLICY "audit_logs_select_auditor_admin" ON public.audit_logs
  FOR SELECT USING (public.has_org_role(organization_id, ARRAY['auditor', 'admin']));

-- Notifications: users read/update only their own notifications in their org
CREATE POLICY "notifications_select_own" ON public.notifications
  FOR SELECT USING (user_id = auth.uid() AND public.is_org_member(organization_id));

CREATE POLICY "notifications_update_own" ON public.notifications
  FOR UPDATE USING (user_id = auth.uid() AND public.is_org_member(organization_id));
