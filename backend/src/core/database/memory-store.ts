import crypto from 'node:crypto';
import type {
  AgentEscalationRecord,
  AgentMemorySessionRecord,
  AgentNluRagMemoryRecord,
  AgentReasoningAuditLogRecord,
  AiRunRecord,
  AssistanceRequestRecord,
  AuditLogEntry,
  CaseAnswerRecord,
  CaseRecord,
  CaseReviewRecord,
  CitizenRecord,
  ConsentRecord,
  Department,
  DocumentRecord,
  EligibilityRuleDefinition,
  EligibilityRuleRecord,
  HumanizedGuidanceRecord,
  LanguageCode,
  MockIdentityRecord,
  MockPaymentRecord,
  NotificationItem,
  OfficerInquiryRecord,
  Organization,
  OrganizationMembership,
  PolicyChunkRecord,
  PolicyRecord,
  RuleVersionRecord,
  ServiceDepartmentCode,
  UniversalRagCollection,
  UniversalRagDocumentRecord,
  UserProfile,
  UserRole,
} from '@awaaz/shared';
import { hashPassword, sha256Hex } from '../security/crypto';
import { AppError } from '../security/errors';
import {
  DEFAULT_DEPARTMENT_IDS,
  DEFAULT_ORG_IDS,
  DEFAULT_RULE_DEFINITION,
  DEFAULT_USER_IDS,
  SYNTHETIC_MOCK_IDENTITIES,
  SYNTHETIC_POLICIES,
} from './seed-data';
import type { DataStore, PhoneOtpChallengeRecord, StoredLocalUserCredential } from './types';

function nowIso(): string {
  return new Date().toISOString();
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    const va = a[i] ?? 0;
    const vb = b[i] ?? 0;
    dot += va * vb;
    magA += va * va;
    magB += vb * vb;
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Isolated in-memory DataStore for local development & automated tests ONLY.
 * Strictly blocked when NODE_ENV === 'production' by env.ts.
 */
export class MemoryDataStore implements DataStore {
  public readonly mode = 'memory' as const;

  private organizations = new Map<string, Organization>();
  private departments = new Map<string, Department>();
  private profiles = new Map<string, UserProfile>();
  private memberships = new Map<string, OrganizationMembership>();
  private localCredentials = new Map<string, StoredLocalUserCredential>();
  private phoneOtpChallenges = new Map<string, PhoneOtpChallengeRecord>();
  private citizens = new Map<string, CitizenRecord>();
  private cases = new Map<string, CaseRecord>();
  private caseAnswers = new Map<string, CaseAnswerRecord>();
  private documents = new Map<string, DocumentRecord>();
  private rules = new Map<string, EligibilityRuleRecord>();
  private ruleVersions = new Map<string, RuleVersionRecord>();
  private policies = new Map<string, PolicyRecord>();
  private policyChunks = new Map<string, PolicyChunkRecord>();
  private consents = new Map<string, ConsentRecord>();
  private aiRuns = new Map<string, AiRunRecord>();
  private caseReviews = new Map<string, CaseReviewRecord>();
  private mockIdentities = new Map<string, MockIdentityRecord>();
  private mockPayments = new Map<string, MockPaymentRecord>();
  private auditLogs: AuditLogEntry[] = [];
  private notifications = new Map<string, NotificationItem>();
  private assistanceRequests = new Map<string, AssistanceRequestRecord>();
  private humanizedGuidance = new Map<string, HumanizedGuidanceRecord>();
  private agentMemorySessions = new Map<string, AgentMemorySessionRecord>();
  private agentReasoningAuditLogs: AgentReasoningAuditLogRecord[] = [];
  private universalRagDocuments = new Map<string, UniversalRagDocumentRecord>();
  private agentEscalations = new Map<string, AgentEscalationRecord>();
  private officerInquiries = new Map<string, OfficerInquiryRecord>();
  private agentNluRagMemories = new Map<string, AgentNluRagMemoryRecord>();

  constructor(seedDemoData = true) {
    if (seedDemoData) {
      this.seedSyntheticDevWorkspace();
    }
  }

  private seedSyntheticDevWorkspace(): void {
    const ts = nowIso();
    const orgA: Organization = {
      id: DEFAULT_ORG_IDS.RELIEF_DEMO,
      name: 'Awaaz Demo Relief District (Synthetic)',
      slug: 'awaaz-demo-district',
      plan_tier: 'free',
      enabled_modules: ['relief-assistance'],
      created_at: ts,
      updated_at: ts,
    };
    const orgB: Organization = {
      id: DEFAULT_ORG_IDS.PROVINCE_BETA,
      name: 'Northern Relief Authority Sandbox (Synthetic)',
      slug: 'northern-relief-sandbox',
      plan_tier: 'standard',
      enabled_modules: ['relief-assistance'],
      created_at: ts,
      updated_at: ts,
    };
    this.organizations.set(orgA.id, orgA);
    this.organizations.set(orgB.id, orgB);

    const deptA: Department = {
      id: DEFAULT_DEPARTMENT_IDS.RELIEF_ASSISTANCE,
      organization_id: orgA.id,
      name: 'Relief Assistance Department',
      code: 'RELIEF_ASSISTANCE',
      created_at: ts,
    };
    const deptScam: Department = {
      id: DEFAULT_DEPARTMENT_IDS.SCAM_CYBER_SAFETY,
      organization_id: orgA.id,
      name: 'Scam & Cyber Safety Department',
      code: 'SCAM_CYBER_SAFETY',
      created_at: ts,
    };
    const deptB: Department = {
      id: DEFAULT_DEPARTMENT_IDS.PROV_RELIEF,
      organization_id: orgB.id,
      name: 'Provincial Relief Unit',
      code: 'RELIEF_ASSISTANCE',
      created_at: ts,
    };
    this.departments.set(deptA.id, deptA);
    this.departments.set(deptScam.id, deptScam);
    this.departments.set(deptB.id, deptB);

    // Clearly labeled local-dev synthetic accounts (password: DemoPass123!)
    const devPasswordHash = hashPassword('DemoPass123!');
    const demoUsers: Array<{
      id: string;
      email: string;
      display_name: string;
      role: UserRole;
      orgId: string;
      deptId: string | null;
      lang: LanguageCode;
    }> = [
      {
        id: DEFAULT_USER_IDS.CITIZEN_A,
        email: 'citizen@demo.awaaz.local',
        display_name: 'Amina Bibi (Synthetic Citizen)',
        role: 'citizen',
        orgId: orgA.id,
        deptId: null,
        lang: 'ur',
      },
      {
        id: DEFAULT_USER_IDS.HELPER_A,
        email: 'helper@demo.awaaz.local',
        display_name: 'Bilal Ahmed (Community Helper)',
        role: 'helper',
        orgId: orgA.id,
        deptId: null,
        lang: 'en',
      },
      {
        id: DEFAULT_USER_IDS.OFFICER_A,
        email: 'officer@demo.awaaz.local',
        display_name: 'Fatima Zahra (Dept Officer)',
        role: 'officer',
        orgId: orgA.id,
        deptId: deptA.id,
        lang: 'en',
      },
      {
        id: DEFAULT_USER_IDS.ADMIN_A,
        email: 'admin@demo.awaaz.local',
        display_name: 'Usman Raza (Super Admin)',
        role: 'admin',
        orgId: orgA.id,
        deptId: deptA.id,
        lang: 'en',
      },
      {
        id: DEFAULT_USER_IDS.CITIZEN_B,
        email: 'citizen-beta@demo.awaaz.local',
        display_name: 'Zainab Noor (Tenant B Citizen)',
        role: 'citizen',
        orgId: orgB.id,
        deptId: null,
        lang: 'en',
      },
      {
        id: DEFAULT_USER_IDS.OFFICER_B,
        email: 'officer-beta@demo.awaaz.local',
        display_name: 'Imran Khan (Tenant B Officer)',
        role: 'officer',
        orgId: orgB.id,
        deptId: deptB.id,
        lang: 'en',
      },
    ];

    for (const u of demoUsers) {
      this.profiles.set(u.id, {
        id: u.id,
        email: u.email,
        display_name: u.display_name,
        role: u.role,
        default_organization_id: u.orgId,
        department_id: u.deptId,
        preferred_language: u.lang,
        created_at: ts,
        updated_at: ts,
      });
      this.localCredentials.set(u.email.toLowerCase(), {
        user_id: u.id,
        email: u.email.toLowerCase(),
        password_hash: devPasswordHash,
      });
      const memId = crypto.randomUUID();
      this.memberships.set(memId, {
        id: memId,
        organization_id: u.orgId,
        user_id: u.id,
        role: u.role,
        department_id: u.deptId,
        created_at: ts,
      });
    }

    // Seed synthetic citizen profiles
    this.citizens.set('cccc1111-1111-4111-8111-111111111111', {
      id: 'cccc1111-1111-4111-8111-111111111111',
      organization_id: orgA.id,
      user_id: DEFAULT_USER_IDS.CITIZEN_A,
      display_name: 'Amina Bibi',
      mock_identity_reference: 'MOCK-ID-1001',
      created_at: ts,
    });
    this.citizens.set('cccc2222-2222-4222-8222-222222222222', {
      id: 'cccc2222-2222-4222-8222-222222222222',
      organization_id: orgB.id,
      user_id: DEFAULT_USER_IDS.CITIZEN_B,
      display_name: 'Zainab Noor',
      mock_identity_reference: 'MOCK-ID-2001',
      created_at: ts,
    });

    // Seed named persona accounts supporting short username login (admin_ayesha, officer_hamza, auditor_bilal, citizen_zainab)
    const personaUsers: Array<{
      id: string;
      username: string;
      email: string;
      password: string;
      pin?: string;
      phone?: string;
      cnic?: string;
      display_name: string;
      role: UserRole;
      deptId: string | null;
      lang: LanguageCode;
    }> = [
      {
        id: 'aaaa5555-1111-4111-8111-111111111111',
        username: 'admin_ayesha',
        email: 'admin_ayesha@demo.awaaz.local',
        password: 'admin123',
        display_name: 'Admin Ayesha (Super Admin)',
        role: 'admin',
        deptId: deptA.id,
        lang: 'en',
      },
      {
        id: 'aaaa6666-1111-4111-8111-111111111111',
        username: 'officer_hamza',
        email: 'officer_hamza@demo.awaaz.local',
        password: 'officer123',
        display_name: 'Officer Hamza (Relief Assistance)',
        role: 'officer',
        deptId: deptA.id,
        lang: 'en',
      },
      {
        id: 'aaaa6667-1111-4111-8111-111111111111',
        username: 'officer_sana',
        email: 'officer_sana@demo.awaaz.local',
        password: 'officer123',
        display_name: 'Officer Sana (Scam & Cyber Safety)',
        role: 'officer',
        deptId: deptScam.id,
        lang: 'en',
      },
      {
        id: 'aaaa7777-1111-4111-8111-111111111111',
        username: 'auditor_bilal',
        email: 'auditor_bilal@demo.awaaz.local',
        password: 'auditor123',
        display_name: 'Auditor Bilal (Audit Inspector)',
        role: 'admin',
        deptId: deptA.id,
        lang: 'en',
      },
      {
        id: 'aaaa8888-1111-4111-8111-111111111111',
        username: 'citizen_zainab',
        email: 'citizen_zainab@demo.awaaz.local',
        password: 'citizen123',
        pin: '1234',
        phone: '+923001112233',
        cnic: '42101-1234567-2',
        display_name: 'Zainab Bibi',
        role: 'citizen',
        deptId: null,
        lang: 'ur',
      },
      {
        id: 'aaaa9999-1111-4111-8111-111111111111',
        username: 'helper_salma',
        email: 'helper_salma@demo.awaaz.local',
        password: 'helper123',
        display_name: 'Helper Salma (Community Helper)',
        role: 'helper',
        deptId: null,
        lang: 'ur',
      },
    ];

    for (const p of personaUsers) {
      this.profiles.set(p.id, {
        id: p.id,
        email: p.email,
        display_name: p.display_name,
        phone_number: p.phone ?? null,
        phone_verified_at: p.phone ? ts : null,
        role: p.role,
        default_organization_id: orgA.id,
        department_id: p.deptId,
        preferred_language: p.lang,
        created_at: ts,
        updated_at: ts,
      });
      const passHash = hashPassword(p.password);
      this.localCredentials.set(p.email.toLowerCase(), {
        user_id: p.id,
        email: p.email.toLowerCase(),
        password_hash: passHash,
      });
      this.localCredentials.set(p.username.toLowerCase(), {
        user_id: p.id,
        email: p.email.toLowerCase(),
        password_hash: passHash,
      });
      if (p.pin && p.cnic) {
        const pinHash = hashPassword(p.pin);
        this.localCredentials.set(`pin:${p.cnic.toLowerCase()}`, {
          user_id: p.id,
          email: p.email.toLowerCase(),
          password_hash: pinHash,
        });
        if (p.phone) {
          this.localCredentials.set(`pin:${p.phone.toLowerCase()}`, {
            user_id: p.id,
            email: p.email.toLowerCase(),
            password_hash: pinHash,
          });
        }
        this.localCredentials.set(`pin:${p.username.toLowerCase()}`, {
          user_id: p.id,
          email: p.email.toLowerCase(),
          password_hash: pinHash,
        });
      }
      const memId = crypto.randomUUID();
      this.memberships.set(memId, {
        id: memId,
        organization_id: orgA.id,
        user_id: p.id,
        role: p.role,
        department_id: p.deptId,
        created_at: ts,
      });
      if (p.role === 'citizen' && p.cnic) {
        const cid = 'cccc3333-1111-4111-8111-111111111111';
        this.citizens.set(cid, {
          id: cid,
          organization_id: orgA.id,
          user_id: p.id,
          display_name: p.display_name,
          mock_identity_reference: p.cnic,
          created_at: ts,
        });
      }
    }

    // Seed rules, mock identities, and synthetic policies for both tenants
    for (const org of [orgA, orgB]) {
      const ruleId = crypto.randomUUID();
      const versionId = crypto.randomUUID();
      const publisherId = org.id === orgA.id ? DEFAULT_USER_IDS.ADMIN_A : DEFAULT_USER_IDS.OFFICER_B;

      this.ruleVersions.set(versionId, {
        id: versionId,
        organization_id: org.id,
        rule_id: ruleId,
        scheme_id: 'MOCK_RELIEF_01',
        version_number: 1,
        rules_json: structuredClone(DEFAULT_RULE_DEFINITION),
        published_by: publisherId,
        published_at: ts,
      });

      this.rules.set(ruleId, {
        id: ruleId,
        organization_id: org.id,
        scheme_id: 'MOCK_RELIEF_01',
        active_version_id: versionId,
        created_at: ts,
        updated_at: ts,
      });

      for (const ident of SYNTHETIC_MOCK_IDENTITIES) {
        const id = crypto.randomUUID();
        this.mockIdentities.set(id, {
          id,
          organization_id: org.id,
          ...ident,
          created_at: ts,
        });
      }

      for (const pol of SYNTHETIC_POLICIES) {
        const policyId = crypto.randomUUID();
        const policyRec: PolicyRecord = {
          id: policyId,
          organization_id: org.id,
          title: pol.title,
          document_type: pol.document_type,
          version: pol.version,
          effective_date: pol.effective_date,
          language: pol.language,
          source_reference: pol.source_reference,
          storage_path: `synthetic/policies/${pol.source_reference}.md`,
          content: pol.content,
          content_hash: sha256Hex(pol.content),
          created_at: ts,
        };
        this.policies.set(policyId, policyRec);

        const sections = pol.content.split('\n\n').filter((s) => s.trim().length > 0);
        sections.forEach((sectionText, idx) => {
          const chunkId = crypto.randomUUID();
          const sectionTitle = sectionText.split(':')[0] ?? `Section ${idx + 1}`;
          this.policyChunks.set(chunkId, {
            id: chunkId,
            organization_id: org.id,
            policy_id: policyId,
            chunk_text: sectionText.trim(),
            embedding: null,
            metadata: {
              title: pol.title,
              version: pol.version,
              section: sectionTitle,
              source_reference: pol.source_reference,
              language: pol.language,
            },
            created_at: ts,
          });
        });
      }
    }
  }

  // --- Organizations & Departments ---
  async createOrganization(input: { name: string; slug: string }): Promise<Organization> {
    for (const org of this.organizations.values()) {
      if (org.slug === input.slug) {
        throw new AppError(409, 'ORG_SLUG_TAKEN', `Workspace slug '${input.slug}' already exists.`);
      }
    }
    const ts = nowIso();
    const org: Organization = {
      id: crypto.randomUUID(),
      name: input.name,
      slug: input.slug,
      plan_tier: 'free',
      enabled_modules: ['relief-assistance'],
      created_at: ts,
      updated_at: ts,
    };
    this.organizations.set(org.id, org);

    // Seed default synthetic policies & mock identities for new tenant workspace
    for (const pol of SYNTHETIC_POLICIES) {
      const created = await this.createPolicy({
        organization_id: org.id,
        title: pol.title,
        document_type: pol.document_type,
        version: pol.version,
        effective_date: pol.effective_date,
        language: pol.language,
        source_reference: pol.source_reference,
        storage_path: `synthetic/policies/${pol.source_reference}.md`,
        content: pol.content,
        content_hash: sha256Hex(pol.content),
      });
      const sections = pol.content.split('\n\n').filter((s) => s.trim().length > 0);
      await this.replacePolicyChunks(
        org.id,
        created.id,
        sections.map((sectionText, idx) => ({
          chunk_text: sectionText.trim(),
          embedding: null,
          metadata: {
            title: pol.title,
            version: pol.version,
            section: sectionText.split(':')[0] ?? `Section ${idx + 1}`,
            source_reference: pol.source_reference,
            language: pol.language,
          },
        })),
      );
    }
    for (const ident of SYNTHETIC_MOCK_IDENTITIES) {
      await this.upsertMockIdentityRecord({
        organization_id: org.id,
        ...ident,
      });
    }

    // Seed default synthetic eligibility rule v1 for the new tenant workspace
    const rule = await this.createRule(org.id, 'MOCK_RELIEF_01');
    const ruleVer = await this.createRuleVersion({
      organization_id: org.id,
      rule_id: rule.id,
      scheme_id: 'MOCK_RELIEF_01',
      version_number: 1,
      rules_json: structuredClone(DEFAULT_RULE_DEFINITION),
      published_by: DEFAULT_USER_IDS.ADMIN_A,
    });
    await this.setRuleActiveVersion(org.id, rule.id, ruleVer.id);
    return org;
  }

  async getOrganizationById(organizationId: string): Promise<Organization | null> {
    return this.organizations.get(organizationId) ?? null;
  }

  async updateOrganization(
    organizationId: string,
    patch: { name?: string; slug?: string },
  ): Promise<Organization> {
    const existing = this.organizations.get(organizationId);
    if (!existing) throw new AppError(404, 'ORG_NOT_FOUND', 'Workspace not found.');
    if (patch.slug && patch.slug !== existing.slug) {
      for (const org of this.organizations.values()) {
        if (org.id !== organizationId && org.slug === patch.slug) {
          throw new AppError(409, 'ORG_SLUG_TAKEN', `Workspace slug '${patch.slug}' already exists.`);
        }
      }
    }
    const updated: Organization = {
      ...existing,
      name: patch.name?.trim() || existing.name,
      slug: patch.slug?.trim() || existing.slug,
      updated_at: nowIso(),
    };
    this.organizations.set(organizationId, updated);
    return updated;
  }

  async deleteOrganization(organizationId: string): Promise<void> {
    if (!this.organizations.has(organizationId)) {
      throw new AppError(404, 'ORG_NOT_FOUND', 'Workspace not found.');
    }
    this.organizations.delete(organizationId);

    const deleteByOrg = <T extends { organization_id: string }>(map: Map<string, T>) => {
      for (const [k, v] of map.entries()) {
        if (v.organization_id === organizationId) map.delete(k);
      }
    };

    deleteByOrg(this.departments);
    deleteByOrg(this.memberships);
    deleteByOrg(this.citizens);
    deleteByOrg(this.cases);
    deleteByOrg(this.caseAnswers);
    deleteByOrg(this.documents);
    deleteByOrg(this.rules);
    deleteByOrg(this.ruleVersions);
    deleteByOrg(this.policies);
    deleteByOrg(this.policyChunks);
    deleteByOrg(this.consents);
    deleteByOrg(this.aiRuns);
    deleteByOrg(this.caseReviews);
    deleteByOrg(this.mockIdentities);
    deleteByOrg(this.mockPayments);
    deleteByOrg(this.notifications);
    deleteByOrg(this.assistanceRequests);
    deleteByOrg(this.humanizedGuidance);

    // Clear default_organization_id on affected profiles so they fall back cleanly to any remaining membership
    for (const [uid, prof] of this.profiles.entries()) {
      if (prof.default_organization_id === organizationId) {
        this.profiles.set(uid, { ...prof, default_organization_id: null, updated_at: nowIso() });
      }
    }
  }

  async listOrganizationsForUser(userId: string): Promise<Array<Organization & { role: UserRole; department_id: string | null }>> {
    const results: Array<Organization & { role: UserRole; department_id: string | null }> = [];
    for (const m of this.memberships.values()) {
      if (m.user_id === userId) {
        const org = this.organizations.get(m.organization_id);
        if (org) {
          results.push({ ...org, role: m.role, department_id: m.department_id });
        }
      }
    }
    return results;
  }

  async listDepartments(organizationId: string): Promise<Department[]> {
    return Array.from(this.departments.values()).filter((d) => d.organization_id === organizationId);
  }

  async createDepartment(organizationId: string, input: { name: string; code: string }): Promise<Department> {
    const dept: Department = {
      id: crypto.randomUUID(),
      organization_id: organizationId,
      name: input.name,
      code: input.code,
      created_at: nowIso(),
    };
    this.departments.set(dept.id, dept);
    return dept;
  }

  // --- Profiles & Memberships ---
  async getProfileById(userId: string): Promise<UserProfile | null> {
    return this.profiles.get(userId) ?? null;
  }

  async getProfileByEmail(email: string): Promise<UserProfile | null> {
    const norm = email.toLowerCase();
    for (const p of this.profiles.values()) {
      if (p.email.toLowerCase() === norm) return p;
    }
    return null;
  }

  async getProfileByPhone(phoneNumber: string): Promise<UserProfile | null> {
    const norm = phoneNumber.trim();
    for (const p of this.profiles.values()) {
      if (p.phone_number && p.phone_number === norm) return p;
    }
    return null;
  }

  async createProfile(input: {
    id: string;
    email: string;
    display_name: string;
    phone_number?: string | null;
    phone_verified_at?: string | null;
    role: UserRole;
    default_organization_id: string | null;
    department_id?: string | null;
    preferred_language?: LanguageCode;
  }): Promise<UserProfile> {
    const ts = nowIso();
    const profile: UserProfile = {
      id: input.id,
      email: input.email.toLowerCase(),
      display_name: input.display_name,
      phone_number: input.phone_number ?? null,
      phone_verified_at: input.phone_verified_at ?? null,
      role: input.role,
      default_organization_id: input.default_organization_id,
      department_id: input.department_id ?? null,
      preferred_language: input.preferred_language ?? 'en',
      created_at: ts,
      updated_at: ts,
    };
    this.profiles.set(profile.id, profile);
    return profile;
  }

  async updateProfile(
    userId: string,
    patch: Partial<
      Pick<
        UserProfile,
        'display_name' | 'preferred_language' | 'default_organization_id' | 'phone_number' | 'phone_verified_at'
      >
    >,
  ): Promise<UserProfile> {
    const existing = this.profiles.get(userId);
    if (!existing) throw new AppError(404, 'PROFILE_NOT_FOUND', 'User profile not found.');
    const updated: UserProfile = {
      ...existing,
      ...patch,
      updated_at: nowIso(),
    };
    this.profiles.set(userId, updated);
    return updated;
  }

  async createPhoneOtpChallenge(
    input: Omit<PhoneOtpChallengeRecord, 'id' | 'attempts' | 'consumed_at' | 'created_at'>,
  ): Promise<PhoneOtpChallengeRecord> {
    const record: PhoneOtpChallengeRecord = {
      id: crypto.randomUUID(),
      ...input,
      attempts: 0,
      consumed_at: null,
      created_at: nowIso(),
    };
    this.phoneOtpChallenges.set(record.id, record);
    return record;
  }

  async getPhoneOtpChallengeById(challengeId: string): Promise<PhoneOtpChallengeRecord | null> {
    return this.phoneOtpChallenges.get(challengeId) ?? null;
  }

  async incrementPhoneOtpAttempts(challengeId: string): Promise<PhoneOtpChallengeRecord> {
    const existing = this.phoneOtpChallenges.get(challengeId);
    if (!existing) throw new AppError(404, 'OTP_NOT_FOUND', 'Verification challenge not found.');
    const updated: PhoneOtpChallengeRecord = { ...existing, attempts: existing.attempts + 1 };
    this.phoneOtpChallenges.set(challengeId, updated);
    return updated;
  }

  async markPhoneOtpConsumed(challengeId: string): Promise<void> {
    const existing = this.phoneOtpChallenges.get(challengeId);
    if (existing) {
      this.phoneOtpChallenges.set(challengeId, { ...existing, consumed_at: nowIso() });
    }
  }

  async getMembership(organizationId: string, userId: string): Promise<OrganizationMembership | null> {
    for (const m of this.memberships.values()) {
      if (m.organization_id === organizationId && m.user_id === userId) return m;
    }
    return null;
  }

  async upsertMembership(input: {
    organization_id: string;
    user_id: string;
    role: UserRole;
    department_id?: string | null;
  }): Promise<OrganizationMembership> {
    const existing = await this.getMembership(input.organization_id, input.user_id);
    if (existing) {
      const updated: OrganizationMembership = {
        ...existing,
        role: input.role,
        department_id: input.department_id ?? existing.department_id,
      };
      this.memberships.set(existing.id, updated);
      return updated;
    }
    const created: OrganizationMembership = {
      id: crypto.randomUUID(),
      organization_id: input.organization_id,
      user_id: input.user_id,
      role: input.role,
      department_id: input.department_id ?? null,
      created_at: nowIso(),
    };
    this.memberships.set(created.id, created);
    return created;
  }

  async removeMembership(organizationId: string, userId: string): Promise<boolean> {
    for (const [id, m] of this.memberships.entries()) {
      if (m.organization_id === organizationId && m.user_id === userId) {
        this.memberships.delete(id);
        const prof = this.profiles.get(userId);
        if (prof && prof.default_organization_id === organizationId) {
          this.profiles.set(userId, { ...prof, default_organization_id: null, updated_at: nowIso() });
        }
        return true;
      }
    }
    return false;
  }

  async listOrganizationMembers(
    organizationId: string,
  ): Promise<Array<{ profile: UserProfile; membership: OrganizationMembership }>> {
    const results: Array<{ profile: UserProfile; membership: OrganizationMembership }> = [];
    for (const m of this.memberships.values()) {
      if (m.organization_id === organizationId) {
        const profile = this.profiles.get(m.user_id);
        if (profile) results.push({ profile, membership: m });
      }
    }
    return results;
  }

  async saveLocalCredential(cred: StoredLocalUserCredential): Promise<void> {
    this.localCredentials.set(cred.email.toLowerCase(), {
      ...cred,
      email: cred.email.toLowerCase(),
    });
  }

  async getLocalCredentialByEmail(email: string): Promise<StoredLocalUserCredential | null> {
    return this.localCredentials.get(email.toLowerCase()) ?? null;
  }

  // --- Citizens ---
  async getCitizenById(organizationId: string, citizenId: string): Promise<CitizenRecord | null> {
    const c = this.citizens.get(citizenId);
    return c && c.organization_id === organizationId ? c : null;
  }

  async getCitizenByUserId(organizationId: string, userId: string): Promise<CitizenRecord | null> {
    for (const c of this.citizens.values()) {
      if (c.organization_id === organizationId && c.user_id === userId) return c;
    }
    return null;
  }

  async findCitizensByMockIdentity(organizationId: string, mockIdentityReference: string): Promise<CitizenRecord[]> {
    const norm = mockIdentityReference.trim().toUpperCase();
    return Array.from(this.citizens.values()).filter(
      (c) => c.organization_id === organizationId && c.mock_identity_reference.toUpperCase() === norm,
    );
  }

  async createCitizen(input: {
    organization_id: string;
    user_id: string | null;
    display_name: string;
    mock_identity_reference: string;
  }): Promise<CitizenRecord> {
    const rec: CitizenRecord = {
      id: crypto.randomUUID(),
      organization_id: input.organization_id,
      user_id: input.user_id,
      display_name: input.display_name,
      mock_identity_reference: input.mock_identity_reference,
      created_at: nowIso(),
    };
    this.citizens.set(rec.id, rec);
    return rec;
  }

  async listCitizens(organizationId: string): Promise<CitizenRecord[]> {
    return Array.from(this.citizens.values()).filter((c) => c.organization_id === organizationId);
  }

  // --- Cases & Answers ---
  async getCaseById(organizationId: string, caseId: string): Promise<CaseRecord | null> {
    const c = this.cases.get(caseId);
    return c && c.organization_id === organizationId ? c : null;
  }

  async getCaseByIdempotencyKey(organizationId: string, idempotencyKey: string): Promise<CaseRecord | null> {
    for (const c of this.cases.values()) {
      if (c.organization_id === organizationId && c.idempotency_key === idempotencyKey) return c;
    }
    return null;
  }

  async listCases(
    organizationId: string,
    filters?: { citizenId?: string; status?: string; search?: string },
  ): Promise<CaseRecord[]> {
    let items = Array.from(this.cases.values()).filter((c) => c.organization_id === organizationId);
    if (filters?.citizenId) {
      items = items.filter((c) => c.citizen_id === filters.citizenId);
    }
    if (filters?.status) {
      items = items.filter((c) => c.status === filters.status);
    }
    if (filters?.search) {
      const q = filters.search.toLowerCase();
      items = items.filter((c) => {
        const citizen = this.citizens.get(c.citizen_id);
        return (
          c.id.toLowerCase().includes(q) ||
          c.scheme_id.toLowerCase().includes(q) ||
          (citizen?.display_name.toLowerCase().includes(q) ?? false) ||
          (citizen?.mock_identity_reference.toLowerCase().includes(q) ?? false)
        );
      });
    }
    return items.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  async createCase(input: Omit<CaseRecord, 'id' | 'created_at' | 'updated_at'>): Promise<CaseRecord> {
    const ts = nowIso();
    const rec: CaseRecord = {
      ...input,
      id: crypto.randomUUID(),
      created_at: ts,
      updated_at: ts,
    };
    this.cases.set(rec.id, rec);
    return rec;
  }

  async updateCase(organizationId: string, caseId: string, patch: Partial<CaseRecord>): Promise<CaseRecord> {
    const existing = await this.getCaseById(organizationId, caseId);
    if (!existing) throw new AppError(404, 'CASE_NOT_FOUND', 'Case not found in active workspace.');
    const updated: CaseRecord = {
      ...existing,
      ...patch,
      id: existing.id,
      organization_id: existing.organization_id,
      updated_at: nowIso(),
    };
    this.cases.set(caseId, updated);
    return updated;
  }

  async listCaseAnswers(organizationId: string, caseId: string): Promise<CaseAnswerRecord[]> {
    return Array.from(this.caseAnswers.values()).filter(
      (a) => a.organization_id === organizationId && a.case_id === caseId,
    );
  }

  async upsertCaseAnswer(
    organizationId: string,
    caseId: string,
    answer: Omit<CaseAnswerRecord, 'id' | 'organization_id' | 'case_id' | 'created_at' | 'updated_at'>,
  ): Promise<CaseAnswerRecord> {
    const ts = nowIso();
    for (const existing of this.caseAnswers.values()) {
      if (
        existing.organization_id === organizationId &&
        existing.case_id === caseId &&
        existing.field_name === answer.field_name
      ) {
        const updated: CaseAnswerRecord = {
          ...existing,
          ...answer,
          updated_at: ts,
        };
        this.caseAnswers.set(existing.id, updated);
        return updated;
      }
    }
    const created: CaseAnswerRecord = {
      id: crypto.randomUUID(),
      organization_id: organizationId,
      case_id: caseId,
      ...answer,
      created_at: ts,
      updated_at: ts,
    };
    this.caseAnswers.set(created.id, created);
    return created;
  }

  // --- Documents ---
  async createDocument(input: Omit<DocumentRecord, 'id' | 'created_at'>): Promise<DocumentRecord> {
    const rec: DocumentRecord = {
      ...input,
      id: crypto.randomUUID(),
      created_at: nowIso(),
    };
    this.documents.set(rec.id, rec);
    return rec;
  }

  async getDocumentById(organizationId: string, documentId: string): Promise<DocumentRecord | null> {
    const doc = this.documents.get(documentId);
    return doc && doc.organization_id === organizationId ? doc : null;
  }

  async listCaseDocuments(organizationId: string, caseId: string): Promise<DocumentRecord[]> {
    return Array.from(this.documents.values())
      .filter((d) => d.organization_id === organizationId && d.case_id === caseId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async updateDocument(
    organizationId: string,
    documentId: string,
    patch: Partial<DocumentRecord>,
  ): Promise<DocumentRecord> {
    const existing = await this.getDocumentById(organizationId, documentId);
    if (!existing) throw new AppError(404, 'DOCUMENT_NOT_FOUND', 'Document not found.');
    const updated: DocumentRecord = {
      ...existing,
      ...patch,
      id: existing.id,
      organization_id: existing.organization_id,
    };
    this.documents.set(documentId, updated);
    return updated;
  }

  // --- Eligibility Rules & Versions ---
  async getRuleByScheme(organizationId: string, schemeId: string): Promise<EligibilityRuleRecord | null> {
    for (const r of this.rules.values()) {
      if (r.organization_id === organizationId && r.scheme_id === schemeId) return r;
    }
    return null;
  }

  async getRuleById(organizationId: string, ruleId: string): Promise<EligibilityRuleRecord | null> {
    const r = this.rules.get(ruleId);
    return r && r.organization_id === organizationId ? r : null;
  }

  async listRules(organizationId: string): Promise<EligibilityRuleRecord[]> {
    return Array.from(this.rules.values()).filter((r) => r.organization_id === organizationId);
  }

  async createRule(organizationId: string, schemeId: string): Promise<EligibilityRuleRecord> {
    const ts = nowIso();
    const rec: EligibilityRuleRecord = {
      id: crypto.randomUUID(),
      organization_id: organizationId,
      scheme_id: schemeId,
      active_version_id: null,
      created_at: ts,
      updated_at: ts,
    };
    this.rules.set(rec.id, rec);
    return rec;
  }

  async setRuleActiveVersion(
    organizationId: string,
    ruleId: string,
    versionId: string,
  ): Promise<EligibilityRuleRecord> {
    const existing = await this.getRuleById(organizationId, ruleId);
    if (!existing) throw new AppError(404, 'RULE_NOT_FOUND', 'Eligibility rule not found.');
    const updated: EligibilityRuleRecord = {
      ...existing,
      active_version_id: versionId,
      updated_at: nowIso(),
    };
    this.rules.set(ruleId, updated);
    return updated;
  }

  async createRuleVersion(input: {
    organization_id: string;
    rule_id: string;
    scheme_id: string;
    version_number: number;
    rules_json: EligibilityRuleDefinition;
    published_by: string;
  }): Promise<RuleVersionRecord> {
    const rec: RuleVersionRecord = {
      id: crypto.randomUUID(),
      organization_id: input.organization_id,
      rule_id: input.rule_id,
      scheme_id: input.scheme_id,
      version_number: input.version_number,
      rules_json: structuredClone(input.rules_json),
      published_by: input.published_by,
      published_at: nowIso(),
    };
    this.ruleVersions.set(rec.id, rec);
    return rec;
  }

  async getRuleVersionById(organizationId: string, versionId: string): Promise<RuleVersionRecord | null> {
    const rv = this.ruleVersions.get(versionId);
    return rv && rv.organization_id === organizationId ? rv : null;
  }

  async listRuleVersions(organizationId: string, ruleId?: string): Promise<RuleVersionRecord[]> {
    return Array.from(this.ruleVersions.values())
      .filter((rv) => rv.organization_id === organizationId && (!ruleId || rv.rule_id === ruleId))
      .sort((a, b) => b.version_number - a.version_number);
  }

  // --- Policies & Chunks ---
  async listPolicies(organizationId: string): Promise<PolicyRecord[]> {
    return Array.from(this.policies.values()).filter((p) => p.organization_id === organizationId);
  }

  async getPolicyById(organizationId: string, policyId: string): Promise<PolicyRecord | null> {
    const p = this.policies.get(policyId);
    return p && p.organization_id === organizationId ? p : null;
  }

  async createPolicy(input: Omit<PolicyRecord, 'id' | 'created_at'>): Promise<PolicyRecord> {
    const rec: PolicyRecord = {
      ...input,
      id: crypto.randomUUID(),
      created_at: nowIso(),
    };
    this.policies.set(rec.id, rec);
    return rec;
  }

  async replacePolicyChunks(
    organizationId: string,
    policyId: string,
    chunks: Array<Omit<PolicyChunkRecord, 'id' | 'organization_id' | 'policy_id' | 'created_at'>>,
  ): Promise<PolicyChunkRecord[]> {
    for (const [id, existing] of this.policyChunks.entries()) {
      if (existing.organization_id === organizationId && existing.policy_id === policyId) {
        this.policyChunks.delete(id);
      }
    }
    const ts = nowIso();
    const created: PolicyChunkRecord[] = chunks.map((chunk) => {
      const rec: PolicyChunkRecord = {
        id: crypto.randomUUID(),
        organization_id: organizationId,
        policy_id: policyId,
        chunk_text: chunk.chunk_text,
        embedding: chunk.embedding,
        metadata: chunk.metadata,
        created_at: ts,
      };
      this.policyChunks.set(rec.id, rec);
      return rec;
    });
    return created;
  }

  async listPolicyChunks(organizationId: string, language?: LanguageCode): Promise<PolicyChunkRecord[]> {
    return Array.from(this.policyChunks.values()).filter(
      (c) =>
        c.organization_id === organizationId &&
        (!language || c.metadata.language === language),
    );
  }

  async searchPolicyChunksByEmbedding(
    organizationId: string,
    embedding: number[],
    topK: number,
    language?: LanguageCode,
  ): Promise<Array<PolicyChunkRecord & { similarity: number }>> {
    const chunks = await this.listPolicyChunks(organizationId, language);
    return chunks
      .filter((c) => Array.isArray(c.embedding) && c.embedding.length === embedding.length)
      .map((c) => ({
        ...c,
        similarity: cosineSimilarity(embedding, c.embedding ?? []),
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);
  }

  // --- Consents ---
  async createConsent(input: Omit<ConsentRecord, 'id' | 'granted_at' | 'withdrawn_at'>): Promise<ConsentRecord> {
    const rec: ConsentRecord = {
      ...input,
      id: crypto.randomUUID(),
      granted_at: nowIso(),
      withdrawn_at: null,
    };
    this.consents.set(rec.id, rec);
    return rec;
  }

  async getConsentById(organizationId: string, consentId: string): Promise<ConsentRecord | null> {
    const c = this.consents.get(consentId);
    return c && c.organization_id === organizationId ? c : null;
  }

  async listConsents(
    organizationId: string,
    filters?: { citizenId?: string; helperId?: string; caseId?: string; activeOnly?: boolean },
  ): Promise<ConsentRecord[]> {
    const now = Date.now();
    return Array.from(this.consents.values())
      .filter((c) => {
        if (c.organization_id !== organizationId) return false;
        if (filters?.citizenId && c.citizen_id !== filters.citizenId) return false;
        if (filters?.helperId && c.helper_id !== filters.helperId) return false;
        if (filters?.caseId && c.case_id !== null && c.case_id !== filters.caseId) return false;
        if (filters?.activeOnly) {
          if (c.withdrawn_at !== null) return false;
          if (c.expires_at && new Date(c.expires_at).getTime() <= now) return false;
        }
        return true;
      })
      .sort((a, b) => b.granted_at.localeCompare(a.granted_at));
  }

  async withdrawConsent(organizationId: string, consentId: string): Promise<ConsentRecord> {
    const existing = await this.getConsentById(organizationId, consentId);
    if (!existing) throw new AppError(404, 'CONSENT_NOT_FOUND', 'Consent record not found.');
    const updated: ConsentRecord = {
      ...existing,
      withdrawn_at: existing.withdrawn_at ?? nowIso(),
    };
    this.consents.set(consentId, updated);
    return updated;
  }

  // --- AI Runs, Reviews, Mock Identity, Mock Payments ---
  async createAiRun(input: Omit<AiRunRecord, 'id' | 'created_at'>): Promise<AiRunRecord> {
    const rec: AiRunRecord = {
      ...input,
      id: crypto.randomUUID(),
      created_at: nowIso(),
    };
    this.aiRuns.set(rec.id, rec);
    return rec;
  }

  async listAiRuns(organizationId: string, caseId?: string): Promise<AiRunRecord[]> {
    return Array.from(this.aiRuns.values())
      .filter((r) => r.organization_id === organizationId && (!caseId || r.case_id === caseId))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async createCaseReview(input: Omit<CaseReviewRecord, 'id' | 'created_at'>): Promise<CaseReviewRecord> {
    const rec: CaseReviewRecord = {
      ...input,
      id: crypto.randomUUID(),
      created_at: nowIso(),
    };
    this.caseReviews.set(rec.id, rec);
    return rec;
  }

  async listCaseReviews(organizationId: string, caseId: string): Promise<CaseReviewRecord[]> {
    return Array.from(this.caseReviews.values())
      .filter((r) => r.organization_id === organizationId && r.case_id === caseId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async findMockIdentityRecord(
    organizationId: string,
    mockIdentityReference: string,
  ): Promise<MockIdentityRecord | null> {
    const norm = mockIdentityReference.trim().toUpperCase();
    for (const r of this.mockIdentities.values()) {
      if (r.organization_id === organizationId && r.mock_identity_reference.toUpperCase() === norm) {
        return r;
      }
    }
    return null;
  }

  async upsertMockIdentityRecord(input: Omit<MockIdentityRecord, 'id' | 'created_at'>): Promise<MockIdentityRecord> {
    const existing = await this.findMockIdentityRecord(input.organization_id, input.mock_identity_reference);
    if (existing) {
      const updated = { ...existing, ...input };
      this.mockIdentities.set(existing.id, updated);
      return updated;
    }
    const created: MockIdentityRecord = {
      ...input,
      id: crypto.randomUUID(),
      created_at: nowIso(),
    };
    this.mockIdentities.set(created.id, created);
    return created;
  }

  async createMockPayment(
    input: Omit<MockPaymentRecord, 'id' | 'created_at' | 'completed_at'>,
  ): Promise<MockPaymentRecord> {
    const rec: MockPaymentRecord = {
      ...input,
      id: crypto.randomUUID(),
      created_at: nowIso(),
      completed_at: null,
    };
    this.mockPayments.set(rec.id, rec);
    return rec;
  }

  async getMockPaymentById(organizationId: string, paymentId: string): Promise<MockPaymentRecord | null> {
    const p = this.mockPayments.get(paymentId);
    return p && p.organization_id === organizationId ? p : null;
  }

  async listCaseMockPayments(organizationId: string, caseId: string): Promise<MockPaymentRecord[]> {
    return Array.from(this.mockPayments.values())
      .filter((p) => p.organization_id === organizationId && p.case_id === caseId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async updateMockPayment(
    organizationId: string,
    paymentId: string,
    patch: Partial<Pick<MockPaymentRecord, 'status' | 'completed_at'>>,
  ): Promise<MockPaymentRecord> {
    const existing = await this.getMockPaymentById(organizationId, paymentId);
    if (!existing) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Mock payment record not found.');
    const updated: MockPaymentRecord = { ...existing, ...patch };
    this.mockPayments.set(paymentId, updated);
    return updated;
  }

  // --- Append-only Audit Logs & Notifications ---
  async appendAuditLog(input: Omit<AuditLogEntry, 'id' | 'created_at'>): Promise<AuditLogEntry> {
    const entry: AuditLogEntry = Object.freeze({
      ...input,
      id: crypto.randomUUID(),
      created_at: nowIso(),
    });
    this.auditLogs.push(entry);
    return entry;
  }

  async listAuditLogs(
    organizationId: string,
    filters?: { resourceType?: string; resourceId?: string; limit?: number },
  ): Promise<AuditLogEntry[]> {
    let items = this.auditLogs.filter((l) => l.organization_id === organizationId);
    if (filters?.resourceType) items = items.filter((l) => l.resource_type === filters.resourceType);
    if (filters?.resourceId) items = items.filter((l) => l.resource_id === filters.resourceId);
    const sorted = [...items].sort((a, b) => b.created_at.localeCompare(a.created_at));
    return filters?.limit ? sorted.slice(0, filters.limit) : sorted;
  }

  async createNotification(
    input: Omit<NotificationItem, 'id' | 'read_at' | 'created_at'>,
  ): Promise<NotificationItem> {
    const item: NotificationItem = {
      ...input,
      id: crypto.randomUUID(),
      read_at: null,
      created_at: nowIso(),
    };
    this.notifications.set(item.id, item);
    return item;
  }

  async listNotifications(organizationId: string, userId: string): Promise<NotificationItem[]> {
    return Array.from(this.notifications.values())
      .filter((n) => n.organization_id === organizationId && n.user_id === userId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async markNotificationRead(
    organizationId: string,
    userId: string,
    notificationId: string,
  ): Promise<NotificationItem | null> {
    const existing = this.notifications.get(notificationId);
    if (!existing || existing.organization_id !== organizationId || existing.user_id !== userId) {
      return null;
    }
    const updated: NotificationItem = { ...existing, read_at: existing.read_at ?? nowIso() };
    this.notifications.set(notificationId, updated);
    return updated;
  }

  // --- Department Humanized Chatbot Assistance & Guidance ---
  async createAssistanceRequest(
    input: Omit<
      AssistanceRequestRecord,
      'id' | 'status' | 'responder_user_id' | 'humanized_reply' | 'saved_as_guidance' | 'created_at' | 'answered_at'
    >,
  ): Promise<AssistanceRequestRecord> {
    const citizenProfile = this.profiles.get(input.citizen_user_id);
    const rec: AssistanceRequestRecord = {
      ...input,
      id: crypto.randomUUID(),
      citizen_display_name: input.citizen_display_name ?? citizenProfile?.display_name ?? 'Citizen',
      status: 'OPEN',
      responder_user_id: null,
      responder_display_name: null,
      humanized_reply: null,
      saved_as_guidance: false,
      created_at: nowIso(),
      answered_at: null,
    };
    this.assistanceRequests.set(rec.id, rec);
    return rec;
  }

  async getAssistanceRequestById(
    organizationId: string,
    requestId: string,
  ): Promise<AssistanceRequestRecord | null> {
    const rec = this.assistanceRequests.get(requestId);
    return rec && rec.organization_id === organizationId ? rec : null;
  }

  async listAssistanceRequests(
    organizationId: string,
    filters?: { citizenUserId?: string; departmentId?: string | null; status?: 'OPEN' | 'ANSWERED' },
  ): Promise<AssistanceRequestRecord[]> {
    return Array.from(this.assistanceRequests.values())
      .filter((r) => {
        if (r.organization_id !== organizationId) return false;
        if (filters?.citizenUserId && r.citizen_user_id !== filters.citizenUserId) return false;
        if (filters?.status && r.status !== filters.status) return false;
        if (filters?.departmentId && r.department_id && r.department_id !== filters.departmentId) return false;
        return true;
      })
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async answerAssistanceRequest(
    organizationId: string,
    requestId: string,
    patch: { responder_user_id: string; humanized_reply: string; saved_as_guidance: boolean },
  ): Promise<AssistanceRequestRecord> {
    const existing = await this.getAssistanceRequestById(organizationId, requestId);
    if (!existing) throw new AppError(404, 'ASSISTANCE_REQUEST_NOT_FOUND', 'Assistance request not found.');
    const responder = this.profiles.get(patch.responder_user_id);
    const updated: AssistanceRequestRecord = {
      ...existing,
      status: 'ANSWERED',
      responder_user_id: patch.responder_user_id,
      responder_display_name: responder?.display_name ?? 'Department Officer',
      humanized_reply: patch.humanized_reply,
      saved_as_guidance: patch.saved_as_guidance,
      answered_at: nowIso(),
    };
    this.assistanceRequests.set(requestId, updated);
    return updated;
  }

  async createHumanizedGuidance(
    input: Omit<HumanizedGuidanceRecord, 'id' | 'created_at'>,
  ): Promise<HumanizedGuidanceRecord> {
    const rec: HumanizedGuidanceRecord = {
      ...input,
      id: crypto.randomUUID(),
      created_at: nowIso(),
    };
    this.humanizedGuidance.set(rec.id, rec);
    return rec;
  }

  async listHumanizedGuidance(
    organizationId: string,
    filters?: { serviceId?: string; language?: LanguageCode },
  ): Promise<HumanizedGuidanceRecord[]> {
    return Array.from(this.humanizedGuidance.values())
      .filter((g) => {
        if (g.organization_id !== organizationId) return false;
        if (filters?.serviceId && g.service_id !== filters.serviceId) return false;
        if (filters?.language && g.language !== filters.language) return false;
        return true;
      })
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  // --- Autonomous Agent Working Memory, Reasoning Audit Trail & Human Escalations ---
  async getAgentMemorySession(sessionId: string): Promise<AgentMemorySessionRecord | null> {
    const rec = this.agentMemorySessions.get(sessionId);
    return rec ? structuredClone(rec) : null;
  }

  async upsertAgentMemorySession(record: AgentMemorySessionRecord): Promise<AgentMemorySessionRecord> {
    const copy: AgentMemorySessionRecord = {
      ...structuredClone(record),
      updated_at: nowIso(),
    };
    this.agentMemorySessions.set(record.session_id, copy);
    return structuredClone(copy);
  }

  async appendAgentReasoningAuditLog(
    input: Omit<AgentReasoningAuditLogRecord, 'id' | 'timestamp'>,
  ): Promise<AgentReasoningAuditLogRecord> {
    const rec: AgentReasoningAuditLogRecord = {
      ...structuredClone(input),
      id: crypto.randomUUID(),
      timestamp: nowIso(),
    };
    this.agentReasoningAuditLogs.unshift(rec);
    if (this.agentReasoningAuditLogs.length > 500) {
      this.agentReasoningAuditLogs.length = 500;
    }
    return structuredClone(rec);
  }

  async listAgentReasoningAuditLogs(
    organizationId: string,
    filters?: {
      sessionId?: string;
      citizenId?: string;
      departmentId?: ServiceDepartmentCode;
      capabilityCheck?: string;
      accessDecision?: string;
      limit?: number;
    },
  ): Promise<AgentReasoningAuditLogRecord[]> {
    const filtered = this.agentReasoningAuditLogs.filter((row) => {
      if (row.organization_id !== organizationId) return false;
      if (filters?.sessionId && row.session_id !== filters.sessionId) return false;
      if (filters?.citizenId && row.citizen_id !== filters.citizenId) return false;
      if (filters?.departmentId && (row.department_id ?? 'GENERAL_INQUIRY') !== filters.departmentId) return false;
      if (filters?.capabilityCheck && row.capability_check !== filters.capabilityCheck) return false;
      if (filters?.accessDecision && row.access_control_decision.decision !== filters.accessDecision) return false;
      return true;
    });
    const limit = filters?.limit ?? 150;
    return filtered.slice(0, limit).map((r) => structuredClone(r));
  }

  async createAgentEscalation(
    input: Omit<AgentEscalationRecord, 'id' | 'ticket_reference' | 'created_at' | 'updated_at'>,
  ): Promise<AgentEscalationRecord> {
    const id = crypto.randomUUID();
    const ticketRef = `ESC-${id.slice(0, 6).toUpperCase()}`;
    const ts = nowIso();
    const rec: AgentEscalationRecord = {
      ...structuredClone(input),
      id,
      ticket_reference: ticketRef,
      created_at: ts,
      updated_at: ts,
    };
    this.agentEscalations.set(id, rec);
    return structuredClone(rec);
  }

  async listAgentEscalations(
    organizationId: string,
    filters?: { citizenId?: string; status?: 'OPEN' | 'IN_REVIEW' | 'RESOLVED' },
  ): Promise<AgentEscalationRecord[]> {
    return Array.from(this.agentEscalations.values())
      .filter((e) => {
        if (e.organization_id !== organizationId) return false;
        if (filters?.citizenId && e.citizen_id !== filters.citizenId) return false;
        if (filters?.status && e.status !== filters.status) return false;
        return true;
      })
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((e) => structuredClone(e));
  }

  async updateAgentEscalationStatus(
    organizationId: string,
    escalationId: string,
    patch: { status: 'OPEN' | 'IN_REVIEW' | 'RESOLVED'; resolution_notes?: string | null },
  ): Promise<AgentEscalationRecord> {
    const existing = this.agentEscalations.get(escalationId);
    if (!existing || existing.organization_id !== organizationId) {
      throw new AppError(404, 'ESCALATION_NOT_FOUND', 'Escalation ticket not found in workspace.');
    }
    const updated: AgentEscalationRecord = {
      ...existing,
      status: patch.status,
      resolution_notes: patch.resolution_notes !== undefined ? patch.resolution_notes : existing.resolution_notes,
      updated_at: nowIso(),
    };
    this.agentEscalations.set(escalationId, updated);
    return structuredClone(updated);
  }

  // --- Phase 4: Direct Department Officer Inquiries ---
  async createOfficerInquiry(
    input: Omit<OfficerInquiryRecord, 'id' | 'tracking_reference' | 'status' | 'officer_reply' | 'created_at' | 'replied_at'>,
  ): Promise<OfficerInquiryRecord> {
    const id = crypto.randomUUID();
    const trackingRef = `INQ-${id.slice(0, 6).toUpperCase()}`;
    const rec: OfficerInquiryRecord = {
      ...structuredClone(input),
      id,
      tracking_reference: trackingRef,
      status: 'OPEN',
      officer_reply: null,
      created_at: nowIso(),
      replied_at: null,
    };
    this.officerInquiries.set(id, rec);
    return structuredClone(rec);
  }

  async getOfficerInquiryById(organizationId: string, inquiryId: string): Promise<OfficerInquiryRecord | null> {
    const rec = this.officerInquiries.get(inquiryId);
    if (!rec || rec.organization_id !== organizationId) return null;
    return structuredClone(rec);
  }

  async listOfficerInquiries(
    organizationId: string,
    filters?: { userId?: string; citizenId?: string; departmentId?: ServiceDepartmentCode; status?: 'OPEN' | 'ANSWERED' },
  ): Promise<OfficerInquiryRecord[]> {
    return Array.from(this.officerInquiries.values())
      .filter((r) => {
        if (r.organization_id !== organizationId) return false;
        if (filters?.userId && r.user_id !== filters.userId) return false;
        if (filters?.citizenId && r.citizen_id !== filters.citizenId) return false;
        if (filters?.departmentId && (r.department_id ?? 'RELIEF_ASSISTANCE') !== filters.departmentId) return false;
        if (filters?.status && r.status !== filters.status) return false;
        return true;
      })
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((r) => structuredClone(r));
  }

  async replyOfficerInquiry(
    organizationId: string,
    inquiryId: string,
    patch: { officer_reply: string; assigned_officer_id?: string | null; assigned_officer_name?: string },
  ): Promise<OfficerInquiryRecord> {
    const existing = this.officerInquiries.get(inquiryId);
    if (!existing || existing.organization_id !== organizationId) {
      throw new AppError(404, 'OFFICER_INQUIRY_NOT_FOUND', 'Officer inquiry not found in workspace.');
    }
    const updated: OfficerInquiryRecord = {
      ...existing,
      status: 'ANSWERED',
      officer_reply: patch.officer_reply,
      assigned_officer_id: patch.assigned_officer_id ?? existing.assigned_officer_id,
      assigned_officer_name: patch.assigned_officer_name ?? existing.assigned_officer_name,
      replied_at: nowIso(),
    };
    this.officerInquiries.set(inquiryId, updated);
    return structuredClone(updated);
  }

  // --- Layer 2: Self-Learning Semantic NLU Correction RAG Memory ---
  async listAgentNluRagMemories(organizationId?: string): Promise<AgentNluRagMemoryRecord[]> {
    return Array.from(this.agentNluRagMemories.values())
      .filter((m) => m.organization_id === null || !organizationId || m.organization_id === organizationId)
      .sort((a, b) => {
        if (a.source !== b.source) {
          if (a.source === 'LEARNED_FROM_CORRECTION') return -1;
          if (b.source === 'LEARNED_FROM_CORRECTION') return 1;
        }
        return b.updated_at.localeCompare(a.updated_at);
      })
      .map((m) => structuredClone(m));
  }

  async upsertAgentNluRagMemory(
    input: Omit<AgentNluRagMemoryRecord, 'id' | 'created_at' | 'updated_at'>,
  ): Promise<AgentNluRagMemoryRecord> {
    const normalizedKey = input.raw_utterance.trim().toLowerCase().replace(/\s+/g, ' ');
    const existing = Array.from(this.agentNluRagMemories.values()).find(
      (m) =>
        m.raw_utterance.trim().toLowerCase().replace(/\s+/g, ' ') === normalizedKey &&
        m.resolved_intent === input.resolved_intent &&
        m.target_field === input.target_field,
    );
    const ts = nowIso();
    if (existing) {
      const updated: AgentNluRagMemoryRecord = {
        ...existing,
        source:
          existing.source === 'SEED_EXEMPLAR' && input.source !== 'SEED_EXEMPLAR' ? input.source : existing.source,
        clean_value: input.clean_value !== null ? input.clean_value : existing.clean_value,
        hit_count: existing.hit_count + Math.max(1, input.hit_count || 0),
        embedding: input.embedding ?? existing.embedding,
        updated_at: ts,
      };
      this.agentNluRagMemories.set(existing.id, updated);
      return structuredClone(updated);
    }

    const id = crypto.randomUUID();
    const rec: AgentNluRagMemoryRecord = {
      ...structuredClone(input),
      id,
      created_at: ts,
      updated_at: ts,
    };
    this.agentNluRagMemories.set(id, rec);
    return structuredClone(rec);
  }

  async incrementAgentNluRagHit(memoryId: string): Promise<void> {
    const rec = this.agentNluRagMemories.get(memoryId);
    if (!rec) return;
    rec.hit_count += 1;
    rec.updated_at = nowIso();
  }

  // --- Phase 3: Universal Hybrid RAG Collections (5 persistent collections) ---
  async listUniversalRagDocuments(filters?: {
    organizationId?: string;
    collections?: UniversalRagCollection[];
    sessionId?: string;
    citizenId?: string;
  }): Promise<UniversalRagDocumentRecord[]> {
    const colSet = filters?.collections ? new Set(filters.collections) : null;
    return Array.from(this.universalRagDocuments.values())
      .filter((doc) => {
        if (filters?.organizationId && doc.organization_id !== null && doc.organization_id !== filters.organizationId) {
          return false;
        }
        if (colSet && !colSet.has(doc.collection)) return false;
        if (doc.collection === 'episodic_conversation_kb') {
          if (filters?.sessionId && doc.session_id && doc.session_id !== filters.sessionId) {
            if (!filters?.citizenId || doc.citizen_id !== filters.citizenId) return false;
          }
        }
        return true;
      })
      .sort((a, b) => {
        if (a.collection === 'self_learning_corrections_kb' && b.collection !== 'self_learning_corrections_kb') return -1;
        if (b.collection === 'self_learning_corrections_kb' && a.collection !== 'self_learning_corrections_kb') return 1;
        return b.updated_at.localeCompare(a.updated_at);
      })
      .map((d) => structuredClone(d));
  }

  async upsertUniversalRagDocument(
    input: Omit<UniversalRagDocumentRecord, 'id' | 'created_at' | 'updated_at'>,
  ): Promise<UniversalRagDocumentRecord> {
    const normContent = input.content.trim().toLowerCase().replace(/\s+/g, ' ');
    const existing = Array.from(this.universalRagDocuments.values()).find(
      (d) =>
        d.collection === input.collection &&
        d.content.trim().toLowerCase().replace(/\s+/g, ' ') === normContent &&
        (d.session_id ?? null) === (input.session_id ?? null),
    );
    const ts = nowIso();
    if (existing) {
      const updated: UniversalRagDocumentRecord = {
        ...existing,
        title: input.title || existing.title,
        metadata: { ...existing.metadata, ...input.metadata },
        hit_count: existing.hit_count + Math.max(0, input.hit_count || 0),
        embedding: input.embedding ?? existing.embedding,
        updated_at: ts,
      };
      this.universalRagDocuments.set(existing.id, updated);
      return structuredClone(updated);
    }
    const id = crypto.randomUUID();
    const rec: UniversalRagDocumentRecord = {
      ...structuredClone(input),
      id,
      created_at: ts,
      updated_at: ts,
    };
    this.universalRagDocuments.set(id, rec);
    return structuredClone(rec);
  }

  async incrementUniversalRagHit(docId: string): Promise<void> {
    const rec = this.universalRagDocuments.get(docId);
    if (!rec) return;
    rec.hit_count += 1;
    rec.updated_at = nowIso();
  }
}
