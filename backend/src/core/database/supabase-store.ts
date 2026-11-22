import { createClient, type SupabaseClient } from '@supabase/supabase-js';
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
import { AppError } from '../security/errors';
import type { DataStore, PhoneOtpChallengeRecord } from './types';

function unwrap<T>(result: { data: T | null; error: { message: string } | null }, context: string): T {
  if (result.error) {
    throw new AppError(502, 'DATABASE_ERROR', `${context}: ${result.error.message}`);
  }
  if (result.data === null) {
    throw new AppError(404, 'RECORD_NOT_FOUND', `${context}: record not found.`);
  }
  return result.data;
}

/**
 * Production Supabase PostgreSQL DataStore.
 * Every tenant-scoped operation explicitly filters by organization_id in addition
 * to PostgreSQL Row Level Security policies defined in supabase/migrations/.
 */
export class SupabaseDataStore implements DataStore {
  public readonly mode = 'supabase' as const;
  private readonly client: SupabaseClient;

  constructor(supabaseUrl: string, serviceRoleKey: string) {
    this.client = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async createOrganization(input: { name: string; slug: string }): Promise<Organization> {
    const res = await this.client.from('organizations').insert(input).select('*').single();
    return unwrap(res, 'createOrganization') as Organization;
  }

  async updateOrganization(
    organizationId: string,
    patch: { name?: string; slug?: string },
  ): Promise<Organization> {
    const res = await this.client
      .from('organizations')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', organizationId)
      .select('*')
      .single();
    return unwrap(res, 'updateOrganization') as Organization;
  }

  async deleteOrganization(organizationId: string): Promise<void> {
    const res = await this.client.from('organizations').delete().eq('id', organizationId);
    if (res.error) throw new AppError(502, 'DATABASE_ERROR', `deleteOrganization: ${res.error.message}`);
  }

  async getOrganizationById(organizationId: string): Promise<Organization | null> {
    const res = await this.client.from('organizations').select('*').eq('id', organizationId).maybeSingle();
    if (res.error) throw new AppError(502, 'DATABASE_ERROR', res.error.message);
    return (res.data as Organization | null) ?? null;
  }

  async listOrganizationsForUser(userId: string): Promise<Array<Organization & { role: UserRole; department_id: string | null }>> {
    const res = await this.client
      .from('organization_memberships')
      .select('role, department_id, organizations(*)')
      .eq('user_id', userId);
    if (res.error) throw new AppError(502, 'DATABASE_ERROR', res.error.message);
    return (res.data ?? []).flatMap((row: Record<string, unknown>) => {
      const org = row.organizations as Organization | null;
      if (!org) return [];
      return [
        {
          ...org,
          role: row.role as UserRole,
          department_id: (row.department_id as string | null) ?? null,
        },
      ];
    });
  }

  async listDepartments(organizationId: string): Promise<Department[]> {
    const res = await this.client.from('departments').select('*').eq('organization_id', organizationId);
    return unwrap(res, 'listDepartments') as Department[];
  }

  async createDepartment(organizationId: string, input: { name: string; code: string }): Promise<Department> {
    const res = await this.client
      .from('departments')
      .insert({ organization_id: organizationId, ...input })
      .select('*')
      .single();
    return unwrap(res, 'createDepartment') as Department;
  }

  async getProfileById(userId: string): Promise<UserProfile | null> {
    const res = await this.client.from('profiles').select('*').eq('id', userId).maybeSingle();
    if (res.error) throw new AppError(502, 'DATABASE_ERROR', res.error.message);
    return (res.data as UserProfile | null) ?? null;
  }

  async getProfileByEmail(email: string): Promise<UserProfile | null> {
    const res = await this.client.from('profiles').select('*').eq('email', email.toLowerCase()).maybeSingle();
    if (res.error) throw new AppError(502, 'DATABASE_ERROR', res.error.message);
    return (res.data as UserProfile | null) ?? null;
  }

  async getProfileByPhone(phoneNumber: string): Promise<UserProfile | null> {
    const res = await this.client.from('profiles').select('*').eq('phone_number', phoneNumber.trim()).maybeSingle();
    if (res.error) throw new AppError(502, 'DATABASE_ERROR', res.error.message);
    return (res.data as UserProfile | null) ?? null;
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
    const res = await this.client
      .from('profiles')
      .insert({
        ...input,
        email: input.email.toLowerCase(),
        preferred_language: input.preferred_language ?? 'en',
      })
      .select('*')
      .single();
    return unwrap(res, 'createProfile') as UserProfile;
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
    const res = await this.client
      .from('profiles')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', userId)
      .select('*')
      .single();
    return unwrap(res, 'updateProfile') as UserProfile;
  }

  async createPhoneOtpChallenge(
    input: Omit<PhoneOtpChallengeRecord, 'id' | 'attempts' | 'consumed_at' | 'created_at'>,
  ): Promise<PhoneOtpChallengeRecord> {
    const res = await this.client
      .from('phone_otp_challenges')
      .insert({ ...input, attempts: 0 })
      .select('*')
      .single();
    return unwrap(res, 'createPhoneOtpChallenge') as PhoneOtpChallengeRecord;
  }

  async getPhoneOtpChallengeById(challengeId: string): Promise<PhoneOtpChallengeRecord | null> {
    const res = await this.client.from('phone_otp_challenges').select('*').eq('id', challengeId).maybeSingle();
    if (res.error) throw new AppError(502, 'DATABASE_ERROR', res.error.message);
    return (res.data as PhoneOtpChallengeRecord | null) ?? null;
  }

  async incrementPhoneOtpAttempts(challengeId: string): Promise<PhoneOtpChallengeRecord> {
    const existing = await this.getPhoneOtpChallengeById(challengeId);
    if (!existing) throw new AppError(404, 'OTP_NOT_FOUND', 'Verification challenge not found.');
    const res = await this.client
      .from('phone_otp_challenges')
      .update({ attempts: existing.attempts + 1 })
      .eq('id', challengeId)
      .select('*')
      .single();
    return unwrap(res, 'incrementPhoneOtpAttempts') as PhoneOtpChallengeRecord;
  }

  async markPhoneOtpConsumed(challengeId: string): Promise<void> {
    const res = await this.client
      .from('phone_otp_challenges')
      .update({ consumed_at: new Date().toISOString() })
      .eq('id', challengeId);
    if (res.error) throw new AppError(502, 'DATABASE_ERROR', res.error.message);
  }

  async getMembership(organizationId: string, userId: string): Promise<OrganizationMembership | null> {
    const res = await this.client
      .from('organization_memberships')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .maybeSingle();
    if (res.error) throw new AppError(502, 'DATABASE_ERROR', res.error.message);
    return (res.data as OrganizationMembership | null) ?? null;
  }

  async upsertMembership(input: {
    organization_id: string;
    user_id: string;
    role: UserRole;
    department_id?: string | null;
  }): Promise<OrganizationMembership> {
    const res = await this.client
      .from('organization_memberships')
      .upsert(input, { onConflict: 'organization_id,user_id' })
      .select('*')
      .single();
    return unwrap(res, 'upsertMembership') as OrganizationMembership;
  }

  async removeMembership(organizationId: string, userId: string): Promise<boolean> {
    const res = await this.client
      .from('organization_memberships')
      .delete()
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .select('id');
    if (res.error) throw new AppError(502, 'DATABASE_ERROR', `removeMembership: ${res.error.message}`);
    return (res.data?.length ?? 0) > 0;
  }

  async listOrganizationMembers(
    organizationId: string,
  ): Promise<Array<{ profile: UserProfile; membership: OrganizationMembership }>> {
    const res = await this.client
      .from('organization_memberships')
      .select('*, profiles(*)')
      .eq('organization_id', organizationId);
    if (res.error) throw new AppError(502, 'DATABASE_ERROR', res.error.message);
    return (res.data ?? []).flatMap((row: Record<string, unknown>) => {
      const profile = row.profiles as UserProfile | null;
      if (!profile) return [];
      const membership: OrganizationMembership = {
        id: row.id as string,
        organization_id: row.organization_id as string,
        user_id: row.user_id as string,
        role: row.role as UserRole,
        department_id: (row.department_id as string | null) ?? null,
        created_at: row.created_at as string,
      };
      return [{ profile, membership }];
    });
  }

  async getCitizenById(organizationId: string, citizenId: string): Promise<CitizenRecord | null> {
    const res = await this.client
      .from('citizens')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('id', citizenId)
      .maybeSingle();
    if (res.error) throw new AppError(502, 'DATABASE_ERROR', res.error.message);
    return (res.data as CitizenRecord | null) ?? null;
  }

  async getCitizenByUserId(organizationId: string, userId: string): Promise<CitizenRecord | null> {
    const res = await this.client
      .from('citizens')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .maybeSingle();
    if (res.error) throw new AppError(502, 'DATABASE_ERROR', res.error.message);
    return (res.data as CitizenRecord | null) ?? null;
  }

  async findCitizensByMockIdentity(organizationId: string, mockIdentityReference: string): Promise<CitizenRecord[]> {
    const res = await this.client
      .from('citizens')
      .select('*')
      .eq('organization_id', organizationId)
      .ilike('mock_identity_reference', mockIdentityReference.trim());
    return unwrap(res, 'findCitizensByMockIdentity') as CitizenRecord[];
  }

  async createCitizen(input: {
    organization_id: string;
    user_id: string | null;
    display_name: string;
    mock_identity_reference: string;
  }): Promise<CitizenRecord> {
    const res = await this.client.from('citizens').insert(input).select('*').single();
    return unwrap(res, 'createCitizen') as CitizenRecord;
  }

  async listCitizens(organizationId: string): Promise<CitizenRecord[]> {
    const res = await this.client.from('citizens').select('*').eq('organization_id', organizationId);
    return unwrap(res, 'listCitizens') as CitizenRecord[];
  }

  async getCaseById(organizationId: string, caseId: string): Promise<CaseRecord | null> {
    const res = await this.client
      .from('cases')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('id', caseId)
      .maybeSingle();
    if (res.error) throw new AppError(502, 'DATABASE_ERROR', res.error.message);
    return (res.data as CaseRecord | null) ?? null;
  }

  async getCaseByIdempotencyKey(organizationId: string, idempotencyKey: string): Promise<CaseRecord | null> {
    const res = await this.client
      .from('cases')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();
    if (res.error) throw new AppError(502, 'DATABASE_ERROR', res.error.message);
    return (res.data as CaseRecord | null) ?? null;
  }

  async listCases(
    organizationId: string,
    filters?: { citizenId?: string; status?: string; search?: string },
  ): Promise<CaseRecord[]> {
    let query = this.client
      .from('cases')
      .select('*')
      .eq('organization_id', organizationId)
      .order('updated_at', { ascending: false });
    if (filters?.citizenId) query = query.eq('citizen_id', filters.citizenId);
    if (filters?.status) query = query.eq('status', filters.status);
    const res = await query;
    const rows = unwrap(res, 'listCases') as CaseRecord[];
    if (filters?.search) {
      const q = filters.search.toLowerCase();
      return rows.filter((c) => c.id.toLowerCase().includes(q) || c.scheme_id.toLowerCase().includes(q));
    }
    return rows;
  }

  async createCase(input: Omit<CaseRecord, 'id' | 'created_at' | 'updated_at'>): Promise<CaseRecord> {
    const res = await this.client.from('cases').insert(input).select('*').single();
    return unwrap(res, 'createCase') as CaseRecord;
  }

  async updateCase(organizationId: string, caseId: string, patch: Partial<CaseRecord>): Promise<CaseRecord> {
    const res = await this.client
      .from('cases')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('organization_id', organizationId)
      .eq('id', caseId)
      .select('*')
      .single();
    return unwrap(res, 'updateCase') as CaseRecord;
  }

  async listCaseAnswers(organizationId: string, caseId: string): Promise<CaseAnswerRecord[]> {
    const res = await this.client
      .from('case_answers')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('case_id', caseId);
    return unwrap(res, 'listCaseAnswers') as CaseAnswerRecord[];
  }

  async upsertCaseAnswer(
    organizationId: string,
    caseId: string,
    answer: Omit<CaseAnswerRecord, 'id' | 'organization_id' | 'case_id' | 'created_at' | 'updated_at'>,
  ): Promise<CaseAnswerRecord> {
    const res = await this.client
      .from('case_answers')
      .upsert(
        {
          organization_id: organizationId,
          case_id: caseId,
          ...answer,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'case_id,field_name' },
      )
      .select('*')
      .single();
    return unwrap(res, 'upsertCaseAnswer') as CaseAnswerRecord;
  }

  async createDocument(input: Omit<DocumentRecord, 'id' | 'created_at'>): Promise<DocumentRecord> {
    const res = await this.client.from('documents').insert(input).select('*').single();
    return unwrap(res, 'createDocument') as DocumentRecord;
  }

  async getDocumentById(organizationId: string, documentId: string): Promise<DocumentRecord | null> {
    const res = await this.client
      .from('documents')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('id', documentId)
      .maybeSingle();
    if (res.error) throw new AppError(502, 'DATABASE_ERROR', res.error.message);
    return (res.data as DocumentRecord | null) ?? null;
  }

  async listCaseDocuments(organizationId: string, caseId: string): Promise<DocumentRecord[]> {
    const res = await this.client
      .from('documents')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('case_id', caseId)
      .order('created_at', { ascending: false });
    return unwrap(res, 'listCaseDocuments') as DocumentRecord[];
  }

  async updateDocument(
    organizationId: string,
    documentId: string,
    patch: Partial<DocumentRecord>,
  ): Promise<DocumentRecord> {
    const res = await this.client
      .from('documents')
      .update(patch)
      .eq('organization_id', organizationId)
      .eq('id', documentId)
      .select('*')
      .single();
    return unwrap(res, 'updateDocument') as DocumentRecord;
  }

  async getRuleByScheme(organizationId: string, schemeId: string): Promise<EligibilityRuleRecord | null> {
    const res = await this.client
      .from('eligibility_rules')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('scheme_id', schemeId)
      .maybeSingle();
    if (res.error) throw new AppError(502, 'DATABASE_ERROR', res.error.message);
    return (res.data as EligibilityRuleRecord | null) ?? null;
  }

  async getRuleById(organizationId: string, ruleId: string): Promise<EligibilityRuleRecord | null> {
    const res = await this.client
      .from('eligibility_rules')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('id', ruleId)
      .maybeSingle();
    if (res.error) throw new AppError(502, 'DATABASE_ERROR', res.error.message);
    return (res.data as EligibilityRuleRecord | null) ?? null;
  }

  async listRules(organizationId: string): Promise<EligibilityRuleRecord[]> {
    const res = await this.client.from('eligibility_rules').select('*').eq('organization_id', organizationId);
    return unwrap(res, 'listRules') as EligibilityRuleRecord[];
  }

  async createRule(organizationId: string, schemeId: string): Promise<EligibilityRuleRecord> {
    const res = await this.client
      .from('eligibility_rules')
      .insert({ organization_id: organizationId, scheme_id: schemeId })
      .select('*')
      .single();
    return unwrap(res, 'createRule') as EligibilityRuleRecord;
  }

  async setRuleActiveVersion(
    organizationId: string,
    ruleId: string,
    versionId: string,
  ): Promise<EligibilityRuleRecord> {
    const res = await this.client
      .from('eligibility_rules')
      .update({ active_version_id: versionId, updated_at: new Date().toISOString() })
      .eq('organization_id', organizationId)
      .eq('id', ruleId)
      .select('*')
      .single();
    return unwrap(res, 'setRuleActiveVersion') as EligibilityRuleRecord;
  }

  async createRuleVersion(input: {
    organization_id: string;
    rule_id: string;
    scheme_id: string;
    version_number: number;
    rules_json: EligibilityRuleDefinition;
    published_by: string;
  }): Promise<RuleVersionRecord> {
    const res = await this.client.from('rule_versions').insert(input).select('*').single();
    return unwrap(res, 'createRuleVersion') as RuleVersionRecord;
  }

  async getRuleVersionById(organizationId: string, versionId: string): Promise<RuleVersionRecord | null> {
    const res = await this.client
      .from('rule_versions')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('id', versionId)
      .maybeSingle();
    if (res.error) throw new AppError(502, 'DATABASE_ERROR', res.error.message);
    return (res.data as RuleVersionRecord | null) ?? null;
  }

  async listRuleVersions(organizationId: string, ruleId?: string): Promise<RuleVersionRecord[]> {
    let query = this.client
      .from('rule_versions')
      .select('*')
      .eq('organization_id', organizationId)
      .order('version_number', { ascending: false });
    if (ruleId) query = query.eq('rule_id', ruleId);
    const res = await query;
    return unwrap(res, 'listRuleVersions') as RuleVersionRecord[];
  }

  async listPolicies(organizationId: string): Promise<PolicyRecord[]> {
    const res = await this.client.from('policies').select('*').eq('organization_id', organizationId);
    return unwrap(res, 'listPolicies') as PolicyRecord[];
  }

  async getPolicyById(organizationId: string, policyId: string): Promise<PolicyRecord | null> {
    const res = await this.client
      .from('policies')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('id', policyId)
      .maybeSingle();
    if (res.error) throw new AppError(502, 'DATABASE_ERROR', res.error.message);
    return (res.data as PolicyRecord | null) ?? null;
  }

  async createPolicy(input: Omit<PolicyRecord, 'id' | 'created_at'>): Promise<PolicyRecord> {
    const res = await this.client.from('policies').insert(input).select('*').single();
    return unwrap(res, 'createPolicy') as PolicyRecord;
  }

  async replacePolicyChunks(
    organizationId: string,
    policyId: string,
    chunks: Array<Omit<PolicyChunkRecord, 'id' | 'organization_id' | 'policy_id' | 'created_at'>>,
  ): Promise<PolicyChunkRecord[]> {
    await this.client
      .from('policy_chunks')
      .delete()
      .eq('organization_id', organizationId)
      .eq('policy_id', policyId);
    if (chunks.length === 0) return [];
    const res = await this.client
      .from('policy_chunks')
      .insert(
        chunks.map((c) => ({
          organization_id: organizationId,
          policy_id: policyId,
          chunk_text: c.chunk_text,
          embedding: c.embedding,
          metadata: c.metadata,
        })),
      )
      .select('*');
    return unwrap(res, 'replacePolicyChunks') as PolicyChunkRecord[];
  }

  async listPolicyChunks(organizationId: string, language?: LanguageCode): Promise<PolicyChunkRecord[]> {
    const res = await this.client
      .from('policy_chunks')
      .select('*')
      .eq('organization_id', organizationId);
    const rows = unwrap(res, 'listPolicyChunks') as PolicyChunkRecord[];
    return language ? rows.filter((r) => r.metadata?.language === language) : rows;
  }

  async searchPolicyChunksByEmbedding(
    organizationId: string,
    embedding: number[],
    topK: number,
    language?: LanguageCode,
  ): Promise<Array<PolicyChunkRecord & { similarity: number }>> {
    const res = await this.client.rpc('match_policy_chunks', {
      p_organization_id: organizationId,
      p_query_embedding: embedding,
      p_match_count: topK,
      p_language: language ?? null,
    });
    if (res.error) throw new AppError(502, 'DATABASE_ERROR', res.error.message);
    return (res.data ?? []) as Array<PolicyChunkRecord & { similarity: number }>;
  }

  async createConsent(input: Omit<ConsentRecord, 'id' | 'granted_at' | 'withdrawn_at'>): Promise<ConsentRecord> {
    const res = await this.client.from('consents').insert(input).select('*').single();
    return unwrap(res, 'createConsent') as ConsentRecord;
  }

  async getConsentById(organizationId: string, consentId: string): Promise<ConsentRecord | null> {
    const res = await this.client
      .from('consents')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('id', consentId)
      .maybeSingle();
    if (res.error) throw new AppError(502, 'DATABASE_ERROR', res.error.message);
    return (res.data as ConsentRecord | null) ?? null;
  }

  async listConsents(
    organizationId: string,
    filters?: { citizenId?: string; helperId?: string; caseId?: string; activeOnly?: boolean },
  ): Promise<ConsentRecord[]> {
    let query = this.client
      .from('consents')
      .select('*')
      .eq('organization_id', organizationId)
      .order('granted_at', { ascending: false });
    if (filters?.citizenId) query = query.eq('citizen_id', filters.citizenId);
    if (filters?.helperId) query = query.eq('helper_id', filters.helperId);
    if (filters?.activeOnly) query = query.is('withdrawn_at', null);
    const res = await query;
    const rows = unwrap(res, 'listConsents') as ConsentRecord[];
    const now = Date.now();
    return rows.filter((c) => {
      if (filters?.caseId && c.case_id !== null && c.case_id !== filters.caseId) return false;
      if (filters?.activeOnly && c.expires_at && new Date(c.expires_at).getTime() <= now) return false;
      return true;
    });
  }

  async withdrawConsent(organizationId: string, consentId: string): Promise<ConsentRecord> {
    const res = await this.client
      .from('consents')
      .update({ withdrawn_at: new Date().toISOString() })
      .eq('organization_id', organizationId)
      .eq('id', consentId)
      .select('*')
      .single();
    return unwrap(res, 'withdrawConsent') as ConsentRecord;
  }

  async createAiRun(input: Omit<AiRunRecord, 'id' | 'created_at'>): Promise<AiRunRecord> {
    const res = await this.client.from('ai_runs').insert(input).select('*').single();
    return unwrap(res, 'createAiRun') as AiRunRecord;
  }

  async listAiRuns(organizationId: string, caseId?: string): Promise<AiRunRecord[]> {
    let query = this.client
      .from('ai_runs')
      .select('*')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false });
    if (caseId) query = query.eq('case_id', caseId);
    const res = await query;
    return unwrap(res, 'listAiRuns') as AiRunRecord[];
  }

  async createCaseReview(input: Omit<CaseReviewRecord, 'id' | 'created_at'>): Promise<CaseReviewRecord> {
    const res = await this.client.from('case_reviews').insert(input).select('*').single();
    return unwrap(res, 'createCaseReview') as CaseReviewRecord;
  }

  async listCaseReviews(organizationId: string, caseId: string): Promise<CaseReviewRecord[]> {
    const res = await this.client
      .from('case_reviews')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('case_id', caseId)
      .order('created_at', { ascending: false });
    return unwrap(res, 'listCaseReviews') as CaseReviewRecord[];
  }

  async findMockIdentityRecord(
    organizationId: string,
    mockIdentityReference: string,
  ): Promise<MockIdentityRecord | null> {
    const res = await this.client
      .from('mock_identity_records')
      .select('*')
      .eq('organization_id', organizationId)
      .ilike('mock_identity_reference', mockIdentityReference.trim())
      .maybeSingle();
    if (res.error) throw new AppError(502, 'DATABASE_ERROR', res.error.message);
    return (res.data as MockIdentityRecord | null) ?? null;
  }

  async upsertMockIdentityRecord(input: Omit<MockIdentityRecord, 'id' | 'created_at'>): Promise<MockIdentityRecord> {
    const res = await this.client
      .from('mock_identity_records')
      .upsert(input, { onConflict: 'organization_id,mock_identity_reference' })
      .select('*')
      .single();
    return unwrap(res, 'upsertMockIdentityRecord') as MockIdentityRecord;
  }

  async createMockPayment(
    input: Omit<MockPaymentRecord, 'id' | 'created_at' | 'completed_at'>,
  ): Promise<MockPaymentRecord> {
    const res = await this.client.from('mock_payment_records').insert(input).select('*').single();
    return unwrap(res, 'createMockPayment') as MockPaymentRecord;
  }

  async getMockPaymentById(organizationId: string, paymentId: string): Promise<MockPaymentRecord | null> {
    const res = await this.client
      .from('mock_payment_records')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('id', paymentId)
      .maybeSingle();
    if (res.error) throw new AppError(502, 'DATABASE_ERROR', res.error.message);
    return (res.data as MockPaymentRecord | null) ?? null;
  }

  async listCaseMockPayments(organizationId: string, caseId: string): Promise<MockPaymentRecord[]> {
    const res = await this.client
      .from('mock_payment_records')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('case_id', caseId)
      .order('created_at', { ascending: false });
    return unwrap(res, 'listCaseMockPayments') as MockPaymentRecord[];
  }

  async updateMockPayment(
    organizationId: string,
    paymentId: string,
    patch: Partial<Pick<MockPaymentRecord, 'status' | 'completed_at'>>,
  ): Promise<MockPaymentRecord> {
    const res = await this.client
      .from('mock_payment_records')
      .update(patch)
      .eq('organization_id', organizationId)
      .eq('id', paymentId)
      .select('*')
      .single();
    return unwrap(res, 'updateMockPayment') as MockPaymentRecord;
  }

  async appendAuditLog(input: Omit<AuditLogEntry, 'id' | 'created_at'>): Promise<AuditLogEntry> {
    const res = await this.client.from('audit_logs').insert(input).select('*').single();
    return unwrap(res, 'appendAuditLog') as AuditLogEntry;
  }

  async listAuditLogs(
    organizationId: string,
    filters?: { resourceType?: string; resourceId?: string; limit?: number },
  ): Promise<AuditLogEntry[]> {
    let query = this.client
      .from('audit_logs')
      .select('*')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false });
    if (filters?.resourceType) query = query.eq('resource_type', filters.resourceType);
    if (filters?.resourceId) query = query.eq('resource_id', filters.resourceId);
    if (filters?.limit) query = query.limit(filters.limit);
    const res = await query;
    return unwrap(res, 'listAuditLogs') as AuditLogEntry[];
  }

  async createNotification(
    input: Omit<NotificationItem, 'id' | 'read_at' | 'created_at'>,
  ): Promise<NotificationItem> {
    const res = await this.client.from('notifications').insert(input).select('*').single();
    return unwrap(res, 'createNotification') as NotificationItem;
  }

  async listNotifications(organizationId: string, userId: string): Promise<NotificationItem[]> {
    const res = await this.client
      .from('notifications')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    return unwrap(res, 'listNotifications') as NotificationItem[];
  }

  async markNotificationRead(
    organizationId: string,
    userId: string,
    notificationId: string,
  ): Promise<NotificationItem | null> {
    const res = await this.client
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .eq('id', notificationId)
      .select('*')
      .maybeSingle();
    if (res.error) throw new AppError(502, 'DATABASE_ERROR', res.error.message);
    return (res.data as NotificationItem | null) ?? null;
  }

  async createAssistanceRequest(
    input: Omit<
      AssistanceRequestRecord,
      'id' | 'status' | 'responder_user_id' | 'humanized_reply' | 'saved_as_guidance' | 'created_at' | 'answered_at'
    >,
  ): Promise<AssistanceRequestRecord> {
    const res = await this.client
      .from('assistance_requests')
      .insert({
        organization_id: input.organization_id,
        department_id: input.department_id,
        citizen_user_id: input.citizen_user_id,
        case_id: input.case_id,
        language: input.language,
        citizen_question: input.citizen_question,
        chatbot_draft_answer: input.chatbot_draft_answer,
      })
      .select('*')
      .single();
    return unwrap(res, 'createAssistanceRequest') as AssistanceRequestRecord;
  }

  async getAssistanceRequestById(
    organizationId: string,
    requestId: string,
  ): Promise<AssistanceRequestRecord | null> {
    const res = await this.client
      .from('assistance_requests')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('id', requestId)
      .maybeSingle();
    if (res.error) throw new AppError(502, 'DATABASE_ERROR', res.error.message);
    return (res.data as AssistanceRequestRecord | null) ?? null;
  }

  async listAssistanceRequests(
    organizationId: string,
    filters?: { citizenUserId?: string; departmentId?: string | null; status?: 'OPEN' | 'ANSWERED' },
  ): Promise<AssistanceRequestRecord[]> {
    let query = this.client
      .from('assistance_requests')
      .select('*')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false });
    if (filters?.citizenUserId) query = query.eq('citizen_user_id', filters.citizenUserId);
    if (filters?.status) query = query.eq('status', filters.status);
    const res = await query;
    const rows = unwrap(res, 'listAssistanceRequests') as AssistanceRequestRecord[];
    if (filters?.departmentId) {
      return rows.filter((r) => !r.department_id || r.department_id === filters.departmentId);
    }
    return rows;
  }

  async answerAssistanceRequest(
    organizationId: string,
    requestId: string,
    patch: { responder_user_id: string; humanized_reply: string; saved_as_guidance: boolean },
  ): Promise<AssistanceRequestRecord> {
    const res = await this.client
      .from('assistance_requests')
      .update({
        status: 'ANSWERED',
        responder_user_id: patch.responder_user_id,
        humanized_reply: patch.humanized_reply,
        saved_as_guidance: patch.saved_as_guidance,
        answered_at: new Date().toISOString(),
      })
      .eq('organization_id', organizationId)
      .eq('id', requestId)
      .select('*')
      .single();
    return unwrap(res, 'answerAssistanceRequest') as AssistanceRequestRecord;
  }

  async createHumanizedGuidance(
    input: Omit<HumanizedGuidanceRecord, 'id' | 'created_at'>,
  ): Promise<HumanizedGuidanceRecord> {
    const res = await this.client.from('humanized_guidance').insert(input).select('*').single();
    return unwrap(res, 'createHumanizedGuidance') as HumanizedGuidanceRecord;
  }

  async listHumanizedGuidance(
    organizationId: string,
    filters?: { serviceId?: string; language?: LanguageCode },
  ): Promise<HumanizedGuidanceRecord[]> {
    let query = this.client
      .from('humanized_guidance')
      .select('*')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false });
    if (filters?.serviceId) query = query.eq('service_id', filters.serviceId);
    if (filters?.language) query = query.eq('language', filters.language);
    const res = await query;
    return unwrap(res, 'listHumanizedGuidance') as HumanizedGuidanceRecord[];
  }

  // --- Autonomous Agent Working Memory, Reasoning Audit Trail & Human Escalations ---
  async getAgentMemorySession(sessionId: string): Promise<AgentMemorySessionRecord | null> {
    const res = await this.client
      .from('agent_memory_sessions')
      .select('*')
      .eq('session_id', sessionId)
      .maybeSingle();
    if (res.error) throw new AppError(502, 'DATABASE_ERROR', res.error.message);
    return (res.data as AgentMemorySessionRecord | null) ?? null;
  }

  async upsertAgentMemorySession(record: AgentMemorySessionRecord): Promise<AgentMemorySessionRecord> {
    const res = await this.client
      .from('agent_memory_sessions')
      .upsert(record, { onConflict: 'session_id' })
      .select('*')
      .single();
    return unwrap(res, 'upsertAgentMemorySession') as AgentMemorySessionRecord;
  }

  async appendAgentReasoningAuditLog(
    input: Omit<AgentReasoningAuditLogRecord, 'id' | 'timestamp'>,
  ): Promise<AgentReasoningAuditLogRecord> {
    const res = await this.client
      .from('agent_reasoning_audit_logs')
      .insert(input)
      .select('*')
      .single();
    return unwrap(res, 'appendAgentReasoningAuditLog') as AgentReasoningAuditLogRecord;
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
    let query = this.client
      .from('agent_reasoning_audit_logs')
      .select('*')
      .eq('organization_id', organizationId)
      .order('timestamp', { ascending: false })
      .limit(filters?.limit ?? 150);
    if (filters?.sessionId) query = query.eq('session_id', filters.sessionId);
    if (filters?.citizenId) query = query.eq('citizen_id', filters.citizenId);
    if (filters?.departmentId) query = query.eq('department_id', filters.departmentId);
    if (filters?.capabilityCheck) query = query.eq('capability_check', filters.capabilityCheck);
    const res = await query;
    const rows = unwrap(res, 'listAgentReasoningAuditLogs') as AgentReasoningAuditLogRecord[];
    if (filters?.accessDecision) {
      return rows.filter((r) => r.access_control_decision?.decision === filters.accessDecision);
    }
    return rows;
  }

  async createAgentEscalation(
    input: Omit<AgentEscalationRecord, 'id' | 'ticket_reference' | 'created_at' | 'updated_at'>,
  ): Promise<AgentEscalationRecord> {
    const ticketRef = `ESC-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const res = await this.client
      .from('agent_escalations')
      .insert({ ...input, ticket_reference: ticketRef })
      .select('*')
      .single();
    return unwrap(res, 'createAgentEscalation') as AgentEscalationRecord;
  }

  async listAgentEscalations(
    organizationId: string,
    filters?: { citizenId?: string; status?: 'OPEN' | 'IN_REVIEW' | 'RESOLVED' },
  ): Promise<AgentEscalationRecord[]> {
    let query = this.client
      .from('agent_escalations')
      .select('*')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false });
    if (filters?.citizenId) query = query.eq('citizen_id', filters.citizenId);
    if (filters?.status) query = query.eq('status', filters.status);
    const res = await query;
    return unwrap(res, 'listAgentEscalations') as AgentEscalationRecord[];
  }

  async updateAgentEscalationStatus(
    organizationId: string,
    escalationId: string,
    patch: { status: 'OPEN' | 'IN_REVIEW' | 'RESOLVED'; resolution_notes?: string | null },
  ): Promise<AgentEscalationRecord> {
    const res = await this.client
      .from('agent_escalations')
      .update({
        status: patch.status,
        ...(patch.resolution_notes !== undefined ? { resolution_notes: patch.resolution_notes } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('organization_id', organizationId)
      .eq('id', escalationId)
      .select('*')
      .single();
    return unwrap(res, 'updateAgentEscalationStatus') as AgentEscalationRecord;
  }

  // --- Phase 4: Direct Department Officer Inquiries ---
  async createOfficerInquiry(
    input: Omit<OfficerInquiryRecord, 'id' | 'tracking_reference' | 'status' | 'officer_reply' | 'created_at' | 'replied_at'>,
  ): Promise<OfficerInquiryRecord> {
    const trackingRef = `INQ-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const res = await this.client
      .from('officer_inquiries')
      .insert({ ...input, tracking_reference: trackingRef, status: 'OPEN', officer_reply: null, replied_at: null })
      .select('*')
      .single();
    return unwrap(res, 'createOfficerInquiry') as OfficerInquiryRecord;
  }

  async getOfficerInquiryById(organizationId: string, inquiryId: string): Promise<OfficerInquiryRecord | null> {
    const res = await this.client
      .from('officer_inquiries')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('id', inquiryId)
      .maybeSingle();
    if (res.error) throw new AppError(502, 'DATABASE_ERROR', res.error.message);
    return (res.data as OfficerInquiryRecord | null) ?? null;
  }

  async listOfficerInquiries(
    organizationId: string,
    filters?: { userId?: string; citizenId?: string; departmentId?: ServiceDepartmentCode; status?: 'OPEN' | 'ANSWERED' },
  ): Promise<OfficerInquiryRecord[]> {
    let query = this.client
      .from('officer_inquiries')
      .select('*')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false });
    if (filters?.userId) query = query.eq('user_id', filters.userId);
    if (filters?.citizenId) query = query.eq('citizen_id', filters.citizenId);
    if (filters?.departmentId) query = query.eq('department_id', filters.departmentId);
    if (filters?.status) query = query.eq('status', filters.status);
    const res = await query;
    return unwrap(res, 'listOfficerInquiries') as OfficerInquiryRecord[];
  }

  async replyOfficerInquiry(
    organizationId: string,
    inquiryId: string,
    patch: { officer_reply: string; assigned_officer_id?: string | null; assigned_officer_name?: string },
  ): Promise<OfficerInquiryRecord> {
    const res = await this.client
      .from('officer_inquiries')
      .update({
        status: 'ANSWERED',
        officer_reply: patch.officer_reply,
        ...(patch.assigned_officer_id !== undefined ? { assigned_officer_id: patch.assigned_officer_id } : {}),
        ...(patch.assigned_officer_name !== undefined ? { assigned_officer_name: patch.assigned_officer_name } : {}),
        replied_at: new Date().toISOString(),
      })
      .eq('organization_id', organizationId)
      .eq('id', inquiryId)
      .select('*')
      .single();
    return unwrap(res, 'replyOfficerInquiry') as OfficerInquiryRecord;
  }

  // --- Layer 2: Self-Learning Semantic NLU Correction RAG Memory ---
  async listAgentNluRagMemories(organizationId?: string): Promise<AgentNluRagMemoryRecord[]> {
    let query = this.client
      .from('agent_nlu_rag_memory')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(300);
    if (organizationId) {
      query = query.or(`organization_id.is.null,organization_id.eq.${organizationId}`);
    }
    const res = await query;
    return unwrap(res, 'listAgentNluRagMemories') as AgentNluRagMemoryRecord[];
  }

  async upsertAgentNluRagMemory(
    input: Omit<AgentNluRagMemoryRecord, 'id' | 'created_at' | 'updated_at'>,
  ): Promise<AgentNluRagMemoryRecord> {
    const res = await this.client
      .from('agent_nlu_rag_memory')
      .insert(input)
      .select('*')
      .single();
    return unwrap(res, 'upsertAgentNluRagMemory') as AgentNluRagMemoryRecord;
  }

  async incrementAgentNluRagHit(memoryId: string): Promise<void> {
    const existing = await this.client
      .from('agent_nlu_rag_memory')
      .select('hit_count')
      .eq('id', memoryId)
      .maybeSingle();
    const nextCount = Number((existing.data as { hit_count?: number } | null)?.hit_count ?? 0) + 1;
    await this.client
      .from('agent_nlu_rag_memory')
      .update({ hit_count: nextCount, updated_at: new Date().toISOString() })
      .eq('id', memoryId);
  }

  // --- Phase 3: Universal Hybrid RAG Collections (5 persistent collections) ---
  async listUniversalRagDocuments(filters?: {
    organizationId?: string;
    collections?: UniversalRagCollection[];
    sessionId?: string;
    citizenId?: string;
  }): Promise<UniversalRagDocumentRecord[]> {
    let query = this.client
      .from('universal_rag_documents')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(400);
    if (filters?.organizationId) {
      query = query.or(`organization_id.is.null,organization_id.eq.${filters.organizationId}`);
    }
    if (filters?.collections && filters.collections.length > 0) {
      query = query.in('collection', filters.collections);
    }
    const res = await query;
    const rows = unwrap(res, 'listUniversalRagDocuments') as UniversalRagDocumentRecord[];
    if (filters?.sessionId || filters?.citizenId) {
      return rows.filter((d) => {
        if (d.collection !== 'episodic_conversation_kb') return true;
        if (filters.sessionId && d.session_id === filters.sessionId) return true;
        if (filters.citizenId && d.citizen_id === filters.citizenId) return true;
        return false;
      });
    }
    return rows;
  }

  async upsertUniversalRagDocument(
    input: Omit<UniversalRagDocumentRecord, 'id' | 'created_at' | 'updated_at'>,
  ): Promise<UniversalRagDocumentRecord> {
    const res = await this.client
      .from('universal_rag_documents')
      .insert(input)
      .select('*')
      .single();
    return unwrap(res, 'upsertUniversalRagDocument') as UniversalRagDocumentRecord;
  }

  async incrementUniversalRagHit(docId: string): Promise<void> {
    const existing = await this.client
      .from('universal_rag_documents')
      .select('hit_count')
      .eq('id', docId)
      .maybeSingle();
    const nextCount = Number((existing.data as { hit_count?: number } | null)?.hit_count ?? 0) + 1;
    await this.client
      .from('universal_rag_documents')
      .update({ hit_count: nextCount, updated_at: new Date().toISOString() })
      .eq('id', docId);
  }

  // --- Phase 3 Rubric Persistence Tables (Rules v1.x, Granular Consent, Doc Authenticity, RAG Collections) ---
  async listDynamicRuleVersions(organizationId: string): Promise<Array<Record<string, unknown>>> {
    const res = await this.client
      .from('eligibility_rule_versions')
      .select('*')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false });
    return unwrap(res, 'listDynamicRuleVersions') as Array<Record<string, unknown>>;
  }

  async createDynamicRuleVersion(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await this.client
      .from('eligibility_rule_versions')
      .insert(input)
      .select('*')
      .single();
    return unwrap(res, 'createDynamicRuleVersion') as Record<string, unknown>;
  }

  async getCitizenGranularConsent(
    organizationId: string,
    userId: string,
  ): Promise<Record<string, unknown> | null> {
    const res = await this.client
      .from('citizen_consent_records')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .maybeSingle();
    if (res.error) throw new AppError(502, 'DATABASE_ERROR', res.error.message);
    return (res.data as Record<string, unknown> | null) ?? null;
  }

  async upsertCitizenGranularConsent(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await this.client
      .from('citizen_consent_records')
      .upsert(input, { onConflict: 'organization_id,user_id' })
      .select('*')
      .single();
    return unwrap(res, 'upsertCitizenGranularConsent') as Record<string, unknown>;
  }

  async createDocumentAuthenticityCheck(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await this.client
      .from('document_authenticity_checks')
      .insert(input)
      .select('*')
      .single();
    return unwrap(res, 'createDocumentAuthenticityCheck') as Record<string, unknown>;
  }

  async listDocumentAuthenticityChecks(organizationId: string): Promise<Array<Record<string, unknown>>> {
    const res = await this.client
      .from('document_authenticity_checks')
      .select('*')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })
      .limit(100);
    return unwrap(res, 'listDocumentAuthenticityChecks') as Array<Record<string, unknown>>;
  }

  async listUniversalRagCollections(): Promise<Array<Record<string, unknown>>> {
    const res = await this.client
      .from('universal_rag_collections')
      .select('*')
      .order('collection_key', { ascending: true });
    return unwrap(res, 'listUniversalRagCollections') as Array<Record<string, unknown>>;
  }
}
