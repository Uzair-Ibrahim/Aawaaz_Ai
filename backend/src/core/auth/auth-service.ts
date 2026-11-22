import crypto from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { USER_ROLES, type AuthSessionUser, type LanguageCode, type Organization, type UserRole } from '@awaaz/shared';
import type { AppEnv } from '../../config/env';
import type { DataStore } from '../database/types';
import { DEFAULT_ORG_IDS } from '../database/seed-data';
import { hashPassword, sha256Hex, signDevToken, verifyDevToken, verifyPassword } from '../security/crypto';
import { AppError } from '../security/errors';

const ARABIC_DIGIT_MAP: Record<string, string> = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
  '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
};

export function toAsciiDigits(raw: string): string {
  return raw.replace(/[٠-٩۰-۹]/g, (ch) => ARABIC_DIGIT_MAP[ch] ?? ch);
}

export function normalizePhoneE164(raw: string): string {
  const ascii = toAsciiDigits(raw).trim();
  const cleaned = ascii.replace(/[\s\-().]/g, '');
  let normalized = cleaned;
  if (normalized.startsWith('00')) {
    normalized = `+${normalized.slice(2)}`;
  } else if (/^03\d{9}$/.test(normalized)) {
    // Common Pakistani mobile format 03XXXXXXXXX -> +923XXXXXXXXX
    normalized = `+92${normalized.slice(1)}`;
  } else if (/^923\d{9}$/.test(normalized)) {
    normalized = `+${normalized}`;
  } else if (!normalized.startsWith('+') && /^\d{10,15}$/.test(normalized)) {
    normalized = `+${normalized}`;
  }

  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
    throw new AppError(
      400,
      'INVALID_PHONE_NUMBER',
      'Please enter a valid mobile phone number (for example, +923001234567 or 03001234567).',
    );
  }
  return normalized;
}

export function maskPhoneNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  if (phone.length <= 6) return '***';
  return `${phone.slice(0, 3)}***${phone.slice(-4)}`;
}

export interface AuthContext {
  userId: string;
  email: string;
  displayName: string;
  preferredLanguage: LanguageCode;
  organizationId: string;
  organization: Organization;
  role: UserRole;
  departmentId: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
      authCleared?: boolean;
    }
  }
}

export class AuthService {
  private readonly env: AppEnv;
  private readonly store: DataStore;
  private readonly supabaseAuthClient: SupabaseClient | null;
  private readonly supabaseAdminClient: SupabaseClient | null;

  constructor(env: AppEnv, store: DataStore) {
    this.env = env;
    this.store = store;
    this.supabaseAuthClient =
      env.AUTH_MODE === 'supabase' && env.SUPABASE_URL && env.SUPABASE_ANON_KEY
        ? createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
            auth: { persistSession: false, autoRefreshToken: false },
          })
        : null;
    this.supabaseAdminClient =
      env.AUTH_MODE === 'supabase' && env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
        ? createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
            auth: { persistSession: false, autoRefreshToken: false },
          })
        : null;
  }

  async login(email: string, password: string): Promise<{ accessToken: string; user: AuthSessionUser }> {
    const normalizedEmail = email.trim().toLowerCase();

    if (this.env.AUTH_MODE === 'supabase') {
      if (!this.supabaseAuthClient) {
        throw new AppError(503, 'AUTH_UNCONFIGURED', 'Supabase Auth is not configured.');
      }
      const { data, error } = await this.supabaseAuthClient.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });
      if (error || !data.session || !data.user) {
        throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
      }
      const sessionUser = await this.buildSessionUser(data.user.id);
      return { accessToken: data.session.access_token, user: sessionUser };
    }

    // Isolated local-dev auth mode (strictly blocked in NODE_ENV=production by env.ts)
    const digitsOnly = normalizedEmail.replace(/\D/g, '');
    const formattedCnic =
      digitsOnly.length === 13
        ? `${digitsOnly.slice(0, 5)}-${digitsOnly.slice(5, 12)}-${digitsOnly.slice(12)}`
        : null;
    const candidateKeys = [
      normalizedEmail,
      ...(formattedCnic ? [formattedCnic, digitsOnly] : []),
      `pin:${normalizedEmail}`,
      ...(formattedCnic ? [`pin:${formattedCnic}`, `pin:${digitsOnly}`] : []),
    ];
    let matchedCred: { user_id: string; email: string; password_hash: string } | null = null;
    for (const key of candidateKeys) {
      const candidate = await this.store.getLocalCredentialByEmail?.(key);
      if (candidate && verifyPassword(password, candidate.password_hash)) {
        matchedCred = candidate;
        break;
      }
    }
    if (!matchedCred) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
    }

    const token = signDevToken(
      { sub: matchedCred.user_id, email: matchedCred.email },
      this.env.DEV_AUTH_SECRET,
    );
    const sessionUser = await this.buildSessionUser(matchedCred.user_id);
    return { accessToken: token, user: sessionUser };
  }

  async register(input: {
    email: string;
    password: string;
    display_name: string;
    preferred_language?: LanguageCode;
  }): Promise<{ accessToken: string; user: AuthSessionUser }> {
    const normalizedEmail = input.email.trim().toLowerCase();
    const existing = await this.store.getProfileByEmail(normalizedEmail);
    if (existing) {
      throw new AppError(409, 'EMAIL_EXISTS', 'An account with this email already exists.');
    }

    let userId: string;
    let accessToken: string;

    if (this.env.AUTH_MODE === 'supabase') {
      if (!this.supabaseAuthClient) {
        throw new AppError(503, 'AUTH_UNCONFIGURED', 'Supabase Auth is not configured.');
      }
      const { data, error } = await this.supabaseAuthClient.auth.signUp({
        email: normalizedEmail,
        password: input.password,
      });
      if (error || !data.user) {
        throw new AppError(400, 'SIGNUP_FAILED', error?.message ?? 'Could not register user.');
      }
      userId = data.user.id;
      accessToken = data.session?.access_token ?? '';
    } else {
      userId = crypto.randomUUID();
      await this.store.saveLocalCredential?.({
        user_id: userId,
        email: normalizedEmail,
        password_hash: hashPassword(input.password),
      });
      accessToken = signDevToken({ sub: userId, email: normalizedEmail }, this.env.DEV_AUTH_SECRET);
    }

    // Public self-registration ALWAYS creates a Normal User (citizen) in the default workspace.
    // Workspace creation and staff/admin role assignment are strictly Super Admin operations.
    const org = await this.store.getOrganizationById(DEFAULT_ORG_IDS.RELIEF_DEMO);
    if (!org) {
      throw new AppError(
        503,
        'DEFAULT_WORKSPACE_MISSING',
        'No default citizen workspace is provisioned. Contact a Super Admin.',
      );
    }
    const assignedRole: UserRole = 'citizen';

    await this.store.createProfile({
      id: userId,
      email: normalizedEmail,
      display_name: input.display_name.trim(),
      role: assignedRole,
      default_organization_id: org.id,
      preferred_language: input.preferred_language ?? 'en',
    });

    await this.store.upsertMembership({
      organization_id: org.id,
      user_id: userId,
      role: assignedRole,
    });

    await this.store.appendAuditLog({
      organization_id: org.id,
      actor_id: userId,
      action: 'user.registered',
      resource_type: 'profile',
      resource_id: userId,
      metadata: { role: assignedRole, organization_slug: org.slug },
    });

    const user = await this.buildSessionUser(userId, org.id);
    return { accessToken, user };
  }

  /**
   * Starts phone-ownership verification by issuing a single-use, hashed 6-digit OTP challenge.
   * Never creates or exposes account existence before ownership is verified.
   */
  async requestPhoneOtp(input: {
    phone_number: string;
    preferred_language?: LanguageCode;
  }): Promise<{
    challenge_id: string;
    masked_phone: string;
    expires_in_seconds: number;
    delivery_mode: 'sms' | 'dev_local_preview';
    dev_otp_preview?: string;
  }> {
    const phoneE164 = normalizePhoneE164(input.phone_number);
    const maskedPhone = maskPhoneNumber(phoneE164) ?? '***';

    if (this.env.OTP_PROVIDER === 'supabase_sms') {
      if (!this.supabaseAuthClient) {
        throw new AppError(503, 'OTP_PROVIDER_UNCONFIGURED', 'Supabase SMS OTP provider is not configured.');
      }
      const { error } = await this.supabaseAuthClient.auth.signInWithOtp({ phone: phoneE164 });
      if (error) {
        throw new AppError(502, 'OTP_DELIVERY_FAILED', error.message);
      }
      // Track challenge reference for uniform verify endpoint
      const challenge = await this.store.createPhoneOtpChallenge({
        phone_number: phoneE164,
        otp_hash: 'supabase_sms_managed',
        salt: 'supabase',
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        max_attempts: 5,
      });
      return {
        challenge_id: challenge.id,
        masked_phone: maskedPhone,
        expires_in_seconds: 300,
        delivery_mode: 'sms',
      };
    }

    if (this.env.AUTH_MODE !== 'dev_local' || this.env.NODE_ENV === 'production') {
      throw new AppError(
        503,
        'OTP_PROVIDER_UNCONFIGURED',
        'No live SMS OTP provider is configured (set OTP_PROVIDER=supabase_sms with Supabase Phone Auth credentials).',
      );
    }

    const otpCode = String(crypto.randomInt(100000, 1000000));
    const salt = crypto.randomBytes(16).toString('hex');
    const otpHash = sha256Hex(`${salt}:${otpCode}`);
    const challenge = await this.store.createPhoneOtpChallenge({
      phone_number: phoneE164,
      otp_hash: otpHash,
      salt,
      expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      max_attempts: 5,
    });

    return {
      challenge_id: challenge.id,
      masked_phone: maskedPhone,
      expires_in_seconds: 300,
      delivery_mode: 'dev_local_preview',
      dev_otp_preview: otpCode,
    };
  }

  /**
   * Verifies OTP ownership and creates, signs into, or links a citizen account without duplicates.
   */
  async verifyPhoneOtpAndAuthenticate(input: {
    challenge_id: string;
    phone_number: string;
    otp_code: string;
    display_name?: string;
    preferred_language?: LanguageCode;
    existingUserId?: string | null;
  }): Promise<{
    accessToken: string;
    user: AuthSessionUser;
    account_status: 'created' | 'existing_signed_in' | 'linked';
  }> {
    const phoneE164 = normalizePhoneE164(input.phone_number);
    const otpDigits = toAsciiDigits(input.otp_code).replace(/\s+/g, '');
    if (!/^\d{6}$/.test(otpDigits)) {
      throw new AppError(400, 'INVALID_OTP_FORMAT', 'Verification code must be 6 digits.');
    }

    const challenge = await this.store.getPhoneOtpChallengeById(input.challenge_id);
    if (!challenge || challenge.phone_number !== phoneE164) {
      throw new AppError(401, 'INVALID_OTP', 'Invalid verification code or phone number.');
    }
    if (challenge.consumed_at) {
      throw new AppError(410, 'OTP_ALREADY_USED', 'This verification code has already been used. Request a new code.');
    }
    if (new Date(challenge.expires_at).getTime() < Date.now()) {
      throw new AppError(410, 'OTP_EXPIRED', 'This verification code has expired. Request a new code.');
    }
    if (challenge.attempts >= challenge.max_attempts) {
      throw new AppError(429, 'OTP_MAX_ATTEMPTS', 'Too many incorrect attempts. Please request a new verification code.');
    }

    let supabaseSessionToken = '';
    if (this.env.OTP_PROVIDER === 'supabase_sms') {
      if (!this.supabaseAuthClient) {
        throw new AppError(503, 'OTP_PROVIDER_UNCONFIGURED', 'Supabase SMS OTP provider is not configured.');
      }
      const { data, error } = await this.supabaseAuthClient.auth.verifyOtp({
        phone: phoneE164,
        token: otpDigits,
        type: 'sms',
      });
      if (error || !data.user) {
        await this.store.incrementPhoneOtpAttempts(challenge.id);
        throw new AppError(401, 'INVALID_OTP', 'Invalid verification code.');
      }
      supabaseSessionToken = data.session?.access_token ?? '';
    } else {
      const candidateHash = sha256Hex(`${challenge.salt}:${otpDigits}`);
      const a = Buffer.from(candidateHash, 'hex');
      const b = Buffer.from(challenge.otp_hash, 'hex');
      const matched = a.length === b.length && crypto.timingSafeEqual(a, b);
      if (!matched) {
        await this.store.incrementPhoneOtpAttempts(challenge.id);
        throw new AppError(401, 'INVALID_OTP', 'Invalid verification code.');
      }
    }

    await this.store.markPhoneOtpConsumed(challenge.id);

    const nowIso = new Date().toISOString();
    const maskedPhone = maskPhoneNumber(phoneE164);
    const existingByPhone = await this.store.getProfileByPhone(phoneE164);

    // Case 1: Phone already registered -> never create duplicate; sign into existing citizen account
    if (existingByPhone) {
      if (input.existingUserId && existingByPhone.id !== input.existingUserId) {
        throw new AppError(
          409,
          'PHONE_ALREADY_REGISTERED',
          'This phone number is already linked to another account.',
        );
      }
      if (existingByPhone.role !== 'citizen') {
        throw new AppError(
          409,
          'STAFF_ACCOUNT_USE_EMAIL_LOGIN',
          'This phone number belongs to a staff account. Please sign in using your email and password.',
        );
      }

      const patch: Partial<{ preferred_language: LanguageCode; phone_verified_at: string }> = {
        phone_verified_at: nowIso,
      };
      if (input.preferred_language) {
        patch.preferred_language = input.preferred_language;
      }
      await this.store.updateProfile(existingByPhone.id, patch);

      const user = await this.buildSessionUser(existingByPhone.id);
      const accessToken =
        this.env.AUTH_MODE === 'supabase'
          ? supabaseSessionToken
          : signDevToken({ sub: existingByPhone.id, email: existingByPhone.email }, this.env.DEV_AUTH_SECRET);

      await this.store.appendAuditLog({
        organization_id: user.active_organization.id,
        actor_id: existingByPhone.id,
        action: 'auth.phone_verified_signin',
        resource_type: 'session',
        resource_id: existingByPhone.id,
        metadata: { masked_phone: maskedPhone, delivery_mode: this.env.OTP_PROVIDER },
      });

      return { accessToken, user, account_status: 'existing_signed_in' };
    }

    // Case 2: Authenticated citizen linking a new verified phone number to their existing account
    if (input.existingUserId) {
      const currentProfile = await this.store.getProfileById(input.existingUserId);
      if (!currentProfile) {
        throw new AppError(404, 'PROFILE_NOT_FOUND', 'Account profile not found.');
      }
      if (currentProfile.role !== 'citizen') {
        throw new AppError(403, 'CITIZEN_ONLY', 'Phone onboarding linking is only for citizen accounts.');
      }
      await this.store.updateProfile(currentProfile.id, {
        phone_number: phoneE164,
        phone_verified_at: nowIso,
        ...(input.preferred_language ? { preferred_language: input.preferred_language } : {}),
      });
      const user = await this.buildSessionUser(currentProfile.id);
      const accessToken =
        this.env.AUTH_MODE === 'supabase'
          ? supabaseSessionToken
          : signDevToken({ sub: currentProfile.id, email: currentProfile.email }, this.env.DEV_AUTH_SECRET);

      await this.store.appendAuditLog({
        organization_id: user.active_organization.id,
        actor_id: currentProfile.id,
        action: 'auth.phone_linked',
        resource_type: 'profile',
        resource_id: currentProfile.id,
        metadata: { masked_phone: maskedPhone },
      });

      return { accessToken, user, account_status: 'linked' };
    }

    // Case 3: New citizen account created via verified phone ownership (strictly 'citizen' role in default workspace)
    const trimmedName = (input.display_name ?? '').trim();
    if (trimmedName.length < 2) {
      throw new AppError(400, 'DISPLAY_NAME_REQUIRED', 'Please provide your name to create your citizen account.');
    }

    const org = await this.store.getOrganizationById(DEFAULT_ORG_IDS.RELIEF_DEMO);
    if (!org) {
      throw new AppError(
        503,
        'DEFAULT_WORKSPACE_MISSING',
        'No default citizen workspace is provisioned. Contact a Super Admin.',
      );
    }

    const userId = crypto.randomUUID();
    const internalEmail = `citizen-${sha256Hex(phoneE164).slice(0, 12)}@phone.awaaz.local`;
    const assignedRole: UserRole = 'citizen';

    if (this.env.AUTH_MODE === 'dev_local') {
      await this.store.saveLocalCredential?.({
        user_id: userId,
        email: internalEmail,
        password_hash: hashPassword(crypto.randomBytes(24).toString('hex')),
      });
    }

    await this.store.createProfile({
      id: userId,
      email: internalEmail,
      display_name: trimmedName,
      phone_number: phoneE164,
      phone_verified_at: nowIso,
      role: assignedRole,
      default_organization_id: org.id,
      preferred_language: input.preferred_language ?? 'en',
    });

    await this.store.upsertMembership({
      organization_id: org.id,
      user_id: userId,
      role: assignedRole,
    });

    await this.store.appendAuditLog({
      organization_id: org.id,
      actor_id: userId,
      action: 'user.registered_via_phone',
      resource_type: 'profile',
      resource_id: userId,
      metadata: {
        role: assignedRole,
        organization_slug: org.slug,
        masked_phone: maskedPhone,
      },
    });

    const user = await this.buildSessionUser(userId, org.id);
    const accessToken =
      this.env.AUTH_MODE === 'supabase'
        ? supabaseSessionToken
        : signDevToken({ sub: userId, email: internalEmail }, this.env.DEV_AUTH_SECRET);

    return { accessToken, user, account_status: 'created' };
  }

  /**
   * Super Admin creates a department staff account directly inside the admin's active workspace.
   */
  async createDepartmentAccountByAdmin(
    adminAuth: AuthContext,
    input: {
      email: string;
      password: string;
      display_name: string;
      role: 'officer' | 'helper' | 'admin';
      department_id?: string | null;
      preferred_language?: LanguageCode;
    },
  ): Promise<{
    user_id: string;
    email: string;
    display_name: string;
    role: UserRole;
    department_id: string | null;
    organization_id: string;
  }> {
    if (adminAuth.role !== 'admin') {
      throw new AppError(403, 'SUPER_ADMIN_ONLY', 'Only a Super Admin may create department accounts.');
    }

    const normalizedEmail = input.email.trim().toLowerCase();
    const existing = await this.store.getProfileByEmail(normalizedEmail);
    if (existing) {
      throw new AppError(409, 'EMAIL_EXISTS', 'An account with this email already exists.');
    }

    if (input.department_id) {
      const departments = await this.store.listDepartments(adminAuth.organizationId);
      if (!departments.some((d) => d.id === input.department_id)) {
        throw new AppError(400, 'INVALID_DEPARTMENT', 'Selected department does not belong to your workspace.');
      }
    }

    let userId: string;
    if (this.env.AUTH_MODE === 'supabase') {
      if (!this.supabaseAdminClient) {
        throw new AppError(503, 'AUTH_ADMIN_UNCONFIGURED', 'Supabase service-role auth client is not configured.');
      }
      const { data, error } = await this.supabaseAdminClient.auth.admin.createUser({
        email: normalizedEmail,
        password: input.password,
        email_confirm: true,
      });
      if (error || !data.user) {
        throw new AppError(400, 'CREATE_USER_FAILED', error?.message ?? 'Could not create department account.');
      }
      userId = data.user.id;
    } else {
      userId = crypto.randomUUID();
      await this.store.saveLocalCredential?.({
        user_id: userId,
        email: normalizedEmail,
        password_hash: hashPassword(input.password),
      });
    }

    await this.store.createProfile({
      id: userId,
      email: normalizedEmail,
      display_name: input.display_name.trim(),
      role: input.role,
      default_organization_id: adminAuth.organizationId,
      department_id: input.department_id ?? null,
      preferred_language: input.preferred_language ?? 'en',
    });

    await this.store.upsertMembership({
      organization_id: adminAuth.organizationId,
      user_id: userId,
      role: input.role,
      department_id: input.department_id ?? null,
    });

    await this.store.appendAuditLog({
      organization_id: adminAuth.organizationId,
      actor_id: adminAuth.userId,
      action: 'admin.department_account_created',
      resource_type: 'profile',
      resource_id: userId,
      metadata: {
        role: input.role,
        department_id: input.department_id ?? null,
        email: normalizedEmail,
      },
    });

    return {
      user_id: userId,
      email: normalizedEmail,
      display_name: input.display_name.trim(),
      role: input.role,
      department_id: input.department_id ?? null,
      organization_id: adminAuth.organizationId,
    };
  }

  async verifyAccessToken(token: string): Promise<{ userId: string; email: string }> {
    if (this.env.AUTH_MODE === 'supabase') {
      if (!this.supabaseAuthClient) {
        throw new AppError(503, 'AUTH_UNCONFIGURED', 'Supabase Auth is not configured.');
      }
      const { data, error } = await this.supabaseAuthClient.auth.getUser(token);
      if (error || !data.user) {
        throw new AppError(401, 'INVALID_TOKEN', 'Session token is invalid or expired.');
      }
      return { userId: data.user.id, email: data.user.email ?? '' };
    }

    const payload = verifyDevToken(token, this.env.DEV_AUTH_SECRET);
    if (!payload) {
      throw new AppError(401, 'INVALID_TOKEN', 'Session token is invalid or expired.');
    }
    return { userId: payload.sub, email: payload.email };
  }

  async resolveAuthContext(token: string, requestedOrgId?: string): Promise<AuthContext> {
    const { userId } = await this.verifyAccessToken(token);
    const profile = await this.store.getProfileById(userId);
    if (!profile) {
      throw new AppError(401, 'PROFILE_MISSING', 'Authenticated user profile does not exist.');
    }

    const orgs = await this.store.listOrganizationsForUser(userId);
    if (orgs.length === 0) {
      throw new AppError(403, 'NO_WORKSPACE_MEMBERSHIP', 'User does not belong to any organization workspace.');
    }

    let selected = orgs[0]!;
    if (requestedOrgId) {
      const match = orgs.find((o) => o.id === requestedOrgId);
      if (!match) {
        throw new AppError(
          403,
          'TENANT_ACCESS_DENIED',
          'You do not have membership in the requested organization workspace.',
        );
      }
      selected = match;
    } else if (profile.default_organization_id) {
      const def = orgs.find((o) => o.id === profile.default_organization_id);
      if (def) selected = def;
    }

    if (!USER_ROLES.includes(selected.role)) {
      throw new AppError(
        403,
        'ROLE_DEPRECATED',
        'This account role is no longer active. Contact a Super Admin for role reassignment.',
      );
    }

    return {
      userId: profile.id,
      email: profile.email,
      displayName: profile.display_name,
      preferredLanguage: profile.preferred_language,
      organizationId: selected.id,
      organization: {
        id: selected.id,
        name: selected.name,
        slug: selected.slug,
        plan_tier: selected.plan_tier,
        enabled_modules: selected.enabled_modules,
        created_at: selected.created_at,
        updated_at: selected.updated_at,
      },
      role: selected.role,
      departmentId: selected.department_id,
    };
  }

  async buildSessionUser(userId: string, requestedOrgId?: string): Promise<AuthSessionUser> {
    const profile = await this.store.getProfileById(userId);
    if (!profile) throw new AppError(404, 'PROFILE_NOT_FOUND', 'User profile not found.');

    const orgs = await this.store.listOrganizationsForUser(userId);
    if (orgs.length === 0) {
      throw new AppError(403, 'NO_WORKSPACE_MEMBERSHIP', 'User has no organization memberships.');
    }

    const active =
      (requestedOrgId ? orgs.find((o) => o.id === requestedOrgId) : undefined) ??
      orgs.find((o) => o.id === profile.default_organization_id) ??
      orgs[0]!;

    return {
      id: profile.id,
      email: profile.email,
      display_name: profile.display_name,
      masked_phone: maskPhoneNumber(profile.phone_number),
      phone_verified: Boolean(profile.phone_verified_at),
      preferred_language: profile.preferred_language,
      active_organization: {
        id: active.id,
        name: active.name,
        slug: active.slug,
        plan_tier: active.plan_tier,
        enabled_modules: active.enabled_modules,
        created_at: active.created_at,
        updated_at: active.updated_at,
      },
      active_role: active.role,
      department_id: active.department_id,
      memberships: orgs.map((o) => ({
        organization_id: o.id,
        organization_name: o.name,
        organization_slug: o.slug,
        role: o.role,
        department_id: o.department_id,
      })),
    };
  }

  /**
   * Pillar 1: Voice Citizen Account Registration with strict validation (13-digit CNIC, Pakistani mobile, 4-digit PIN).
   * Persists a real citizen account in the DB and issues a valid auth session token.
   */
  async registerCitizenVoiceAccount(input: {
    full_name: string;
    cnic: string;
    phone: string;
    pin: string;
    preferred_language?: LanguageCode;
  }): Promise<{
    accessToken: string;
    user: AuthSessionUser;
    citizen: { id: string; display_name: string; mock_identity_reference: string };
  }> {
    const cleanName = input.full_name.trim();
    if (cleanName.length < 3 || cleanName.length > 80 || /\d/.test(cleanName)) {
      throw new AppError(400, 'INVALID_FULL_NAME', 'Full name must be 3-80 alphabetic characters with no digits.');
    }

    const cnicDigits = toAsciiDigits(input.cnic).replace(/\D/g, '');
    if (cnicDigits.length !== 13) {
      throw new AppError(
        400,
        'INVALID_CNIC',
        `CNIC must be exactly 13 digits (received ${cnicDigits.length} digits). Format: XXXXX-XXXXXXX-X.`,
      );
    }
    const formattedCnic = `${cnicDigits.slice(0, 5)}-${cnicDigits.slice(5, 12)}-${cnicDigits.slice(12)}`;

    const phoneE164 = normalizePhoneE164(input.phone);
    if (!/^\+923\d{9}$/.test(phoneE164)) {
      throw new AppError(400, 'INVALID_PHONE', 'Phone must be a valid Pakistani mobile number (03XXXXXXXXX or +923XXXXXXXXX).');
    }

    const pinDigits = toAsciiDigits(input.pin).replace(/\D/g, '');
    if (pinDigits.length !== 4) {
      throw new AppError(400, 'INVALID_PIN', 'PIN must be exactly 4 digits.');
    }

    const org = await this.store.getOrganizationById(DEFAULT_ORG_IDS.RELIEF_DEMO);
    if (!org) {
      throw new AppError(503, 'DEFAULT_WORKSPACE_MISSING', 'Default citizen workspace not provisioned.');
    }

    // Check if an account already exists with this phone or CNIC
    const existingByPhone = await this.store.getProfileByPhone(phoneE164);
    const existingCitizens = await this.store.findCitizensByMockIdentity(org.id, formattedCnic);
    const existingCitizen = existingCitizens[0] ?? null;

    let userId: string;
    let userEmail: string;

    if (existingByPhone) {
      userId = existingByPhone.id;
      userEmail = existingByPhone.email;
      await this.store.updateProfile(userId, {
        display_name: cleanName,
        preferred_language: input.preferred_language ?? existingByPhone.preferred_language,
        phone_verified_at: new Date().toISOString(),
      });
    } else if (existingCitizen?.user_id) {
      const existingProf = await this.store.getProfileById(existingCitizen.user_id);
      userId = existingCitizen.user_id;
      userEmail = existingProf?.email ?? `citizen-${cnicDigits.slice(-6)}@voice.awaaz.local`;
      await this.store.updateProfile(userId, {
        display_name: cleanName,
        phone_number: phoneE164,
        phone_verified_at: new Date().toISOString(),
        preferred_language: input.preferred_language ?? 'ur',
      });
    } else {
      userId = crypto.randomUUID();
      userEmail = `citizen-${cnicDigits.slice(-6)}-${sha256Hex(phoneE164).slice(0, 6)}@voice.awaaz.local`;
      await this.store.createProfile({
        id: userId,
        email: userEmail,
        display_name: cleanName,
        phone_number: phoneE164,
        phone_verified_at: new Date().toISOString(),
        role: 'citizen',
        default_organization_id: org.id,
        preferred_language: input.preferred_language ?? 'ur',
      });
      await this.store.upsertMembership({
        organization_id: org.id,
        user_id: userId,
        role: 'citizen',
      });
    }

    // Store voice PIN credentials keyed by CNIC, phone, normalized name/username, and email
    const pinHash = hashPassword(pinDigits);
    await this.store.saveLocalCredential?.({
      user_id: userId,
      email: userEmail.toLowerCase(),
      password_hash: pinHash,
    });
    await this.store.saveLocalCredential?.({
      user_id: userId,
      email: `pin:${formattedCnic.toLowerCase()}`,
      password_hash: pinHash,
    });
    await this.store.saveLocalCredential?.({
      user_id: userId,
      email: `pin:${cnicDigits}`,
      password_hash: pinHash,
    });
    await this.store.saveLocalCredential?.({
      user_id: userId,
      email: `pin:${phoneE164.toLowerCase()}`,
      password_hash: pinHash,
    });
    await this.store.saveLocalCredential?.({
      user_id: userId,
      email: `pin:${cleanName.toLowerCase()}`,
      password_hash: pinHash,
    });
    await this.store.saveLocalCredential?.({
      user_id: userId,
      email: `pin:${cleanName.toLowerCase().replace(/\s+/g, '_')}`,
      password_hash: pinHash,
    });

    // Ensure citizen record and verified identity exist in DB
    let citizen = await this.store.getCitizenByUserId(org.id, userId);
    if (!citizen) {
      citizen = await this.store.createCitizen({
        organization_id: org.id,
        user_id: userId,
        display_name: cleanName,
        mock_identity_reference: formattedCnic,
      });
    }
    await this.store.upsertMockIdentityRecord({
      organization_id: org.id,
      mock_identity_reference: formattedCnic,
      full_name: cleanName,
      district: 'Pakistan',
      verified: true,
    });

    const accessToken = signDevToken({ sub: userId, email: userEmail }, this.env.DEV_AUTH_SECRET);
    const user = await this.buildSessionUser(userId, org.id);

    await this.store.appendAuditLog({
      organization_id: org.id,
      actor_id: userId,
      action: 'auth.voice_citizen_registered',
      resource_type: 'citizen',
      resource_id: citizen.id,
      metadata: {
        masked_phone: maskPhoneNumber(phoneE164),
        cnic_masked: `${formattedCnic.slice(0, 5)}-*******-${formattedCnic.slice(-1)}`,
        language: input.preferred_language ?? 'ur',
      },
    });

    return {
      accessToken,
      user,
      citizen: {
        id: citizen.id,
        display_name: citizen.display_name,
        mock_identity_reference: citizen.mock_identity_reference,
      },
    };
  }

  /**
   * Pillar 1: Voice Citizen Account Login via CNIC, Phone, Username (e.g. citizen_zainab), or Email + PIN/Password.
   */
  async loginCitizenVoiceAccount(input: {
    identifier: string;
    pin_or_password: string;
  }): Promise<{
    accessToken: string;
    user: AuthSessionUser;
    citizen: { id: string; display_name: string; mock_identity_reference: string } | null;
  }> {
    const rawId = input.identifier.trim();
    const secret = toAsciiDigits(input.pin_or_password).trim();
    if (!rawId || !secret) {
      throw new AppError(400, 'CREDENTIALS_REQUIRED', 'Please provide your CNIC, phone, or username along with your PIN/password.');
    }

    const underscoreId = rawId.toLowerCase().replace(/\s+/g, '_');
    const candidates: string[] = [
      rawId.toLowerCase(),
      underscoreId,
      `pin:${rawId.toLowerCase()}`,
      `pin:${underscoreId}`,
    ];
    const digitsOnly = toAsciiDigits(rawId).replace(/\D/g, '');
    if (digitsOnly.length === 13) {
      const formattedCnic = `${digitsOnly.slice(0, 5)}-${digitsOnly.slice(5, 12)}-${digitsOnly.slice(12)}`;
      candidates.push(`pin:${formattedCnic.toLowerCase()}`, `pin:${digitsOnly}`);
    }
    try {
      const phoneE164 = normalizePhoneE164(rawId);
      candidates.push(`pin:${phoneE164.toLowerCase()}`);
    } catch {
      // Not a phone number
    }

    let matchedUserId: string | null = null;
    let matchedEmail: string | null = null;

    for (const key of candidates) {
      const cred = await this.store.getLocalCredentialByEmail?.(key);
      if (cred && verifyPassword(secret, cred.password_hash)) {
        matchedUserId = cred.user_id;
        matchedEmail = cred.email;
        break;
      }
    }

    if (!matchedUserId || !matchedEmail) {
      throw new AppError(401, 'INVALID_VOICE_CREDENTIALS', 'Invalid CNIC/phone/username or PIN/password.');
    }

    const accessToken = signDevToken({ sub: matchedUserId, email: matchedEmail }, this.env.DEV_AUTH_SECRET);
    const user = await this.buildSessionUser(matchedUserId);
    const citizen = await this.store.getCitizenByUserId(user.active_organization.id, matchedUserId);

    await this.store.appendAuditLog({
      organization_id: user.active_organization.id,
      actor_id: matchedUserId,
      action: 'auth.voice_citizen_login',
      resource_type: 'session',
      resource_id: matchedUserId,
      metadata: { role: user.active_role },
    });

    return {
      accessToken,
      user,
      citizen: citizen
        ? {
            id: citizen.id,
            display_name: citizen.display_name,
            mock_identity_reference: citizen.mock_identity_reference,
          }
        : null,
    };
  }
}
