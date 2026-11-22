import { Router, type NextFunction, type Request, type Response } from 'express';
import { languageCodeSchema, userRoleSchema } from '@awaaz/shared';
import { z } from 'zod';
import { getIntegrationStatus, type AppEnv } from '../../config/env';
import type { AuditService } from '../audit/audit-service';
import type { AuthService } from '../auth/auth-service';
import { SESSION_COOKIE_NAME } from '../auth/middleware';
import type { SupabaseServerRuntime } from '../database/supabase-server-client';
import type { DataStore } from '../database/types';
import type { ModuleRegistry } from '../modules/registry';
import type { NotificationService } from '../notifications/notification-service';
import { requireRoles } from '../rbac/permissions';
import { AppError } from '../security/errors';

const loginSchema = z.object({
  email: z.string().trim().min(3).max(120),
  password: z.string().min(4),
});

const registerSchema = z
  .object({
    email: z.string().email(),
    password: z.string().min(8).max(128),
    display_name: z.string().min(2).max(100),
    preferred_language: languageCodeSchema.optional(),
  })
  .strict();

const requestPhoneOtpSchema = z
  .object({
    phone_number: z.string().min(7).max(24),
    preferred_language: languageCodeSchema.optional(),
  })
  .strict();

const verifyPhoneOtpSchema = z
  .object({
    challenge_id: z.string().uuid(),
    phone_number: z.string().min(7).max(24),
    otp_code: z.string().min(6).max(12),
    display_name: z.string().min(2).max(100).optional(),
    preferred_language: languageCodeSchema.optional(),
  })
  .strict();

const createWorkspaceSchema = z.object({
  name: z.string().min(3).max(100),
  slug: z
    .string()
    .min(3)
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Slug may only contain lowercase letters, digits, and hyphens.'),
});

const updateWorkspaceSchema = z
  .object({
    name: z.string().min(3).max(100).optional(),
    slug: z
      .string()
      .min(3)
      .max(50)
      .regex(/^[a-z0-9-]+$/, 'Slug may only contain lowercase letters, digits, and hyphens.')
      .optional(),
  })
  .refine((v) => v.name !== undefined || v.slug !== undefined, {
    message: 'Provide a name or slug to update.',
  });

const inviteMemberSchema = z.object({
  email: z.string().email(),
  role: userRoleSchema,
  department_id: z.string().uuid().nullable().optional(),
});

const createDepartmentSchema = z.object({
  name: z.string().min(2).max(80),
  code: z.string().min(2).max(32),
});

export function createSaasRouter(deps: {
  env: AppEnv;
  store: DataStore;
  authService: AuthService;
  requireAuth: (req: Request, res: Response, next: NextFunction) => void;
  audit: AuditService;
  notifications: NotificationService;
  moduleRegistry: ModuleRegistry;
  supabaseRuntime?: SupabaseServerRuntime;
}): Router {
  const router = Router();
  const { env, store, authService, requireAuth, audit, notifications, moduleRegistry, supabaseRuntime } = deps;

  const setSessionCookie = (res: Response, token: string): void => {
    res.cookie(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: env.NODE_ENV === 'production',
      maxAge: 12 * 60 * 60 * 1000,
    });
  };

  // --- Public Health & Platform Status ---
  router.get('/health', (_req, res) => {
    const sbHealth = supabaseRuntime?.getHealthSnapshot();
    res.json({
      status: 'ok',
      service: 'awaaz-backend',
      storage: sbHealth?.storage ?? (env.DATA_STORE_MODE === 'supabase' ? 'supabase' : 'memory'),
      database: sbHealth?.database ?? (env.DATA_STORE_MODE === 'supabase' ? 'connected' : 'fallback_memory'),
      supabase: sbHealth ?? null,
      prototype_notice: 'Synthetic data only. Not an official government service.',
      integrations: getIntegrationStatus(env),
      modules: moduleRegistry.listManifests(),
    });
  });

  // --- Auth (§18) ---
  router.post('/auth/login', async (req, res, next) => {
    try {
      const body = loginSchema.parse(req.body);
      const { accessToken, user } = await authService.login(body.email, body.password);
      setSessionCookie(res, accessToken);
      await audit.log({
        organizationId: user.active_organization.id,
        actorId: user.id,
        action: 'auth.login',
        resourceType: 'session',
        metadata: { auth_mode: env.AUTH_MODE },
      });
      res.json({ access_token: accessToken, user });
    } catch (err) {
      next(err);
    }
  });

  router.post('/auth/register', async (req, res, next) => {
    try {
      const body = registerSchema.parse(req.body);
      const { accessToken, user } = await authService.register(body);
      if (accessToken) setSessionCookie(res, accessToken);
      res.status(201).json({ access_token: accessToken, user });
    } catch (err) {
      next(err);
    }
  });

  // Phone-ownership OTP onboarding & duplicate-safe citizen sign-in/linking
  router.post('/auth/phone/request-otp', async (req, res, next) => {
    try {
      const body = requestPhoneOtpSchema.parse(req.body);
      const result = await authService.requestPhoneOtp(body);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  router.post('/auth/phone/verify-otp', async (req, res, next) => {
    try {
      const body = verifyPhoneOtpSchema.parse(req.body);
      // Optionally detect an already-signed-in citizen if they are linking a phone number
      let existingUserId: string | null = null;
      const authHeader = req.headers.authorization;
      const rawToken =
        authHeader && authHeader.startsWith('Bearer ')
          ? authHeader.slice(7).trim()
          : ((req.cookies?.[SESSION_COOKIE_NAME] as string | undefined) ?? '');
      if (rawToken) {
        try {
          const verified = await authService.verifyAccessToken(rawToken);
          existingUserId = verified.userId;
        } catch {
          // Ignore expired/invalid cookie during fresh OTP login
        }
      }

      const { accessToken, user, account_status } = await authService.verifyPhoneOtpAndAuthenticate({
        ...body,
        existingUserId,
      });
      if (accessToken) setSessionCookie(res, accessToken);
      res.status(account_status === 'created' ? 201 : 200).json({
        access_token: accessToken,
        user,
        account_status,
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/auth/logout', (_req, res) => {
    res.clearCookie(SESSION_COOKIE_NAME);
    res.json({ logged_out: true });
  });

  router.get('/auth/me', requireAuth, async (req, res, next) => {
    try {
      const auth = req.auth!;
      const user = await authService.buildSessionUser(auth.userId, auth.organizationId);
      res.json({
        user,
        integrations: getIntegrationStatus(env),
        modules: moduleRegistry.listManifests(),
      });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/auth/me', requireAuth, async (req, res, next) => {
    try {
      const auth = req.auth!;
      const body = z
        .object({
          display_name: z.string().min(2).max(100).optional(),
          preferred_language: languageCodeSchema.optional(),
          default_organization_id: z.string().uuid().optional(),
        })
        .strict()
        .parse(req.body);

      if (body.default_organization_id) {
        if (auth.role === 'citizen') {
          throw new AppError(
            403,
            'WORKSPACE_SWITCH_FORBIDDEN',
            'Normal users cannot switch tenant workspaces.',
          );
        }
        const mem = await store.getMembership(body.default_organization_id, auth.userId);
        if (!mem) {
          throw new AppError(403, 'TENANT_ACCESS_DENIED', 'Cannot switch to a workspace you do not belong to.');
        }
      }

      await store.updateProfile(auth.userId, body);
      const user = await authService.buildSessionUser(
        auth.userId,
        body.default_organization_id ?? auth.organizationId,
      );
      res.json({ user });
    } catch (err) {
      next(err);
    }
  });

  // --- Multi-User SaaS Workspaces / Organizations ---
  // Normal users (citizens) do not access workspace management endpoints.
  router.get('/workspaces', requireAuth, requireRoles('admin', 'officer', 'helper'), async (req, res, next) => {
    try {
      const orgs = await store.listOrganizationsForUser(req.auth!.userId);
      res.json({ workspaces: orgs });
    } catch (err) {
      next(err);
    }
  });

  // Strictly Super Admin only: creating a workspace never grants access to other existing workspaces.
  router.post('/workspaces', requireAuth, requireRoles('admin'), async (req, res, next) => {
    try {
      const auth = req.auth!;
      const body = createWorkspaceSchema.parse(req.body);
      const org = await store.createOrganization(body);
      await store.upsertMembership({
        organization_id: org.id,
        user_id: auth.userId,
        role: 'admin',
      });
      await audit.log({
        organizationId: org.id,
        actorId: auth.userId,
        action: 'workspace.created',
        resourceType: 'organization',
        resourceId: org.id,
        metadata: { slug: org.slug },
      });
      res.status(201).json({ workspace: org });
    } catch (err) {
      next(err);
    }
  });

  // Super Admin: edit a workspace they administer
  router.patch('/workspaces/:id', requireAuth, requireRoles('admin'), async (req, res, next) => {
    try {
      const auth = req.auth!;
      const targetOrgId = String(req.params.id);
      const membership = await store.getMembership(targetOrgId, auth.userId);
      if (!membership || membership.role !== 'admin') {
        throw new AppError(403, 'TENANT_ACCESS_DENIED', 'Only a Super Admin of this workspace may edit it.');
      }
      const body = updateWorkspaceSchema.parse(req.body);
      const updated = await store.updateOrganization(targetOrgId, body);
      await audit.log({
        organizationId: targetOrgId,
        actorId: auth.userId,
        action: 'workspace.updated',
        resourceType: 'organization',
        resourceId: targetOrgId,
        metadata: { name: updated.name, slug: updated.slug },
      });
      res.json({ workspace: updated });
    } catch (err) {
      next(err);
    }
  });

  // Super Admin: delete a workspace they administer (cannot delete their last remaining admin workspace)
  router.delete('/workspaces/:id', requireAuth, requireRoles('admin'), async (req, res, next) => {
    try {
      const auth = req.auth!;
      const targetOrgId = String(req.params.id);
      const membership = await store.getMembership(targetOrgId, auth.userId);
      if (!membership || membership.role !== 'admin') {
        throw new AppError(403, 'TENANT_ACCESS_DENIED', 'Only a Super Admin of this workspace may delete it.');
      }
      const userOrgs = await store.listOrganizationsForUser(auth.userId);
      const remainingAdminOrgs = userOrgs.filter((o) => o.id !== targetOrgId && o.role === 'admin');
      if (remainingAdminOrgs.length === 0) {
        throw new AppError(
          409,
          'CANNOT_DELETE_LAST_WORKSPACE',
          'You cannot delete your only remaining Super Admin workspace.',
        );
      }
      await store.deleteOrganization(targetOrgId);
      const fallbackOrg = remainingAdminOrgs[0]!;
      await audit.log({
        organizationId: fallbackOrg.id,
        actorId: auth.userId,
        action: 'workspace.deleted',
        resourceType: 'organization',
        resourceId: targetOrgId,
        metadata: { deleted_organization_id: targetOrgId },
      });
      res.json({ deleted: true, fallback_organization_id: fallbackOrg.id });
    } catch (err) {
      next(err);
    }
  });

  // Strictly Super Admin only: citizens, helpers, and department officers cannot enumerate workspace members.
  router.get('/workspaces/current/members', requireAuth, requireRoles('admin'), async (req, res, next) => {
    try {
      const auth = req.auth!;
      const members = await store.listOrganizationMembers(auth.organizationId);
      res.json({
        members: members.map((m) => ({
          user_id: m.profile.id,
          email: m.profile.email,
          display_name: m.profile.display_name,
          preferred_language: m.profile.preferred_language,
          role: m.membership.role,
          department_id: m.membership.department_id,
          joined_at: m.membership.created_at,
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/workspaces/current/members', requireAuth, requireRoles('admin'), async (req, res, next) => {
    try {
      const auth = req.auth!;
      const body = inviteMemberSchema.parse(req.body);
      const profile = await store.getProfileByEmail(body.email);
      if (!profile) {
        throw new AppError(404, 'USER_NOT_FOUND', 'No registered user exists with that email address.');
      }
      if (body.department_id) {
        const depts = await store.listDepartments(auth.organizationId);
        if (!depts.some((d) => d.id === body.department_id)) {
          throw new AppError(400, 'INVALID_DEPARTMENT', 'Selected department does not belong to this workspace.');
        }
      }
      const membership = await store.upsertMembership({
        organization_id: auth.organizationId,
        user_id: profile.id,
        role: body.role,
        department_id: body.department_id ?? null,
      });
      await audit.log({
        organizationId: auth.organizationId,
        actorId: auth.userId,
        action: 'workspace.member_added_or_updated',
        resourceType: 'organization_membership',
        resourceId: membership.id,
        metadata: { target_user_id: profile.id, role: body.role },
      });
      res.status(201).json({ membership });
    } catch (err) {
      next(err);
    }
  });

  // Super Admin: remove any user from the active workspace (cannot remove self to prevent orphan lockout)
  router.delete('/workspaces/current/members/:userId', requireAuth, requireRoles('admin'), async (req, res, next) => {
    try {
      const auth = req.auth!;
      const targetUserId = String(req.params.userId);
      if (targetUserId === auth.userId) {
        throw new AppError(409, 'CANNOT_REMOVE_SELF', 'You cannot remove your own Super Admin membership from the active workspace.');
      }
      const removed = await store.removeMembership(auth.organizationId, targetUserId);
      if (!removed) {
        throw new AppError(404, 'MEMBERSHIP_NOT_FOUND', 'User is not a member of the active workspace.');
      }
      await audit.log({
        organizationId: auth.organizationId,
        actorId: auth.userId,
        action: 'workspace.member_removed',
        resourceType: 'organization_membership',
        resourceId: targetUserId,
        metadata: { removed_user_id: targetUserId },
      });
      res.json({ removed: true, user_id: targetUserId });
    } catch (err) {
      next(err);
    }
  });

  router.get('/workspaces/current/departments', requireAuth, requireRoles('admin', 'officer'), async (req, res, next) => {
    try {
      const departments = await store.listDepartments(req.auth!.organizationId);
      res.json({ departments });
    } catch (err) {
      next(err);
    }
  });

  router.post('/workspaces/current/departments', requireAuth, requireRoles('admin'), async (req, res, next) => {
    try {
      const auth = req.auth!;
      const body = createDepartmentSchema.parse(req.body);
      const department = await store.createDepartment(auth.organizationId, body);
      await audit.log({
        organizationId: auth.organizationId,
        actorId: auth.userId,
        action: 'department.created',
        resourceType: 'department',
        resourceId: department.id,
        metadata: { code: department.code },
      });
      res.status(201).json({ department });
    } catch (err) {
      next(err);
    }
  });

  // --- Notifications ---
  router.get('/notifications', requireAuth, async (req, res, next) => {
    try {
      const items = await notifications.listForUser(req.auth!.organizationId, req.auth!.userId);
      res.json({ notifications: items });
    } catch (err) {
      next(err);
    }
  });

  router.post('/notifications/:id/read', requireAuth, async (req, res, next) => {
    try {
      const updated = await notifications.markRead(
        req.auth!.organizationId,
        req.auth!.userId,
        String(req.params.id),
      );
      if (!updated) throw new AppError(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found.');
      res.json({ notification: updated });
    } catch (err) {
      next(err);
    }
  });

  // --- Registered SaaS Modules Discovery ---
  router.get('/modules', requireAuth, (_req, res) => {
    res.json({ modules: moduleRegistry.listManifests() });
  });

  return router;
}
