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

export interface StoredLocalUserCredential {
  user_id: string;
  email: string;
  password_hash: string;
}

export interface PhoneOtpChallengeRecord {
  id: string;
  phone_number: string;
  otp_hash: string;
  salt: string;
  expires_at: string;
  attempts: number;
  max_attempts: number;
  consumed_at: string | null;
  created_at: string;
}

export interface DataStore {
  readonly mode: 'supabase' | 'memory';

  // --- Organizations & Departments (SaaS Foundation) ---
  createOrganization(input: { name: string; slug: string }): Promise<Organization>;
  updateOrganization(organizationId: string, patch: { name?: string; slug?: string }): Promise<Organization>;
  deleteOrganization(organizationId: string): Promise<void>;
  getOrganizationById(organizationId: string): Promise<Organization | null>;
  listOrganizationsForUser(userId: string): Promise<Array<Organization & { role: UserRole; department_id: string | null }>>;
  listDepartments(organizationId: string): Promise<Department[]>;
  createDepartment(organizationId: string, input: { name: string; code: string }): Promise<Department>;

  // --- Profiles & Memberships ---
  getProfileById(userId: string): Promise<UserProfile | null>;
  getProfileByEmail(email: string): Promise<UserProfile | null>;
  getProfileByPhone(phoneNumber: string): Promise<UserProfile | null>;
  createProfile(input: {
    id: string;
    email: string;
    display_name: string;
    phone_number?: string | null;
    phone_verified_at?: string | null;
    role: UserRole;
    default_organization_id: string | null;
    department_id?: string | null;
    preferred_language?: LanguageCode;
  }): Promise<UserProfile>;
  updateProfile(
    userId: string,
    patch: Partial<
      Pick<
        UserProfile,
        'display_name' | 'preferred_language' | 'default_organization_id' | 'phone_number' | 'phone_verified_at'
      >
    >,
  ): Promise<UserProfile>;

  // --- Phone OTP Verification Challenges (server-only) ---
  createPhoneOtpChallenge(
    input: Omit<PhoneOtpChallengeRecord, 'id' | 'attempts' | 'consumed_at' | 'created_at'>,
  ): Promise<PhoneOtpChallengeRecord>;
  getPhoneOtpChallengeById(challengeId: string): Promise<PhoneOtpChallengeRecord | null>;
  incrementPhoneOtpAttempts(challengeId: string): Promise<PhoneOtpChallengeRecord>;
  markPhoneOtpConsumed(challengeId: string): Promise<void>;

  getMembership(organizationId: string, userId: string): Promise<OrganizationMembership | null>;
  upsertMembership(input: {
    organization_id: string;
    user_id: string;
    role: UserRole;
    department_id?: string | null;
  }): Promise<OrganizationMembership>;
  removeMembership(organizationId: string, userId: string): Promise<boolean>;
  listOrganizationMembers(organizationId: string): Promise<Array<{ profile: UserProfile; membership: OrganizationMembership }>>;

  // --- Dev-only local credentials (never used in production/Supabase Auth mode) ---
  saveLocalCredential?(cred: StoredLocalUserCredential): Promise<void>;
  getLocalCredentialByEmail?(email: string): Promise<StoredLocalUserCredential | null>;

  // --- Citizens (Tenant-scoped) ---
  getCitizenById(organizationId: string, citizenId: string): Promise<CitizenRecord | null>;
  getCitizenByUserId(organizationId: string, userId: string): Promise<CitizenRecord | null>;
  findCitizensByMockIdentity(organizationId: string, mockIdentityReference: string): Promise<CitizenRecord[]>;
  createCitizen(input: {
    organization_id: string;
    user_id: string | null;
    display_name: string;
    mock_identity_reference: string;
  }): Promise<CitizenRecord>;
  listCitizens(organizationId: string): Promise<CitizenRecord[]>;

  // --- Cases & Answers (Tenant-scoped) ---
  getCaseById(organizationId: string, caseId: string): Promise<CaseRecord | null>;
  getCaseByIdempotencyKey(organizationId: string, idempotencyKey: string): Promise<CaseRecord | null>;
  listCases(organizationId: string, filters?: { citizenId?: string; status?: string; search?: string }): Promise<CaseRecord[]>;
  createCase(input: Omit<CaseRecord, 'id' | 'created_at' | 'updated_at'>): Promise<CaseRecord>;
  updateCase(organizationId: string, caseId: string, patch: Partial<CaseRecord>): Promise<CaseRecord>;

  listCaseAnswers(organizationId: string, caseId: string): Promise<CaseAnswerRecord[]>;
  upsertCaseAnswer(
    organizationId: string,
    caseId: string,
    answer: Omit<CaseAnswerRecord, 'id' | 'organization_id' | 'case_id' | 'created_at' | 'updated_at'>,
  ): Promise<CaseAnswerRecord>;

  // --- Documents (Tenant-scoped) ---
  createDocument(input: Omit<DocumentRecord, 'id' | 'created_at'>): Promise<DocumentRecord>;
  getDocumentById(organizationId: string, documentId: string): Promise<DocumentRecord | null>;
  listCaseDocuments(organizationId: string, caseId: string): Promise<DocumentRecord[]>;
  updateDocument(organizationId: string, documentId: string, patch: Partial<DocumentRecord>): Promise<DocumentRecord>;

  // --- Eligibility Rules & Versions (Tenant-scoped) ---
  getRuleByScheme(organizationId: string, schemeId: string): Promise<EligibilityRuleRecord | null>;
  getRuleById(organizationId: string, ruleId: string): Promise<EligibilityRuleRecord | null>;
  listRules(organizationId: string): Promise<EligibilityRuleRecord[]>;
  createRule(organizationId: string, schemeId: string): Promise<EligibilityRuleRecord>;
  setRuleActiveVersion(organizationId: string, ruleId: string, versionId: string): Promise<EligibilityRuleRecord>;
  createRuleVersion(input: {
    organization_id: string;
    rule_id: string;
    scheme_id: string;
    version_number: number;
    rules_json: EligibilityRuleDefinition;
    published_by: string;
  }): Promise<RuleVersionRecord>;
  getRuleVersionById(organizationId: string, versionId: string): Promise<RuleVersionRecord | null>;
  listRuleVersions(organizationId: string, ruleId?: string): Promise<RuleVersionRecord[]>;

  // --- Policies & Policy Chunks (Tenant-scoped) ---
  listPolicies(organizationId: string): Promise<PolicyRecord[]>;
  getPolicyById(organizationId: string, policyId: string): Promise<PolicyRecord | null>;
  createPolicy(input: Omit<PolicyRecord, 'id' | 'created_at'>): Promise<PolicyRecord>;
  replacePolicyChunks(
    organizationId: string,
    policyId: string,
    chunks: Array<Omit<PolicyChunkRecord, 'id' | 'organization_id' | 'policy_id' | 'created_at'>>,
  ): Promise<PolicyChunkRecord[]>;
  listPolicyChunks(organizationId: string, language?: LanguageCode): Promise<PolicyChunkRecord[]>;
  searchPolicyChunksByEmbedding(
    organizationId: string,
    embedding: number[],
    topK: number,
    language?: LanguageCode,
  ): Promise<Array<PolicyChunkRecord & { similarity: number }>>;

  // --- Consents (Tenant-scoped) ---
  createConsent(input: Omit<ConsentRecord, 'id' | 'granted_at' | 'withdrawn_at'>): Promise<ConsentRecord>;
  getConsentById(organizationId: string, consentId: string): Promise<ConsentRecord | null>;
  listConsents(
    organizationId: string,
    filters?: { citizenId?: string; helperId?: string; caseId?: string; activeOnly?: boolean },
  ): Promise<ConsentRecord[]>;
  withdrawConsent(organizationId: string, consentId: string): Promise<ConsentRecord>;

  // --- AI Runs, Case Reviews, Mock Identity, Mock Payments ---
  createAiRun(input: Omit<AiRunRecord, 'id' | 'created_at'>): Promise<AiRunRecord>;
  listAiRuns(organizationId: string, caseId?: string): Promise<AiRunRecord[]>;

  createCaseReview(input: Omit<CaseReviewRecord, 'id' | 'created_at'>): Promise<CaseReviewRecord>;
  listCaseReviews(organizationId: string, caseId: string): Promise<CaseReviewRecord[]>;

  findMockIdentityRecord(organizationId: string, mockIdentityReference: string): Promise<MockIdentityRecord | null>;
  upsertMockIdentityRecord(input: Omit<MockIdentityRecord, 'id' | 'created_at'>): Promise<MockIdentityRecord>;

  createMockPayment(input: Omit<MockPaymentRecord, 'id' | 'created_at' | 'completed_at'>): Promise<MockPaymentRecord>;
  getMockPaymentById(organizationId: string, paymentId: string): Promise<MockPaymentRecord | null>;
  listCaseMockPayments(organizationId: string, caseId: string): Promise<MockPaymentRecord[]>;
  updateMockPayment(
    organizationId: string,
    paymentId: string,
    patch: Partial<Pick<MockPaymentRecord, 'status' | 'completed_at'>>,
  ): Promise<MockPaymentRecord>;

  // --- Append-only Audit Logs & Notifications (SaaS Foundation) ---
  appendAuditLog(input: Omit<AuditLogEntry, 'id' | 'created_at'>): Promise<AuditLogEntry>;
  listAuditLogs(organizationId: string, filters?: { resourceType?: string; resourceId?: string; limit?: number }): Promise<AuditLogEntry[]>;

  createNotification(input: Omit<NotificationItem, 'id' | 'read_at' | 'created_at'>): Promise<NotificationItem>;
  listNotifications(organizationId: string, userId: string): Promise<NotificationItem[]>;
  markNotificationRead(organizationId: string, userId: string, notificationId: string): Promise<NotificationItem | null>;

  // --- Department Humanized Chatbot Assistance & Guidance (Tenant-scoped) ---
  createAssistanceRequest(
    input: Omit<AssistanceRequestRecord, 'id' | 'status' | 'responder_user_id' | 'humanized_reply' | 'saved_as_guidance' | 'created_at' | 'answered_at'>,
  ): Promise<AssistanceRequestRecord>;
  getAssistanceRequestById(organizationId: string, requestId: string): Promise<AssistanceRequestRecord | null>;
  listAssistanceRequests(
    organizationId: string,
    filters?: { citizenUserId?: string; departmentId?: string | null; status?: 'OPEN' | 'ANSWERED' },
  ): Promise<AssistanceRequestRecord[]>;
  answerAssistanceRequest(
    organizationId: string,
    requestId: string,
    patch: { responder_user_id: string; humanized_reply: string; saved_as_guidance: boolean },
  ): Promise<AssistanceRequestRecord>;

  createHumanizedGuidance(
    input: Omit<HumanizedGuidanceRecord, 'id' | 'created_at'>,
  ): Promise<HumanizedGuidanceRecord>;
  listHumanizedGuidance(
    organizationId: string,
    filters?: { serviceId?: string; language?: LanguageCode },
  ): Promise<HumanizedGuidanceRecord[]>;

  // --- Autonomous Agent Working Memory, Reasoning Audit Trail & Human Escalations ---
  getAgentMemorySession(sessionId: string): Promise<AgentMemorySessionRecord | null>;
  upsertAgentMemorySession(record: AgentMemorySessionRecord): Promise<AgentMemorySessionRecord>;

  appendAgentReasoningAuditLog(
    input: Omit<AgentReasoningAuditLogRecord, 'id' | 'timestamp'>,
  ): Promise<AgentReasoningAuditLogRecord>;
  listAgentReasoningAuditLogs(
    organizationId: string,
    filters?: {
      sessionId?: string;
      citizenId?: string;
      departmentId?: ServiceDepartmentCode;
      capabilityCheck?: string;
      accessDecision?: string;
      limit?: number;
    },
  ): Promise<AgentReasoningAuditLogRecord[]>;

  createAgentEscalation(
    input: Omit<AgentEscalationRecord, 'id' | 'ticket_reference' | 'created_at' | 'updated_at'>,
  ): Promise<AgentEscalationRecord>;
  listAgentEscalations(
    organizationId: string,
    filters?: { citizenId?: string; status?: 'OPEN' | 'IN_REVIEW' | 'RESOLVED' },
  ): Promise<AgentEscalationRecord[]>;
  updateAgentEscalationStatus(
    organizationId: string,
    escalationId: string,
    patch: { status: 'OPEN' | 'IN_REVIEW' | 'RESOLVED'; resolution_notes?: string | null },
  ): Promise<AgentEscalationRecord>;

  // --- Phase 4: Direct Department Officer Inquiries (Citizen <-> Department Officer) ---
  createOfficerInquiry(
    input: Omit<OfficerInquiryRecord, 'id' | 'tracking_reference' | 'status' | 'officer_reply' | 'created_at' | 'replied_at'>,
  ): Promise<OfficerInquiryRecord>;
  getOfficerInquiryById(organizationId: string, inquiryId: string): Promise<OfficerInquiryRecord | null>;
  listOfficerInquiries(
    organizationId: string,
    filters?: { userId?: string; citizenId?: string; departmentId?: ServiceDepartmentCode; status?: 'OPEN' | 'ANSWERED' },
  ): Promise<OfficerInquiryRecord[]>;
  replyOfficerInquiry(
    organizationId: string,
    inquiryId: string,
    patch: { officer_reply: string; assigned_officer_id?: string | null; assigned_officer_name?: string },
  ): Promise<OfficerInquiryRecord>;

  // --- Layer 2: Self-Learning Semantic NLU Correction RAG Memory ---
  listAgentNluRagMemories(organizationId?: string): Promise<AgentNluRagMemoryRecord[]>;
  upsertAgentNluRagMemory(
    input: Omit<AgentNluRagMemoryRecord, 'id' | 'created_at' | 'updated_at'>,
  ): Promise<AgentNluRagMemoryRecord>;
  incrementAgentNluRagHit(memoryId: string): Promise<void>;

  // --- Phase 3: Universal Hybrid RAG Collections (5 persistent collections) ---
  listUniversalRagDocuments(filters?: {
    organizationId?: string;
    collections?: UniversalRagCollection[];
    sessionId?: string;
    citizenId?: string;
  }): Promise<UniversalRagDocumentRecord[]>;
  upsertUniversalRagDocument(
    input: Omit<UniversalRagDocumentRecord, 'id' | 'created_at' | 'updated_at'>,
  ): Promise<UniversalRagDocumentRecord>;
  incrementUniversalRagHit(docId: string): Promise<void>;
}
