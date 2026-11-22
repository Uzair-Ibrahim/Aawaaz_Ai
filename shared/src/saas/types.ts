import { z } from 'zod';

export const USER_ROLES = ['citizen', 'helper', 'officer', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];
export const userRoleSchema = z.enum(USER_ROLES);

export const PLAN_TIERS = ['free', 'standard', 'enterprise'] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

export const LANGUAGE_CODES = ['en', 'ur', 'pa', 'sd', 'bal', 'ps'] as const;
export type LanguageCode = (typeof LANGUAGE_CODES)[number];
export const languageCodeSchema = z.enum(LANGUAGE_CODES);

export interface Organization {
  id: string;
  name: string;
  slug: string;
  plan_tier: PlanTier;
  enabled_modules: string[];
  created_at: string;
  updated_at: string;
}

export interface Department {
  id: string;
  organization_id: string;
  name: string;
  code: string;
  created_at: string;
}

export interface OrganizationMembership {
  id: string;
  organization_id: string;
  user_id: string;
  role: UserRole;
  department_id: string | null;
  created_at: string;
}

export interface UserProfile {
  id: string;
  email: string;
  display_name: string;
  phone_number?: string | null;
  phone_verified_at?: string | null;
  role: UserRole;
  default_organization_id: string | null;
  department_id: string | null;
  preferred_language: LanguageCode;
  created_at: string;
  updated_at: string;
}

export interface AuthSessionUser {
  id: string;
  email: string;
  display_name: string;
  masked_phone?: string | null;
  phone_verified?: boolean;
  preferred_language: LanguageCode;
  active_organization: Organization;
  active_role: UserRole;
  department_id: string | null;
  memberships: Array<{
    organization_id: string;
    organization_name: string;
    organization_slug: string;
    role: UserRole;
    department_id: string | null;
  }>;
}

export interface ModuleManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  apiBasePath: string;
  frontendBasePath: string;
  allowedRoles: UserRole[];
  status: 'active' | 'planned';
}

export interface AuditLogEntry {
  id: string;
  organization_id: string;
  actor_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface NotificationItem {
  id: string;
  organization_id: string;
  user_id: string;
  case_id: string | null;
  notification_type: string;
  message: {
    title: string;
    body: string;
    language?: LanguageCode;
  };
  read_at: string | null;
  created_at: string;
}

export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
