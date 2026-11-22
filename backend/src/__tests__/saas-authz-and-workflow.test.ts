import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { loadEnv } from '../config/env';
import { MemoryDataStore } from '../core/database/memory-store';
import { DEFAULT_ORG_IDS, DEFAULT_RULE_DEFINITION, DEFAULT_USER_IDS } from '../core/database/seed-data';

function setupTestApp() {
  const env = loadEnv({
    NODE_ENV: 'test',
    DATA_STORE_MODE: 'memory',
    AUTH_MODE: 'dev_local',
    GEMINI_API_KEY: '',
    GROQ_API_KEY: '',
    GITHUB_TOKEN: '',
    VOICE_PROVIDER: 'unconfigured',
  });
  const store = new MemoryDataStore(true);
  const { app } = createApp({ env, store });
  return { app, store };
}

async function loginAs(app: ReturnType<typeof createApp>['app'], email: string): Promise<string> {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password: 'DemoPass123!' })
    .expect(200);
  return res.body.access_token as string;
}

describe('Awaaz Multi-User SaaS Authorization, Tenant Isolation & Idea 1 Vertical Slice', () => {
  it('enforces strict tenant isolation across organizations and prevents header spoofing', async () => {
    const { app } = setupTestApp();
    const citizenAToken = await loginAs(app, 'citizen@demo.awaaz.local');
    const citizenBToken = await loginAs(app, 'citizen-beta@demo.awaaz.local');
    const officerBToken = await loginAs(app, 'officer-beta@demo.awaaz.local');

    // Citizen A creates a case in Org A
    const createRes = await request(app)
      .post('/api/v1/cases')
      .set('Authorization', `Bearer ${citizenAToken}`)
      .send({
        scheme_id: 'MOCK_RELIEF_01',
        preferred_language: 'ur',
        idempotency_key: 'tenant-isolation-key-001',
      })
      .expect(201);

    const caseAId = createRes.body.case.id as string;

    // Citizen B in Org B cannot access Case A
    await request(app)
      .get(`/api/v1/cases/${caseAId}`)
      .set('Authorization', `Bearer ${citizenBToken}`)
      .expect(404);

    // Officer B in Org B cannot access Case A
    await request(app)
      .get(`/api/v1/cases/${caseAId}`)
      .set('Authorization', `Bearer ${officerBToken}`)
      .expect(404);

    // Officer B spoofing X-Organization-Id for Org A is strictly rejected with 403
    await request(app)
      .get(`/api/v1/cases/${caseAId}`)
      .set('Authorization', `Bearer ${officerBToken}`)
      .set('X-Organization-Id', DEFAULT_ORG_IDS.RELIEF_DEMO)
      .expect(403);
  });

  it('enforces server-side helper consent grant and immediate access revocation on withdrawal', async () => {
    const { app } = setupTestApp();
    const citizenToken = await loginAs(app, 'citizen@demo.awaaz.local');
    const helperToken = await loginAs(app, 'helper@demo.awaaz.local');

    const createRes = await request(app)
      .post('/api/v1/cases')
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({
        scheme_id: 'MOCK_RELIEF_01',
        preferred_language: 'en',
        idempotency_key: 'consent-flow-key-001',
      })
      .expect(201);
    const caseId = createRes.body.case.id as string;

    // Helper CANNOT access case before consent
    await request(app)
      .get(`/api/v1/cases/${caseId}`)
      .set('Authorization', `Bearer ${helperToken}`)
      .expect(403);

    // Helper CANNOT grant consent on citizen's behalf
    await request(app)
      .post('/api/v1/consent')
      .set('Authorization', `Bearer ${helperToken}`)
      .send({
        consent_type: 'helper_delegation',
        helper_id: DEFAULT_USER_IDS.HELPER_A,
        case_id: caseId,
        permissions: ['view_case', 'edit_draft'],
      })
      .expect(403);

    // Citizen grants helper delegation consent
    const consentRes = await request(app)
      .post('/api/v1/consent')
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({
        consent_type: 'helper_delegation',
        helper_id: DEFAULT_USER_IDS.HELPER_A,
        case_id: caseId,
        permissions: ['view_case', 'edit_draft'],
      })
      .expect(201);
    const consentId = consentRes.body.consent.id as string;

    // Helper CAN now access case
    await request(app)
      .get(`/api/v1/cases/${caseId}`)
      .set('Authorization', `Bearer ${helperToken}`)
      .expect(200);

    // Citizen withdraws consent
    await request(app)
      .post(`/api/v1/consent/${consentId}/withdraw`)
      .set('Authorization', `Bearer ${citizenToken}`)
      .expect(200);

    // Helper access is IMMEDIATELY revoked on server
    await request(app)
      .get(`/api/v1/cases/${caseId}`)
      .set('Authorization', `Bearer ${helperToken}`)
      .expect(403);
  });

  it('completes end-to-end relief workflow, preserves rule versions, hides internal notes, and enforces RBAC', async () => {
    const { app } = setupTestApp();
    const citizenToken = await loginAs(app, 'citizen@demo.awaaz.local');
    const helperToken = await loginAs(app, 'helper@demo.awaaz.local');
    const officerToken = await loginAs(app, 'officer@demo.awaaz.local');
    const adminToken = await loginAs(app, 'admin@demo.awaaz.local');

    // 1. Grant processing consent
    await request(app)
      .post('/api/v1/consent')
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({
        consent_type: 'processing',
        permissions: ['application_processing', 'ai_extraction'],
      })
      .expect(201);

    // 2. Create case idempotently (second call replays same case ID)
    const idemKey = 'e2e-idem-key-001';
    const c1 = await request(app)
      .post('/api/v1/cases')
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({ scheme_id: 'MOCK_RELIEF_01', preferred_language: 'ur', idempotency_key: idemKey })
      .expect(201);
    const c2 = await request(app)
      .post('/api/v1/cases')
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({ scheme_id: 'MOCK_RELIEF_01', preferred_language: 'ur', idempotency_key: idemKey })
      .expect(200);
    expect(c2.body.case.id).toBe(c1.body.case.id);
    const caseId = c1.body.case.id as string;

    // 3. Patch answers & test offline sync conflict detection
    await request(app)
      .patch(`/api/v1/cases/${caseId}/answers`)
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({
        current_step: 'documents',
        answers: [
          { field_name: 'full_name', field_value: 'Amina Bibi', source: 'text', confirmed_by_citizen: true },
          { field_name: 'mock_identity_reference', field_value: 'MOCK-ID-1001', source: 'text', confirmed_by_citizen: true },
          { field_name: 'district', field_value: 'Multan', source: 'text', confirmed_by_citizen: true },
          { field_name: 'household_size', field_value: 5, source: 'text', confirmed_by_citizen: true },
          { field_name: 'monthly_income', field_value: 18000, source: 'text', confirmed_by_citizen: true },
          { field_name: 'employment_status', field_value: 'daily_wage', source: 'text', confirmed_by_citizen: true },
          { field_name: 'relief_reason', field_value: 'Synthetic flood relief request', source: 'text', confirmed_by_citizen: true },
        ],
      })
      .expect(200);

    await request(app)
      .patch(`/api/v1/cases/${caseId}/answers`)
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({
        expected_server_updated_at: '2020-01-01T00:00:00.000Z',
        answers: [{ field_name: 'district', field_value: 'Stale', source: 'text', confirmed_by_citizen: true }],
      })
      .expect(409);

    // 4. Upload required synthetic documents
    await request(app)
      .post('/api/v1/documents')
      .set('Authorization', `Bearer ${citizenToken}`)
      .field('case_id', caseId)
      .field('document_type', 'mock_identity_document')
      .attach('file', Buffer.from('Synthetic ID: MOCK-ID-1001 Name: Amina Bibi'), {
        filename: 'mock-id.txt',
        contentType: 'text/plain',
      })
      .expect(201);

    await request(app)
      .post('/api/v1/documents')
      .set('Authorization', `Bearer ${citizenToken}`)
      .field('case_id', caseId)
      .field('document_type', 'mock_proof_of_income')
      .attach('file', Buffer.from('Synthetic Income: 18000 PKR'), {
        filename: 'mock-income.txt',
        contentType: 'text/plain',
      })
      .expect(201);

    // 5. Query synthetic policy RAG (honest lexical excerpt mode without GEMINI_API_KEY)
    const ragRes = await request(app)
      .post('/api/v1/rag/query')
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({ question: 'What is the monthly income threshold?', language: 'en', case_id: caseId })
      .expect(200);
    expect(ragRes.body.retrieval_mode).toBe('lexical_excerpt_only');
    expect(ragRes.body.citations.length).toBeGreaterThan(0);

    // 6. Unconfigured voice provider returns honest 503 instead of fake transcript
    await request(app)
      .post('/api/v1/voice/speak')
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({ text: 'Hello', language: 'en' })
      .expect(503);

    // 7. Submit application -> deterministic evaluation routes to READY_FOR_OFFICER
    const submitRes = await request(app)
      .post(`/api/v1/cases/${caseId}/submit`)
      .set('Authorization', `Bearer ${citizenToken}`)
      .expect(200);
    expect(submitRes.body.case.status).toBe('READY_FOR_OFFICER');
    expect(submitRes.body.analysis.evidence_score).toBe(100);
    const evaluatedRuleVersionId = submitRes.body.case.rule_version_id as string;

    // 8. Citizen & Helper CANNOT approve applications
    await request(app)
      .post(`/api/v1/cases/${caseId}/decision`)
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({ decision: 'APPROVED', internal_notes: 'hack', citizen_message: 'hack' })
      .expect(403);

    await request(app)
      .post(`/api/v1/cases/${caseId}/decision`)
      .set('Authorization', `Bearer ${helperToken}`)
      .send({ decision: 'APPROVED', internal_notes: 'hack', citizen_message: 'hack' })
      .expect(403);

    // 9. Officer approves case with private internal notes
    const decideRes = await request(app)
      .post(`/api/v1/cases/${caseId}/decision`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        decision: 'APPROVED',
        internal_notes: 'CONFIDENTIAL_OFFICER_NOTE_XYZ',
        citizen_message: 'Your synthetic relief application has been approved.',
      })
      .expect(200);
    expect(decideRes.body.case.status).toBe('APPROVED');

    // Citizen sees citizen_message but MUST NOT see internal_notes
    const citizenView = await request(app)
      .get(`/api/v1/cases/${caseId}`)
      .set('Authorization', `Bearer ${citizenToken}`)
      .expect(200);
    expect(citizenView.body.reviews[0].citizen_message).toContain('approved');
    expect(citizenView.body.reviews[0].internal_notes).toBeUndefined();

    // 10. Officer initiates Mock Payment simulation on APPROVED case
    const payRes = await request(app)
      .post('/api/v1/mock-payments')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ case_id: caseId })
      .expect(201);
    expect(payRes.body.payment.status).toBe('MOCK_PAYMENT_COMPLETED');
    expect(payRes.body.case.status).toBe('MOCK_PAYMENT_COMPLETED');

    // 11. Admin publishes Rule Version 2 -> historical case preserves Rule Version 1
    const v2Res = await request(app)
      .post('/api/v1/admin/rules')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        ...DEFAULT_RULE_DEFINITION,
        conditions: [{ field: 'monthly_income', operator: 'lte', value: 10000 }],
      })
      .expect(201);
    expect(v2Res.body.version.version_number).toBe(2);

    const historicalCase = await request(app)
      .get(`/api/v1/cases/${caseId}`)
      .set('Authorization', `Bearer ${officerToken}`)
      .expect(200);
    expect(historicalCase.body.case.rule_version_id).toBe(evaluatedRuleVersionId);

    // 12. Super Admin reads append-only audit logs & consent history; non-admins are blocked
    const auditRes = await request(app)
      .get('/api/v1/audit')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(auditRes.body.audit_logs.length).toBeGreaterThan(3);
    expect(Array.isArray(auditRes.body.consents)).toBe(true);

    for (const tok of [officerToken, helperToken, citizenToken]) {
      await request(app).get('/api/v1/audit').set('Authorization', `Bearer ${tok}`).expect(403);
    }
  });

  it('allows Super Admin to create department accounts and Department Officers to provide humanized chatbot assistance', async () => {
    const { app } = setupTestApp();
    const adminToken = await loginAs(app, 'admin@demo.awaaz.local');
    const citizenToken = await loginAs(app, 'citizen@demo.awaaz.local');
    const citizenBToken = await loginAs(app, 'citizen-beta@demo.awaaz.local');

    // 1. Super Admin creates a new department
    const deptRes = await request(app)
      .post('/api/v1/workspaces/current/departments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Health & Relief Desk', code: 'HEALTH_DESK' })
      .expect(201);
    const deptId = deptRes.body.department.id as string;

    // Non-admin (citizen) CANNOT create department accounts
    await request(app)
      .post('/api/v1/admin/department-accounts')
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({
        email: 'unauth@demo.awaaz.local',
        password: 'Password123!',
        display_name: 'Unauthorized',
        role: 'officer',
      })
      .expect(403);

    // 2. Super Admin creates a Department Officer account directly
    const acctRes = await request(app)
      .post('/api/v1/admin/department-accounts')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: 'dept-officer@demo.awaaz.local',
        password: 'DeptPass123!',
        display_name: 'Kamran Ali (Department Staff)',
        role: 'officer',
        department_id: deptId,
        preferred_language: 'ur',
      })
      .expect(201);
    expect(acctRes.body.account.role).toBe('officer');
    expect(acctRes.body.account.department_id).toBe(deptId);

    // Newly created Department Officer logs in cleanly
    const newOfficerLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'dept-officer@demo.awaaz.local', password: 'DeptPass123!' })
      .expect(200);
    const deptOfficerToken = newOfficerLogin.body.access_token as string;

    // 3. Citizen escalates a chatbot question for humanized department assistance
    const escRes = await request(app)
      .post('/api/v1/assistance/requests')
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({
        citizen_question: 'How do I collect relief if I do not have a bank account?',
        chatbot_draft_answer: 'Policy did not cover cash pickup.',
        language: 'en',
        department_id: deptId,
      })
      .expect(201);
    const reqId = escRes.body.request.id as string;

    // Tenant B citizen CANNOT see Tenant A assistance requests
    const tenantBList = await request(app)
      .get('/api/v1/assistance/requests')
      .set('Authorization', `Bearer ${citizenBToken}`)
      .expect(200);
    expect(tenantBList.body.requests).toHaveLength(0);

    // 4. Department Officer sees the escalated question and sends a humanized reply + saves as chatbot guidance
    const respondRes = await request(app)
      .post(`/api/v1/assistance/requests/${reqId}/respond`)
      .set('Authorization', `Bearer ${deptOfficerToken}`)
      .send({
        humanized_reply:
          'You do not need a bank account. Once approved, you can visit the district camp with your mock reference slip.',
        save_as_guidance: true,
      })
      .expect(200);
    expect(respondRes.body.request.status).toBe('ANSWERED');
    expect(respondRes.body.guidance).toBeTruthy();

    // 5. Future chatbot query immediately returns the Department Officer's humanized guidance
    const ragAfter = await request(app)
      .post('/api/v1/rag/query')
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({
        question: 'collect relief without bank account',
        language: 'en',
      })
      .expect(200);
    expect(ragAfter.body.retrieval_mode).toBe('department_humanized_guidance');
    expect(ragAfter.body.answer).toContain('district camp');
  });

  it('strictly enforces workspace creation, membership, role permissions, anti-escalation, and cross-tenant isolation', async () => {
    const { app } = setupTestApp();
    const adminToken = await loginAs(app, 'admin@demo.awaaz.local');
    const officerToken = await loginAs(app, 'officer@demo.awaaz.local');
    const helperToken = await loginAs(app, 'helper@demo.awaaz.local');
    const citizenToken = await loginAs(app, 'citizen@demo.awaaz.local');
    const officerBToken = await loginAs(app, 'officer-beta@demo.awaaz.local');
    const citizenBToken = await loginAs(app, 'citizen-beta@demo.awaaz.local');

    // 1. Public registration cannot create workspaces or self-assign admin
    await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'sneaky@demo.awaaz.local',
        password: 'Password123!',
        display_name: 'Sneaky User',
        organization_name: 'Hijack Org',
      })
      .expect(400);

    // 2. Non-Super-Admin roles CANNOT create workspaces, manage members, or self-elevate
    for (const tok of [officerToken, helperToken, citizenToken]) {
      await request(app)
        .post('/api/v1/workspaces')
        .set('Authorization', `Bearer ${tok}`)
        .send({ name: 'Unauthorized Org', slug: `unauth-${Math.random().toString(36).slice(2, 7)}` })
        .expect(403);

      await request(app)
        .post('/api/v1/workspaces/current/members')
        .set('Authorization', `Bearer ${tok}`)
        .send({ email: 'citizen@demo.awaaz.local', role: 'admin' })
        .expect(403);

      await request(app)
        .get('/api/v1/workspaces/current/members')
        .set('Authorization', `Bearer ${tok}`)
        .expect(403);

      await request(app)
        .patch(`/api/v1/admin/members/${DEFAULT_USER_IDS.CITIZEN_A}/role`)
        .set('Authorization', `Bearer ${tok}`)
        .send({ role: 'admin' })
        .expect(403);

      await request(app)
        .patch('/api/v1/auth/me')
        .set('Authorization', `Bearer ${tok}`)
        .send({ role: 'admin' })
        .expect(400);
    }

    // 3. Citizens cannot access workspace listing, departments, or switch workspaces
    await request(app).get('/api/v1/workspaces').set('Authorization', `Bearer ${citizenToken}`).expect(403);
    await request(app).get('/api/v1/workspaces/current/departments').set('Authorization', `Bearer ${citizenToken}`).expect(403);
    await request(app)
      .patch('/api/v1/auth/me')
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({ default_organization_id: DEFAULT_ORG_IDS.PROVINCE_BETA })
      .expect(403);

    // 4. Super Admin creates Workspace C, adds existing user, assigns role, switches cleanly
    const wsRes = await request(app)
      .post('/api/v1/workspaces')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Sindh Relief Workspace', slug: 'sindh-relief-ws' })
      .expect(201);
    const wsCId = wsRes.body.workspace.id as string;

    // Creating Workspace C does NOT grant access to existing Workspace B
    await request(app)
      .get('/api/v1/workspaces/current/members')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Organization-Id', DEFAULT_ORG_IDS.PROVINCE_BETA)
      .expect(403);

    // Super Admin switches to Workspace C and adds existing officer@demo.awaaz.local
    await request(app)
      .post('/api/v1/workspaces/current/members')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Organization-Id', wsCId)
      .send({ email: 'officer@demo.awaaz.local', role: 'officer' })
      .expect(201);

    const wsCMembers = await request(app)
      .get('/api/v1/workspaces/current/members')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Organization-Id', wsCId)
      .expect(200);
    expect(wsCMembers.body.members).toHaveLength(2);

    // Officer can now access Workspace C (assigned) but STILL NOT Workspace B (unassigned)
    await request(app)
      .get('/api/v1/officer/cases')
      .set('Authorization', `Bearer ${officerToken}`)
      .set('X-Organization-Id', wsCId)
      .expect(200);

    await request(app)
      .get('/api/v1/officer/cases')
      .set('Authorization', `Bearer ${officerToken}`)
      .set('X-Organization-Id', DEFAULT_ORG_IDS.PROVINCE_BETA)
      .expect(403);

    // 5. Cross-tenant isolation: Workspace B case & document & audit cannot be read by Workspace A users
    const caseBRes = await request(app)
      .post('/api/v1/cases')
      .set('Authorization', `Bearer ${citizenBToken}`)
      .send({ scheme_id: 'MOCK_RELIEF_01', preferred_language: 'en', idempotency_key: 'ws-b-case-001' })
      .expect(201);
    const caseBId = caseBRes.body.case.id as string;

    const docBRes = await request(app)
      .post('/api/v1/documents')
      .set('Authorization', `Bearer ${citizenBToken}`)
      .field('case_id', caseBId)
      .field('document_type', 'mock_identity_document')
      .attach('file', Buffer.from('Tenant B Private Doc'), { filename: 'b-id.txt', contentType: 'text/plain' })
      .expect(201);
    const docBId = docBRes.body.document.id as string;

    // Workspace A officer & admin cannot read Workspace B's case, document, or audit logs
    await request(app).get(`/api/v1/cases/${caseBId}`).set('Authorization', `Bearer ${officerToken}`).expect(404);
    await request(app).get(`/api/v1/documents/${docBId}`).set('Authorization', `Bearer ${officerToken}`).expect(404);
    await request(app)
      .get('/api/v1/audit')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Organization-Id', DEFAULT_ORG_IDS.PROVINCE_BETA)
      .expect(403);

    // Workspace B officer CAN read Workspace B's own case & document
    await request(app).get(`/api/v1/cases/${caseBId}`).set('Authorization', `Bearer ${officerBToken}`).expect(200);
    await request(app).get(`/api/v1/documents/${docBId}`).set('Authorization', `Bearer ${officerBToken}`).expect(200);

    // 6. Super Admin can edit workspace, remove any user from workspace, and delete workspace
    //    Non-admins are strictly rejected (403) on edit, remove member, and delete workspace
    await request(app)
      .patch(`/api/v1/workspaces/${wsCId}`)
      .set('Authorization', `Bearer ${officerToken}`)
      .set('X-Organization-Id', wsCId)
      .send({ name: 'Hijacked' })
      .expect(403);

    await request(app)
      .delete(`/api/v1/workspaces/current/members/${DEFAULT_USER_IDS.ADMIN_A}`)
      .set('Authorization', `Bearer ${officerToken}`)
      .set('X-Organization-Id', wsCId)
      .expect(403);

    await request(app)
      .delete(`/api/v1/workspaces/${wsCId}`)
      .set('Authorization', `Bearer ${officerToken}`)
      .set('X-Organization-Id', wsCId)
      .expect(403);

    // Super Admin edits Workspace C
    const editRes = await request(app)
      .patch(`/api/v1/workspaces/${wsCId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Organization-Id', wsCId)
      .send({ name: 'Sindh Relief Updated', slug: 'sindh-relief-updated' })
      .expect(200);
    expect(editRes.body.workspace.name).toBe('Sindh Relief Updated');

    // Super Admin removes officer from Workspace C (cannot remove self -> 409)
    await request(app)
      .delete(`/api/v1/workspaces/current/members/${DEFAULT_USER_IDS.ADMIN_A}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Organization-Id', wsCId)
      .expect(409);

    await request(app)
      .delete(`/api/v1/workspaces/current/members/${DEFAULT_USER_IDS.OFFICER_A}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Organization-Id', wsCId)
      .expect(200);

    // Removed officer immediately loses access to Workspace C (403) while keeping Workspace A (200)
    await request(app)
      .get('/api/v1/officer/cases')
      .set('Authorization', `Bearer ${officerToken}`)
      .set('X-Organization-Id', wsCId)
      .expect(403);
    await request(app)
      .get('/api/v1/officer/cases')
      .set('Authorization', `Bearer ${officerToken}`)
      .set('X-Organization-Id', DEFAULT_ORG_IDS.RELIEF_DEMO)
      .expect(200);

    // Super Admin deletes Workspace C -> gets fallback Workspace A; cannot delete only remaining workspace (409)
    const delRes = await request(app)
      .delete(`/api/v1/workspaces/${wsCId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Organization-Id', wsCId)
      .expect(200);
    expect(delRes.body.deleted).toBe(true);
    expect(delRes.body.fallback_organization_id).toBe(DEFAULT_ORG_IDS.RELIEF_DEMO);

    await request(app)
      .delete(`/api/v1/workspaces/${DEFAULT_ORG_IDS.RELIEF_DEMO}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Organization-Id', DEFAULT_ORG_IDS.RELIEF_DEMO)
      .expect(409);
  });

  it('removes the separate Auditor role while keeping Audit Trail Super-Admin-only and blocking legacy auditor sessions', async () => {
    const { app, store } = setupTestApp();
    const adminToken = await loginAs(app, 'admin@demo.awaaz.local');
    const officerToken = await loginAs(app, 'officer@demo.awaaz.local');
    const helperToken = await loginAs(app, 'helper@demo.awaaz.local');
    const citizenToken = await loginAs(app, 'citizen@demo.awaaz.local');

    // 1. Removed auditor demo account cannot sign in
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'auditor@demo.awaaz.local', password: 'DemoPass123!' })
      .expect(401);

    // 2. Assigning 'auditor' role is rejected by schema validation (400) across all role-assignment endpoints
    await request(app)
      .post('/api/v1/workspaces/current/members')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'citizen@demo.awaaz.local', role: 'auditor' })
      .expect(400);

    await request(app)
      .patch(`/api/v1/admin/members/${DEFAULT_USER_IDS.CITIZEN_A}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'auditor' })
      .expect(400);

    await request(app)
      .post('/api/v1/admin/department-accounts')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: 'legacy-auditor@demo.awaaz.local',
        password: 'Password123!',
        display_name: 'Legacy Auditor',
        role: 'auditor',
      })
      .expect(400);

    // 3. Audit Trail is Super Admin only; existing audit records are preserved
    const auditRes = await request(app)
      .get('/api/v1/audit')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(Array.isArray(auditRes.body.audit_logs)).toBe(true);
    expect(auditRes.body.audit_logs.length).toBeGreaterThan(0);

    for (const tok of [officerToken, helperToken, citizenToken]) {
      await request(app).get('/api/v1/audit').set('Authorization', `Bearer ${tok}`).expect(403);
    }

    // 4. Legacy unmigrated 'auditor' membership row is safely blocked (403 ROLE_DEPRECATED, never elevated)
    await store.upsertMembership({
      organization_id: DEFAULT_ORG_IDS.RELIEF_DEMO,
      user_id: DEFAULT_USER_IDS.CITIZEN_A,
      role: 'auditor' as never,
      department_id: null,
    });
    const deprecatedRes = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${citizenToken}`)
      .expect(403);
    expect(deprecatedRes.body.error.code).toBe('ROLE_DEPRECATED');
  });

  it('supports secure phone-OTP citizen onboarding without duplicates, hides phone numbers, and requires explicit confirmation on submit', async () => {
    const { app } = setupTestApp();
    const adminToken = await loginAs(app, 'admin@demo.awaaz.local');
    const citizenAToken = await loginAs(app, 'citizen@demo.awaaz.local');

    // 1. Request OTP with Pakistani mobile format (normalized to E.164)
    const otpReq = await request(app)
      .post('/api/v1/auth/phone/request-otp')
      .send({ phone_number: '03001234567', preferred_language: 'sd' })
      .expect(200);
    expect(otpReq.body.challenge_id).toBeTruthy();
    expect(otpReq.body.masked_phone).toBe('+92***4567');
    expect(otpReq.body.delivery_mode).toBe('dev_local_preview');
    expect(otpReq.body.dev_otp_preview).toMatch(/^\d{6}$/);

    // 2. Wrong OTP is rejected (401) — unverified phone cannot create account
    await request(app)
      .post('/api/v1/auth/phone/verify-otp')
      .send({
        challenge_id: otpReq.body.challenge_id,
        phone_number: '03001234567',
        otp_code: '000000',
        display_name: 'Sajida Parveen',
        preferred_language: 'sd',
      })
      .expect(401);

    // 3. Valid OTP creates citizen account in default workspace (never elevated)
    const verifyRes = await request(app)
      .post('/api/v1/auth/phone/verify-otp')
      .send({
        challenge_id: otpReq.body.challenge_id,
        phone_number: '+923001234567',
        otp_code: otpReq.body.dev_otp_preview,
        display_name: 'Sajida Parveen',
        preferred_language: 'sd',
      })
      .expect(201);
    expect(verifyRes.body.account_status).toBe('created');
    expect(verifyRes.body.user.active_role).toBe('citizen');
    expect(verifyRes.body.user.preferred_language).toBe('sd');
    expect(verifyRes.body.user.phone_verified).toBe(true);
    expect(verifyRes.body.user.masked_phone).toBe('+92***4567');
    const newUserId = verifyRes.body.user.id as string;
    const newToken = verifyRes.body.access_token as string;

    // 4. Replaying consumed OTP is rejected (410)
    await request(app)
      .post('/api/v1/auth/phone/verify-otp')
      .send({
        challenge_id: otpReq.body.challenge_id,
        phone_number: '+923001234567',
        otp_code: otpReq.body.dev_otp_preview,
        display_name: 'Sajida Parveen',
      })
      .expect(410);

    // 5. Re-onboarding with same phone number signs into existing account (no duplicate created)
    const otpReq2 = await request(app)
      .post('/api/v1/auth/phone/request-otp')
      .send({ phone_number: '+923001234567', preferred_language: 'ur' })
      .expect(200);
    const signInRes = await request(app)
      .post('/api/v1/auth/phone/verify-otp')
      .send({
        challenge_id: otpReq2.body.challenge_id,
        phone_number: '+923001234567',
        otp_code: otpReq2.body.dev_otp_preview,
        preferred_language: 'ur',
      })
      .expect(200);
    expect(signInRes.body.account_status).toBe('existing_signed_in');
    expect(signInRes.body.user.id).toBe(newUserId);
    expect(signInRes.body.user.preferred_language).toBe('ur');

    // 6. Privacy check: phone_number is NEVER leaked in workspace member listings or other citizens' endpoints
    const membersRes = await request(app)
      .get('/api/v1/workspaces/current/members')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const matchingMembers = (membersRes.body.members as Array<Record<string, unknown>>).filter(
      (m) => m.user_id === newUserId,
    );
    expect(matchingMembers).toHaveLength(1);
    expect(matchingMembers[0]?.phone_number).toBeUndefined();

    // 7. Conversational draft, correction, explicit confirmation gate, and reference number on submit
    await request(app)
      .post('/api/v1/consent')
      .set('Authorization', `Bearer ${newToken}`)
      .send({ consent_type: 'processing', permissions: ['application_processing'] })
      .expect(201);

    const caseRes = await request(app)
      .post('/api/v1/cases')
      .set('Authorization', `Bearer ${newToken}`)
      .send({ scheme_id: 'MOCK_RELIEF_01', preferred_language: 'sd', idempotency_key: 'onboard-case-001' })
      .expect(201);
    const caseId = caseRes.body.case.id as string;

    // Another citizen cannot read this onboarded citizen's draft
    await request(app).get(`/api/v1/cases/${caseId}`).set('Authorization', `Bearer ${citizenAToken}`).expect(403);

    await request(app)
      .patch(`/api/v1/cases/${caseId}/answers`)
      .set('Authorization', `Bearer ${newToken}`)
      .send({
        answers: [
          { field_name: 'full_name', field_value: 'Sajida Parveen', source: 'text', confirmed_by_citizen: true },
          { field_name: 'mock_identity_reference', field_value: 'MOCK-ID-1003', source: 'text', confirmed_by_citizen: true },
          { field_name: 'district', field_value: 'Sukkur', source: 'text', confirmed_by_citizen: true },
          { field_name: 'household_size', field_value: 4, source: 'text', confirmed_by_citizen: true },
          { field_name: 'monthly_income', field_value: 17000, source: 'text', confirmed_by_citizen: true },
          { field_name: 'employment_status', field_value: 'self_employed', source: 'text', confirmed_by_citizen: true },
          { field_name: 'relief_reason', field_value: 'Flood damage to home', source: 'text', confirmed_by_citizen: true },
        ],
      })
      .expect(200);

    // Explicit confirmation false is strictly rejected (400)
    await request(app)
      .post(`/api/v1/cases/${caseId}/submit`)
      .set('Authorization', `Bearer ${newToken}`)
      .send({ explicit_confirmation: false })
      .expect(400);

    // Explicit confirmation true submits and returns reference_number
    const submitRes = await request(app)
      .post(`/api/v1/cases/${caseId}/submit`)
      .set('Authorization', `Bearer ${newToken}`)
      .send({ explicit_confirmation: true })
      .expect(200);
    expect(submitRes.body.reference_number).toBe(`AWZ-${caseId.slice(0, 8).toUpperCase()}`);
    expect(submitRes.body.case.submitted_at).toBeTruthy();
  });

  it('verifies Expanded MCP Server (13 tools), Autonomous Agentic Cognitive Loop (Pillars 1-5), Role Routing, Rollback/Edit, Status, Officer Q&A, Escalations, Audit Trail, and Telephony Webhooks', async () => {
    const { app } = setupTestApp();

    // 1. MCP Server tools/list exposes all 13 required tools
    const listRes = await request(app)
      .post('/api/v1/mcp')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
      .expect(200);
    const toolNames = (listRes.body.result.tools as Array<{ name: string }>).map((t) => t.name);
    expect(toolNames).toEqual([
      'lookup_citizen',
      'submit_relief_claim',
      'get_claim_status',
      'check_suspicious_message',
      'query_policy_rag',
      'update_consent',
      'extract_document_info',
      'register_citizen_voice_account',
      'login_citizen_voice_account',
      'escalate_to_human_admin',
      'get_my_applications_status',
      'ask_department_officer',
      'get_officer_messages',
      'rag_universal_search',
      'rag_save_learned_correction',
      'check_duplicate_and_name_variants',
      'get_my_consent_status',
      'update_granular_consent',
      'withdraw_all_consent',
      'analyze_document_authenticity',
    ]);

    // 2. MCP lookup_citizen finds synthetic identity MOCK-ID-1001
    const lookupRes = await request(app)
      .post('/api/v1/mcp')
      .send({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'lookup_citizen', arguments: { identifier: 'MOCK-ID-1001' } },
      })
      .expect(200);
    expect(lookupRes.body.result.structuredContent.found).toBe(true);

    // 3. MCP check_suspicious_message flags fake OTP + fee scam as HIGH risk
    const scamRes = await request(app)
      .post('/api/v1/mcp')
      .send({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'check_suspicious_message',
          arguments: {
            message_text: 'Congratulations! You won 25000 BISP prize. Send your OTP code and 500 PKR fee to http://bit.ly/fake',
            sender: '+923331112233',
          },
        },
      })
      .expect(200);
    expect(scamRes.body.result.structuredContent.is_suspicious).toBe(true);
    expect(scamRes.body.result.structuredContent.risk_level).toBe('HIGH');

    // 4. MCP query_policy_rag refuses out-of-domain questions and answers in-domain policy questions
    const oodRes = await request(app)
      .post('/api/v1/mcp')
      .send({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'query_policy_rag', arguments: { question: 'Who won the cricket match?' } },
      })
      .expect(200);
    expect(oodRes.body.result.structuredContent.in_domain).toBe(false);

    const inDomainRes = await request(app)
      .post('/api/v1/mcp')
      .send({
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'query_policy_rag', arguments: { question: 'What is the monthly income threshold?' } },
      })
      .expect(200);
    expect(inDomainRes.body.result.structuredContent.in_domain).toBe(true);

    // 5. Pillar 1 & 3: Zero-Touch Language Selection -> Auto-Navigate Auth -> Strict Validation -> Voice Signup -> Open Hub
    const tLang = await request(app)
      .post('/api/v1/voice/session')
      .send({ transcript: 'Urdu', workflow_stage: 'LANGUAGE_SELECT', synthesize_audio: false })
      .expect(200);
    expect(tLang.body.detected_language).toBe('ur');
    expect(tLang.body.workflow_stage).toBe('AUTH_GATE');
    expect(tLang.body.ui_action).toBe('NAVIGATE_AUTH');
    const sid = tLang.body.session_id as string;

    // RBAC Check: Unauthenticated user trying to check claim status is strictly DENIED
    const tDenied = await request(app)
      .post('/api/v1/voice/session')
      .send({ session_id: sid, transcript: 'Check my claim status', synthesize_audio: false })
      .expect(200);
    expect(tDenied.body.access_control_decision.decision).toBe('DENIED');

    // Voice Signup: Name -> Invalid CNIC -> Invalid Phone -> Valid 13-digit CNIC -> Valid Phone -> Valid 4-digit PIN
    const tName = await request(app)
      .post('/api/v1/voice/session')
      .send({ session_id: sid, transcript: 'Mera naam Fatima Bibi hai', synthesize_audio: false })
      .expect(200);
    expect(tName.body.auth_draft.full_name).toBe('Fatima Bibi');

    const tBadCnic = await request(app)
      .post('/api/v1/voice/session')
      .send({ session_id: sid, transcript: '42101-123', synthesize_audio: false })
      .expect(200);
    expect(tBadCnic.body.validation_errors.some((e: { field: string }) => e.field === 'cnic')).toBe(true);
    expect(tBadCnic.body.auth_draft.cnic).toBe('');

    const tGoodCnic = await request(app)
      .post('/api/v1/voice/session')
      .send({ session_id: sid, transcript: '42101-7654321-2', synthesize_audio: false })
      .expect(200);
    expect(tGoodCnic.body.auth_draft.cnic).toBe('42101-7654321-2');

    const tBadPhone = await request(app)
      .post('/api/v1/voice/session')
      .send({ session_id: sid, transcript: '9999', synthesize_audio: false })
      .expect(200);
    expect(tBadPhone.body.validation_errors.some((e: { field: string }) => e.field === 'phone')).toBe(true);
    expect(tBadPhone.body.auth_draft.phone).toBe('');

    const tGoodPhone = await request(app)
      .post('/api/v1/voice/session')
      .send({ session_id: sid, transcript: '03009876543', synthesize_audio: false })
      .expect(200);
    expect(tGoodPhone.body.auth_draft.phone).toBe('+923009876543');

    const tPin = await request(app)
      .post('/api/v1/voice/session')
      .send({ session_id: sid, transcript: '4567', synthesize_audio: false })
      .expect(200);
    expect(tPin.body.workflow_stage).toBe('AGENT_HUB');
    expect(tPin.body.ui_action).toBe('NAVIGATE_HUB');
    expect(tPin.body.auth_session?.access_token).toBeTruthy();
    expect(
      tPin.body.mcp_tools_called.some((c: { tool_name: string }) => c.tool_name === 'register_citizen_voice_account'),
    ).toBe(true);
    const voiceCitizenToken = tPin.body.auth_session.access_token as string;

    // 6. Pillar 2: Mood-Swing Interruption (Scam Check) + Persistent Working Memory Suspend & Resume + Strict Amount Validation
    const tStartRelief = await request(app)
      .post('/api/v1/voice/session')
      .set('Authorization', `Bearer ${voiceCitizenToken}`)
      .send({ session_id: sid, transcript: 'Mujhe relief ki darkhwast deni hai', synthesize_audio: false })
      .expect(200);
    expect(tStartRelief.body.workflow_stage).toBe('RELIEF_FORM');
    expect(tStartRelief.body.form_state.name).toBe('Fatima Bibi');
    expect(tStartRelief.body.form_state.cnic).toBe('42101-7654321-2');

    const tDist = await request(app)
      .post('/api/v1/voice/session')
      .set('Authorization', `Bearer ${voiceCitizenToken}`)
      .send({ session_id: sid, transcript: 'Dadu', synthesize_audio: false })
      .expect(200);
    expect(tDist.body.form_state.district).toBe('Dadu');

    // Mid-form interruption: Scam SMS check suspends the active relief_form draft!
    const tInterrupt = await request(app)
      .post('/api/v1/voice/session')
      .set('Authorization', `Bearer ${voiceCitizenToken}`)
      .send({
        session_id: sid,
        transcript: 'Ruko, mujhe 8171 se fake OTP aur Rs 500 fee ka message aaya hai, check karo scam hai?',
        synthesize_audio: false,
      })
      .expect(200);
    expect(tInterrupt.body.memory_action).toBe('SUSPEND_TASK');
    expect(tInterrupt.body.suspended_tasks.length).toBe(1);
    expect(tInterrupt.body.ui_action).toBe('SHOW_SCAM_ALERT');
    expect(
      tInterrupt.body.mcp_tools_called.some((c: { tool_name: string }) => c.tool_name === 'check_suspicious_message'),
    ).toBe(true);

    // Resume suspended task: Name, CNIC, and District ('Dadu') MUST all remain intact!
    const tResume = await request(app)
      .post('/api/v1/voice/session')
      .set('Authorization', `Bearer ${voiceCitizenToken}`)
      .send({ session_id: sid, transcript: 'Haan wapis form mukammal karo', synthesize_audio: false })
      .expect(200);
    expect(tResume.body.form_state.name).toBe('Fatima Bibi');
    expect(tResume.body.form_state.cnic).toBe('42101-7654321-2');
    expect(tResume.body.form_state.district).toBe('Dadu');

    // Fill Monthly Income (valid) -> Try Invalid Requested Amount (-500 & 999999) -> Valid Amount -> Reason -> Consent
    const tIncome = await request(app)
      .post('/api/v1/voice/session')
      .set('Authorization', `Bearer ${voiceCitizenToken}`)
      .send({ session_id: sid, transcript: '12000', synthesize_audio: false })
      .expect(200);
    expect(tIncome.body.form_state.monthly_income).toBe(12000);

    const tBadAmt1 = await request(app)
      .post('/api/v1/voice/session')
      .set('Authorization', `Bearer ${voiceCitizenToken}`)
      .send({ session_id: sid, transcript: '-500', synthesize_audio: false })
      .expect(200);
    expect(tBadAmt1.body.validation_errors.some((e: { field: string }) => e.field === 'amount')).toBe(true);
    expect(tBadAmt1.body.form_state.amount).toBeNull();

    const tBadAmt2 = await request(app)
      .post('/api/v1/voice/session')
      .set('Authorization', `Bearer ${voiceCitizenToken}`)
      .send({ session_id: sid, transcript: '999999', synthesize_audio: false })
      .expect(200);
    expect(tBadAmt2.body.validation_errors.some((e: { field: string }) => e.field === 'amount')).toBe(true);
    expect(tBadAmt2.body.form_state.amount).toBeNull();

    const tGoodAmt = await request(app)
      .post('/api/v1/voice/session')
      .set('Authorization', `Bearer ${voiceCitizenToken}`)
      .send({ session_id: sid, transcript: '15000', synthesize_audio: false })
      .expect(200);
    expect(tGoodAmt.body.form_state.amount).toBe(15000);

    const tReason = await request(app)
      .post('/api/v1/voice/session')
      .set('Authorization', `Bearer ${voiceCitizenToken}`)
      .send({ session_id: sid, transcript: 'Sailab se mera ghar tabah ho gaya hai', synthesize_audio: false })
      .expect(200);
    expect(tReason.body.form_state.reason).toContain('Sailab');
    expect(tReason.body.ui_action).toBe('ASK_CONFIRMATION');

    const tSubmit = await request(app)
      .post('/api/v1/voice/session')
      .set('Authorization', `Bearer ${voiceCitizenToken}`)
      .send({ session_id: sid, transcript: 'Haan main ijazat deti hoon, mera claim submit kar dein', synthesize_audio: false })
      .expect(200);
    expect(tSubmit.body.ui_action).toBe('SHOW_RECEIPT');
    expect(tSubmit.body.form_state.reference_number).toMatch(/^AWZ-[A-Z0-9]{8}$/);
    expect(tSubmit.body.form_state.claim_status).toBe('READY_FOR_OFFICER');
    expect(tSubmit.body.mcp_tools_called.some((c: { tool_name: string }) => c.tool_name === 'update_consent')).toBe(true);
    expect(tSubmit.body.mcp_tools_called.some((c: { tool_name: string }) => c.tool_name === 'submit_relief_claim')).toBe(
      true,
    );

    // 7. Pillar 5: Out-of-Scope Capability Boundary & Graceful Human Admin Escalation
    const tOutScope = await request(app)
      .post('/api/v1/voice/session')
      .set('Authorization', `Bearer ${voiceCitizenToken}`)
      .send({
        session_id: sid,
        transcript: 'Mera claim khud abhi approve kar ke mere bank mein 50,000 transfer kar do',
        synthesize_audio: false,
      })
      .expect(200);
    expect(tOutScope.body.capability_check).toBe('OUT_OF_SCOPE_ESCALATED');
    expect(tOutScope.body.ui_action).toBe('OFFER_ESCALATION');
    expect(tOutScope.body.escalation?.assigned_admin).toBe('Officer Hamza');

    const tConfirmEsc = await request(app)
      .post('/api/v1/voice/session')
      .set('Authorization', `Bearer ${voiceCitizenToken}`)
      .send({ session_id: sid, transcript: 'Haan forward kar dein', synthesize_audio: false })
      .expect(200);
    expect(tConfirmEsc.body.ui_action).toBe('SHOW_ESCALATION_TICKET');
    expect(tConfirmEsc.body.escalation?.ticket_reference).toMatch(/^ESC-[A-Z0-9]{6}$/);
    expect(
      tConfirmEsc.body.mcp_tools_called.some((c: { tool_name: string }) => c.tool_name === 'escalate_to_human_admin'),
    ).toBe(true);

    // 8. Pillar 4 & 5: Admin Ayesha (admin_ayesha / admin123) inspects Escalations & Agent Reasoning Audit Trail
    const ayeshaLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin_ayesha', password: 'admin123' })
      .expect(200);
    const ayeshaToken = ayeshaLogin.body.access_token as string;

    const escList = await request(app)
      .get('/api/v1/admin/escalations')
      .set('Authorization', `Bearer ${ayeshaToken}`)
      .expect(200);
    expect(
      (escList.body.escalations as Array<{ ticket_reference: string }>).some(
        (e) => e.ticket_reference === tConfirmEsc.body.escalation.ticket_reference,
      ),
    ).toBe(true);

    const auditTrail = await request(app)
      .get(`/api/v1/admin/agent-audit-trail?session_id=${sid}`)
      .set('Authorization', `Bearer ${ayeshaToken}`)
      .expect(200);
    expect(auditTrail.body.logs.length).toBeGreaterThanOrEqual(10);
    expect(
      (auditTrail.body.logs as Array<{ capability_check: string }>).some(
        (l) => l.capability_check === 'OUT_OF_SCOPE_ESCALATED',
      ),
    ).toBe(true);
    expect(
      (auditTrail.body.logs as Array<{ memory_snapshot_diff: { action: string } }>).some(
        (l) => l.memory_snapshot_diff.action === 'SUSPEND_TASK',
      ),
    ).toBe(true);

    // 9. Phase 2-4 Upgrade: Field Rollback & Targeted Edit, Application Status, Direct Officer Inquiry Round-Trip, Staff Mixed-Language Login
    const tStatus = await request(app)
      .post('/api/v1/voice/session')
      .set('Authorization', `Bearer ${voiceCitizenToken}`)
      .send({ session_id: sid, transcript: 'Meri application ka status batao', synthesize_audio: false })
      .expect(200);
    expect(tStatus.body.ui_action).toBe('SHOW_APPLICATION_STATUS');
    expect(
      tStatus.body.mcp_tools_called.some((c: { tool_name: string }) => c.tool_name === 'get_my_applications_status'),
    ).toBe(true);
    expect(tStatus.body.applications_status?.length).toBeGreaterThanOrEqual(1);

    // Direct Department Officer Inquiry via Voice MCP -> Officer Hamza replies -> Citizen hears reply via MCP
    const tAskOfficer = await request(app)
      .post('/api/v1/voice/session')
      .set('Authorization', `Bearer ${voiceCitizenToken}`)
      .send({
        session_id: sid,
        transcript: 'Direct department officer se poocho ke meri application kab approve hogi?',
        synthesize_audio: false,
      })
      .expect(200);
    expect(tAskOfficer.body.ui_action).toBe('SHOW_OFFICER_INQUIRY');
    expect(tAskOfficer.body.officer_inquiry_created?.tracking_reference).toMatch(/^INQ-[A-Z0-9]{6}$/);
    const inquiryId = tAskOfficer.body.officer_inquiry_created.id as string;

    // Staff voice mixed-language routing: asks account created/not FIRST (same explicit check as Citizen!), then login as officer_hamza / officer123
    const tStaffRole = await request(app)
      .post('/api/v1/voice/session')
      .send({ workflow_stage: 'HOME_WELCOME', transcript: 'Main department officer hoon', synthesize_audio: false })
      .expect(200);
    expect(tStaffRole.body.workflow_stage).toBe('CITIZEN_ACCOUNT_CHECK');
    expect(tStaffRole.body.ui_action).toBe('STAY_HOME');
    expect(tStaffRole.body.navigate_to).toBeNull();

    const tStaffHasAcc = await request(app)
      .post('/api/v1/voice/session')
      .send({
        session_id: tStaffRole.body.session_id,
        transcript: 'Haan mera account bana hua hai',
        synthesize_audio: false,
      })
      .expect(200);
    expect(tStaffHasAcc.body.ui_action).toBe('NAVIGATE_LOGIN');
    expect(tStaffHasAcc.body.navigate_to).toBe('/login');

    const tStaffLogin = await request(app)
      .post('/api/v1/voice/session')
      .send({
        session_id: tStaffRole.body.session_id,
        transcript: 'Mera username officer_hamza aur password officer123 hai',
        synthesize_audio: false,
      })
      .expect(200);
    expect(tStaffLogin.body.ui_action).toBe('NAVIGATE_OFFICER_PORTAL');
    expect(tStaffLogin.body.navigate_to).toBe('/officer');
    const hamzaToken = tStaffLogin.body.auth_session.access_token as string;

    // Officer Hamza sees inquiry and sends official reply
    const officerInbox = await request(app)
      .get('/api/v1/officer-inquiries')
      .set('Authorization', `Bearer ${hamzaToken}`)
      .expect(200);
    expect((officerInbox.body.inquiries as Array<{ id: string }>).some((i) => i.id === inquiryId)).toBe(true);

    await request(app)
      .post(`/api/v1/officer-inquiries/${inquiryId}/reply`)
      .set('Authorization', `Bearer ${hamzaToken}`)
      .send({ officer_reply: 'Aapki verification 2 din mein mukammal ho jayegi.' })
      .expect(200);

    // Citizen asks "Officer ka jawab aaya?" -> reads official reply via get_officer_messages MCP tool!
    const tOfficerReply = await request(app)
      .post('/api/v1/voice/session')
      .set('Authorization', `Bearer ${voiceCitizenToken}`)
      .send({ session_id: sid, transcript: 'Officer ka jawab aaya?', synthesize_audio: false })
      .expect(200);
    expect(
      tOfficerReply.body.mcp_tools_called.some((c: { tool_name: string }) => c.tool_name === 'get_officer_messages'),
    ).toBe(true);
    expect(tOfficerReply.body.agent_reply_text).toContain('Aapki verification 2 din mein mukammal ho jayegi.');

    // Field Rollback & Targeted Field Edit check on a fresh relief form session
    const tEditStart = await request(app)
      .post('/api/v1/voice/session')
      .set('Authorization', `Bearer ${voiceCitizenToken}`)
      .send({ transcript: 'Mujhe relief ki darkhwast deni hai', synthesize_audio: false })
      .expect(200);
    const editSid = tEditStart.body.session_id as string;
    await request(app)
      .post('/api/v1/voice/session')
      .set('Authorization', `Bearer ${voiceCitizenToken}`)
      .send({ session_id: editSid, transcript: 'Lahore', synthesize_audio: false })
      .expect(200);
    await request(app)
      .post('/api/v1/voice/session')
      .set('Authorization', `Bearer ${voiceCitizenToken}`)
      .send({ session_id: editSid, transcript: '15000', synthesize_audio: false })
      .expect(200);
    const tRollback = await request(app)
      .post('/api/v1/voice/session')
      .set('Authorization', `Bearer ${voiceCitizenToken}`)
      .send({ session_id: editSid, transcript: 'Pichli field galat ho gayi, peeche jao', synthesize_audio: false })
      .expect(200);
    expect(tRollback.body.editing_field).toBe('monthly_income');
    const tFixIncome = await request(app)
      .post('/api/v1/voice/session')
      .set('Authorization', `Bearer ${voiceCitizenToken}`)
      .send({ session_id: editSid, transcript: '12000', synthesize_audio: false })
      .expect(200);
    expect(tFixIncome.body.form_state.monthly_income).toBe(12000);
    expect(tFixIncome.body.form_state.district).toBe('Lahore');
    const tEditDist = await request(app)
      .post('/api/v1/voice/session')
      .set('Authorization', `Bearer ${voiceCitizenToken}`)
      .send({ session_id: editSid, transcript: 'Mera district edit karke Dadu kar do', synthesize_audio: false })
      .expect(200);
    expect(tEditDist.body.form_state.district).toBe('Dadu');
    expect(tEditDist.body.form_state.monthly_income).toBe(12000);

    // 10. Phase 4: Telephony TwiML webhooks (/api/v1/telephony/incoming & /api/v1/telephony/gather)
    const twimlIncoming = await request(app)
      .post('/api/v1/telephony/incoming')
      .send({ CallSid: 'CA-TEST-001', From: '+923001234567' })
      .expect(200);
    expect(twimlIncoming.text).toContain('<Response>');
    expect(twimlIncoming.text).toContain('<Gather');

    const keypadGather = await request(app)
      .post('/api/v1/telephony/gather?format=json')
      .set('Accept', 'application/json')
      .send({ CallSid: 'CA-TEST-001', Digits: '1', format: 'json' })
      .expect(200);
    expect(keypadGather.body.form_state.cnic).toBe('MOCK-ID-1001');
    expect(keypadGather.body.twiml).toContain('<Response>');
  });

  it('verifies 3-Layer Cognitive Architecture: Messy Colloquial NLU, Exact Roman Urdu Natural Rollback, Negated Inline Correction, Sliding Window, and Self-Learning Correction RAG', async () => {
    const { app } = setupTestApp();

    // 1. Messy colloquial signup name extraction (zero filler leakage!)
    const t0 = await request(app)
      .post('/api/v1/voice/session')
      .send({ workflow_stage: 'LANGUAGE_SELECT', transcript: 'Urdu', synthesize_audio: false })
      .expect(200);
    const sid = t0.body.session_id as string;

    const tName = await request(app)
      .post('/api/v1/voice/session')
      .send({
        session_id: sid,
        transcript: 'yr mera naam basically Uzair Ibrahim haiga ji',
        synthesize_audio: false,
      })
      .expect(200);
    expect(tName.body.auth_draft.full_name).toBe('Uzair Ibrahim');
    expect(tName.body.rag_memories_retrieved?.length).toBeGreaterThan(0);

    await request(app)
      .post('/api/v1/voice/session')
      .send({ session_id: sid, transcript: '42101-8887776-1', synthesize_audio: false })
      .expect(200);
    await request(app)
      .post('/api/v1/voice/session')
      .send({ session_id: sid, transcript: '03001122334', synthesize_audio: false })
      .expect(200);
    const tPin = await request(app)
      .post('/api/v1/voice/session')
      .send({ session_id: sid, transcript: '5678', synthesize_audio: false })
      .expect(200);
    expect(tPin.body.workflow_stage).toBe('AGENT_HUB');
    const citizenToken = tPin.body.auth_session.access_token as string;

    // 2. Start relief form & speak messy multi-field Pakistani colloquial sentence
    await request(app)
      .post('/api/v1/voice/session')
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({ session_id: sid, transcript: 'Mujhe relief ki darkhwast deni hai', synthesize_audio: false })
      .expect(200);

    const tMessyMulti = await request(app)
      .post('/api/v1/voice/session')
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({
        session_id: sid,
        transcript: 'bhai main zila Multan ke paas rehta hoon aur meri mahana amdan taqreeban saade barah hazaar banti hai',
        synthesize_audio: false,
      })
      .expect(200);
    expect(tMessyMulti.body.form_state.district).toBe('Multan');
    expect(tMessyMulti.body.form_state.monthly_income).toBe(12500);
    expect(tMessyMulti.body.field_fill_history[tMessyMulti.body.field_fill_history.length - 1]).toBe('monthly_income');

    // 3. Exact user failing natural Roman Urdu rollback sentence!
    const tRollback = await request(app)
      .post('/api/v1/voice/session')
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({
        session_id: sid,
        transcript: 'yr is field main tumne ye cheez sahi nhi likhi wapis jao us field main',
        synthesize_audio: false,
      })
      .expect(200);
    expect(tRollback.body.editing_field).toBe('monthly_income');
    expect(tRollback.body.agent_reply_text).toContain('12500');
    expect(tRollback.body.learned_memory_saved?.resolved_intent).toBe('ROLLBACK_LAST_FIELD');

    // 4. Colloquial income correction ("pachis hazaar" -> 25000), preserving Multan
    const tFixIncome = await request(app)
      .post('/api/v1/voice/session')
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({
        session_id: sid,
        transcript: 'asal mein meri amdan pachis hazaar hai',
        synthesize_audio: false,
      })
      .expect(200);
    expect(tFixIncome.body.form_state.monthly_income).toBe(25000);
    expect(tFixIncome.body.form_state.district).toBe('Multan');
    expect(tFixIncome.body.editing_field).toBeNull();
    expect(tFixIncome.body.learned_memory_saved?.target_field).toBe('monthly_income');

    // 5. Inline colloquial negated correction ("Multan nahi Sukkur se hoon" -> district: "Sukkur", keeps 25000)
    const tInlineFix = await request(app)
      .post('/api/v1/voice/session')
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({
        session_id: sid,
        transcript: 'bhai shehar bhi ghalat pakar liya tumne main Multan nahi Sukkur se hoon',
        synthesize_audio: false,
      })
      .expect(200);
    expect(tInlineFix.body.detected_language).toBe('ur');
    expect(tInlineFix.body.form_state.district).toBe('Sukkur');
    expect(tInlineFix.body.form_state.monthly_income).toBe(25000);
    expect(tInlineFix.body.learned_memory_saved?.target_field).toBe('district');

    // 6. Colloquial amount ("saade chaar hazaar" -> 4500) + clean reason -> verbal confirm -> submit
    const tAmtReason = await request(app)
      .post('/api/v1/voice/session')
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({
        session_id: sid,
        transcript: 'mujhe saade chaar hazaar rupay chahiye q ke barish se mere ghar ki deewar gir gayi hai',
        synthesize_audio: false,
      })
      .expect(200);
    expect(tAmtReason.body.form_state.amount).toBe(4500);
    expect(tAmtReason.body.form_state.reason).toBe('Barish se mere ghar ki deewar gir gayi hai');
    expect(tAmtReason.body.ui_action).toBe('ASK_CONFIRMATION');

    const tSubmit = await request(app)
      .post('/api/v1/voice/session')
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({
        session_id: sid,
        transcript: 'Haan bilkul sab theek hai meri darkhwast submit kar do',
        synthesize_audio: false,
      })
      .expect(200);
    expect(tSubmit.body.ui_action).toBe('SHOW_RECEIPT');
    expect(tSubmit.body.form_state.reference_number).toMatch(/^AWZ-[A-Z0-9]{8}$/);

    // 7. Admin verifies Self-Learning RAG Memory & Agent Audit Trail
    const ayeshaLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin_ayesha', password: 'admin123' })
      .expect(200);
    const ayeshaToken = ayeshaLogin.body.access_token as string;

    const ragMemRes = await request(app)
      .get('/api/v1/admin/nlu-rag-memory')
      .set('Authorization', `Bearer ${ayeshaToken}`)
      .expect(200);
    expect(ragMemRes.body.seeded_count).toBeGreaterThanOrEqual(60);
    expect(ragMemRes.body.learned_count).toBeGreaterThanOrEqual(3);
    expect(ragMemRes.body.total_hits).toBeGreaterThan(0);

    const auditRes = await request(app)
      .get(`/api/v1/admin/agent-audit-trail?session_id=${sid}`)
      .set('Authorization', `Bearer ${ayeshaToken}`)
      .expect(200);
    const logs = auditRes.body.logs as Array<{
      rag_memories_retrieved?: unknown[];
      learned_memory_saved?: { resolved_intent: string } | null;
      semantic_nlu_summary?: { primary_intent: string } | null;
    }>;
    expect(logs.some((l) => Array.isArray(l.rag_memories_retrieved) && l.rag_memories_retrieved.length > 0)).toBe(true);
    expect(logs.some((l) => Boolean(l.learned_memory_saved?.resolved_intent))).toBe(true);
    expect(logs.some((l) => l.semantic_nlu_summary?.primary_intent === 'ROLLBACK_LAST_FIELD')).toBe(true);
  });

  it('verifies LangGraph Multi-Node Agent, Real MCP SDK Protocol Discovery (15 tools), Universal RAG (5 KBs), Hard Language Lock Under Heavy Loanwords & Instant 1-Turn Explicit Switching', async () => {
    const { app } = setupTestApp();

    // 1. Real MCP SDK protocol tools/list exposes all 15 tools (including Universal RAG tools)
    const mcpList = await request(app).get('/api/v1/mcp/tools').expect(200);
    expect(mcpList.body.sdk).toBe('@modelcontextprotocol/sdk');
    expect(mcpList.body.tools.length).toBeGreaterThanOrEqual(20);

    // 2. Hard Language Lock under heavy Urdu + English loanword code-switching across 6 consecutive turns!
    const tLockInit = await request(app)
      .post('/api/v1/voice/session')
      .send({ workflow_stage: 'HOME_WELCOME', language: 'ur', language_explicit_switch: true, synthesize_audio: false })
      .expect(200);
    const sid = tLockInit.body.session_id as string;
    expect(tLockInit.body.locked_language).toBe('ur');
    expect(tLockInit.body.langgraph_nodes_visited).toContain('node_language_and_input');
    expect(tLockInit.body.langgraph_nodes_visited).toContain('node_universal_rag');
    expect(tLockInit.body.langgraph_nodes_visited).toContain('node_self_reflect_and_language_guard');

    const t1 = await request(app)
      .post('/api/v1/voice/session')
      .send({ session_id: sid, transcript: 'Main aam user hoon, account login karna hai', synthesize_audio: false })
      .expect(200);
    expect(t1.body.locked_language).toBe('ur');
    expect(t1.body.navigate_to).toBe('/login');
    expect(/[\u0600-\u06FF]/.test(t1.body.agent_reply_text)).toBe(true);

    const t2 = await request(app)
      .post('/api/v1/voice/session')
      .send({ session_id: sid, transcript: 'Username citizen_zainab aur password citizen123 hai', synthesize_audio: false })
      .expect(200);
    expect(t2.body.locked_language).toBe('ur');
    expect(t2.body.auth_session?.access_token).toBeTruthy();
    const zainabToken = t2.body.auth_session.access_token as string;

    const t3 = await request(app)
      .post('/api/v1/voice/session')
      .set('Authorization', `Bearer ${zainabToken}`)
      .send({
        session_id: sid,
        transcript: 'Mujhe relief form fill karna hai, mera district Multan aur monthly income 15 hazaar hai',
        synthesize_audio: false,
      })
      .expect(200);
    expect(t3.body.locked_language).toBe('ur');
    expect(t3.body.form_state.district).toBe('Multan');
    expect(t3.body.form_state.monthly_income).toBe(15000);

    const t4a = await request(app)
      .post('/api/v1/voice/session')
      .set('Authorization', `Bearer ${zainabToken}`)
      .send({
        session_id: sid,
        transcript: 'yr is field main tumne ye cheez sahi nhi likhi wapis jao',
        synthesize_audio: false,
      })
      .expect(200);
    expect(t4a.body.locked_language).toBe('ur');
    expect(t4a.body.editing_field).toBe('monthly_income');

    const t4b = await request(app)
      .post('/api/v1/voice/session')
      .set('Authorization', `Bearer ${zainabToken}`)
      .send({ session_id: sid, transcript: '12000', synthesize_audio: false })
      .expect(200);
    expect(t4b.body.locked_language).toBe('ur');
    expect(t4b.body.form_state.monthly_income).toBe(12000);
    expect(t4b.body.form_state.district).toBe('Multan');

    const t5 = await request(app)
      .post('/api/v1/voice/session')
      .set('Authorization', `Bearer ${zainabToken}`)
      .send({ session_id: sid, transcript: 'Mera status check karo aur scam OTP policy batao', synthesize_audio: false })
      .expect(200);
    expect(t5.body.locked_language).toBe('ur');
    expect(t5.body.langgraph_nodes_visited).toContain('node_mcp_tool_executor');
    expect(t5.body.mcp_tools_called.length).toBeGreaterThanOrEqual(2);
    expect(/[\u0600-\u06FF]/.test(t5.body.agent_reply_text)).toBe(true);

    // 3. Instant 1-turn explicit switch to English -> Pure English stickiness -> Instant 1-turn switch back to Urdu!
    const tSwitchEn = await request(app)
      .post('/api/v1/voice/session')
      .set('Authorization', `Bearer ${zainabToken}`)
      .send({ session_id: sid, transcript: 'Please switch to English', synthesize_audio: false })
      .expect(200);
    expect(tSwitchEn.body.locked_language).toBe('en');
    expect(tSwitchEn.body.language_guard_status).toBe('EXPLICIT_SWITCH_APPLIED');
    expect(/[\u0600-\u06FF]/.test(tSwitchEn.body.agent_reply_text)).toBe(false);

    const tSwitchBackUr = await request(app)
      .post('/api/v1/voice/session')
      .set('Authorization', `Bearer ${zainabToken}`)
      .send({ session_id: sid, transcript: 'Ab dobara Urdu mein baat karein', synthesize_audio: false })
      .expect(200);
    expect(tSwitchBackUr.body.locked_language).toBe('ur');
    expect(tSwitchBackUr.body.language_guard_status).toBe('EXPLICIT_SWITCH_APPLIED');
    expect(/[\u0600-\u06FF]/.test(tSwitchBackUr.body.agent_reply_text)).toBe(true);

    // 4. Admin Universal RAG Explorer returns all 5 collections populated
    const ayeshaLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin_ayesha', password: 'admin123' })
      .expect(200);
    const ayeshaToken = ayeshaLogin.body.access_token as string;

    const uRagRes = await request(app)
      .get('/api/v1/admin/universal-rag')
      .set('Authorization', `Bearer ${ayeshaToken}`)
      .expect(200);
    expect(uRagRes.body.collections_summary.length).toBe(5);
    const colCounts = Object.fromEntries(
      (uRagRes.body.collections_summary as Array<{ collection: string; count: number }>).map((c) => [c.collection, c.count]),
    );
    expect(colCounts.policy_and_services_kb).toBeGreaterThanOrEqual(10);
    expect(colCounts.scam_and_fraud_kb).toBeGreaterThanOrEqual(5);
    expect(colCounts.multilingual_nlu_slang_kb).toBeGreaterThanOrEqual(80);
    expect(colCounts.episodic_conversation_kb).toBeGreaterThanOrEqual(1);
    expect(colCounts.self_learning_corrections_kb).toBeGreaterThanOrEqual(1);
  });

  it('enforces explicit account-creation consent, spoken stop command, strict department officer isolation, mandatory decision_reason, and read-only scoped audit trails', async () => {
    const { app } = setupTestApp();

    // 1. Account-Creation Consent Flow on Home -> CITIZEN_ACCOUNT_CHECK
    const rRole = await request(app)
      .post('/api/v1/voice/session')
      .send({ workflow_stage: 'HOME_WELCOME', language: 'en', transcript: 'I am a normal citizen', synthesize_audio: false })
      .expect(200);
    const consentSid = rRole.body.session_id as string;
    expect(rRole.body.workflow_stage).toBe('CITIZEN_ACCOUNT_CHECK');

    // User says "No, my account is not created" -> MUST NOT jump straight to signup! Must ask explicit consent first.
    const rNoAcc = await request(app)
      .post('/api/v1/voice/session')
      .send({ session_id: consentSid, transcript: 'No, my account is not created', synthesize_audio: false })
      .expect(200);
    expect(rNoAcc.body.workflow_stage).toBe('CITIZEN_ACCOUNT_CHECK');
    expect(rNoAcc.body.ui_action).toBe('STAY_HOME');
    expect(rNoAcc.body.navigate_to).toBeNull();
    expect(rNoAcc.body.auth_draft.wants_account_question_asked).toBe(true);
    expect(rNoAcc.body.agent_reply_text.toLowerCase()).toContain('sure');

    // User declines consent -> MUST return to Home ('/') and emit PAUSE_VOICE_AGENT to stop asking further!
    const rDecline = await request(app)
      .post('/api/v1/voice/session')
      .send({ session_id: consentSid, transcript: 'No, do not create an account', synthesize_audio: false })
      .expect(200);
    expect(rDecline.body.workflow_stage).toBe('HOME_WELCOME');
    expect(rDecline.body.ui_action).toBe('PAUSE_VOICE_AGENT');
    expect(rDecline.body.navigate_to).toBe('/');

    // 1b. Same explicit consent gate on AUTH_GATE (from /citizen LANGUAGE_SELECT)
    const rLang = await request(app)
      .post('/api/v1/voice/session')
      .send({ workflow_stage: 'LANGUAGE_SELECT', language: 'en', transcript: 'English', synthesize_audio: false })
      .expect(200);
    const authGateSid = rLang.body.session_id as string;
    expect(rLang.body.workflow_stage).toBe('AUTH_GATE');

    const rGateNoAcc = await request(app)
      .post('/api/v1/voice/session')
      .send({ session_id: authGateSid, transcript: 'No, my account is not created', synthesize_audio: false })
      .expect(200);
    expect(rGateNoAcc.body.auth_draft.mode).toBe('undecided');
    expect(rGateNoAcc.body.auth_draft.wants_account_question_asked).toBe(true);
    expect(rGateNoAcc.body.ui_action).not.toBe('NAVIGATE_SIGNUP');

    const rGateDecline = await request(app)
      .post('/api/v1/voice/session')
      .send({ session_id: authGateSid, transcript: 'No', synthesize_audio: false })
      .expect(200);
    expect(rGateDecline.body.workflow_stage).toBe('HOME_WELCOME');
    expect(rGateDecline.body.ui_action).toBe('PAUSE_VOICE_AGENT');
    expect(rGateDecline.body.navigate_to).toBe('/');

    // 2. Spoken Stop Command ("bas ruko") -> PAUSE_VOICE_AGENT
    const zainabLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'citizen_zainab', password: 'citizen123' })
      .expect(200);
    const zainabToken = zainabLogin.body.access_token as string;

    const rPause = await request(app)
      .post('/api/v1/voice/session')
      .set('Authorization', `Bearer ${zainabToken}`)
      .send({ language: 'ur', transcript: 'bas ruko', synthesize_audio: false })
      .expect(200);
    expect(rPause.body.ui_action).toBe('PAUSE_VOICE_AGENT');
    const citizenSid = rPause.body.session_id as string;

    // 3. Generate BOTH RELIEF_ASSISTANCE and SCAM_CYBER_SAFETY audit trails + relief claim
    await request(app)
      .post('/api/v1/voice/session')
      .set('Authorization', `Bearer ${zainabToken}`)
      .send({
        session_id: citizenSid,
        transcript: 'Mujhe 8171 se fake OTP aur Rs 500 fee ka message aaya hai, check karo scam hai?',
        synthesize_audio: false,
      })
      .expect(200);

    await request(app)
      .post('/api/v1/voice/session')
      .set('Authorization', `Bearer ${zainabToken}`)
      .send({ session_id: citizenSid, transcript: 'Mujhe relief ki darkhwast deni hai', synthesize_audio: false })
      .expect(200);

    await request(app)
      .post('/api/v1/voice/session')
      .set('Authorization', `Bearer ${zainabToken}`)
      .send({
        session_id: citizenSid,
        transcript: 'District Sukkur, monthly income 14000, amount 20000, reason flood damaged our home',
        synthesize_audio: false,
      })
      .expect(200);

    const submitTurn = await request(app)
      .post('/api/v1/voice/session')
      .set('Authorization', `Bearer ${zainabToken}`)
      .send({ session_id: citizenSid, transcript: 'Haan ijazat hai submit kar dein', synthesize_audio: false })
      .expect(200);
    const submittedCaseId = submitTurn.body.form_state.submitted_case_id as string;
    expect(submittedCaseId).toBeTruthy();

    // 4. Department Officer Hamza (RELIEF_ASSISTANCE)
    const hamzaLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'officer_hamza', password: 'officer123' })
      .expect(200);
    const hamzaToken = hamzaLogin.body.access_token as string;

    const hamzaCases = await request(app)
      .get('/api/v1/officer/cases')
      .set('Authorization', `Bearer ${hamzaToken}`)
      .expect(200);
    expect(hamzaCases.body.officer_department).toBe('RELIEF_ASSISTANCE');
    expect((hamzaCases.body.cases as Array<{ id: string }>).some((c) => c.id === submittedCaseId)).toBe(true);

    // Reject empty decision_reason (400)
    await request(app)
      .post(`/api/v1/cases/${submittedCaseId}/decision`)
      .set('Authorization', `Bearer ${hamzaToken}`)
      .send({ decision: 'APPROVED', decision_reason: '', internal_notes: '', citizen_message: 'Approved' })
      .expect(400);

    // Approve with mandatory decision_reason -> persisted on case!
    const approveRes = await request(app)
      .post(`/api/v1/cases/${submittedCaseId}/decision`)
      .set('Authorization', `Bearer ${hamzaToken}`)
      .send({
        decision: 'APPROVED',
        decision_reason: 'Income and flood damage verified by field check',
        citizen_message: 'Your relief claim has been approved.',
      })
      .expect(200);
    expect(approveRes.body.case.status).toBe('APPROVED');
    expect(approveRes.body.case.decision_reason).toBe('Income and flood damage verified by field check');
    expect(approveRes.body.case.decided_by_officer_name).toContain('Officer Hamza');

    // Officer Hamza scoped read-only audit trails: ONLY RELIEF_ASSISTANCE, ZERO SCAM_CYBER_SAFETY!
    const hamzaAudit = await request(app)
      .get('/api/v1/officer/agent-audit-trail')
      .set('Authorization', `Bearer ${hamzaToken}`)
      .expect(200);
    expect(hamzaAudit.body.department_id).toBe('RELIEF_ASSISTANCE');
    expect(hamzaAudit.body.read_only).toBe(true);
    expect(hamzaAudit.body.logs.length).toBeGreaterThan(0);
    expect(
      (hamzaAudit.body.logs as Array<{ department_id: string }>).every((l) => l.department_id === 'RELIEF_ASSISTANCE'),
    ).toBe(true);

    // Officer cannot call Admin cross-department audit endpoint (403)
    await request(app)
      .get('/api/v1/admin/agent-audit-trail')
      .set('Authorization', `Bearer ${hamzaToken}`)
      .expect(403);

    // 5. Department Officer Sana (SCAM_CYBER_SAFETY) — ZERO cross-department leaks!
    const sanaLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'officer_sana', password: 'officer123' })
      .expect(200);
    const sanaToken = sanaLogin.body.access_token as string;

    const sanaCases = await request(app)
      .get('/api/v1/officer/cases')
      .set('Authorization', `Bearer ${sanaToken}`)
      .expect(200);
    expect(sanaCases.body.officer_department).toBe('SCAM_CYBER_SAFETY');
    expect(sanaCases.body.cases.length).toBe(0);

    // Sana CANNOT inspect or decide Hamza's Relief Assistance case (403)
    await request(app)
      .get(`/api/v1/cases/${submittedCaseId}`)
      .set('Authorization', `Bearer ${sanaToken}`)
      .expect(403);

    // Sana's read-only audit trails contain ONLY SCAM_CYBER_SAFETY, ZERO RELIEF_ASSISTANCE!
    const sanaAudit = await request(app)
      .get('/api/v1/officer/agent-audit-trail')
      .set('Authorization', `Bearer ${sanaToken}`)
      .expect(200);
    expect(sanaAudit.body.department_id).toBe('SCAM_CYBER_SAFETY');
    expect(sanaAudit.body.logs.length).toBeGreaterThan(0);
    expect(
      (sanaAudit.body.logs as Array<{ department_id: string }>).every((l) => l.department_id === 'SCAM_CYBER_SAFETY'),
    ).toBe(true);

    // 6. Admin Ayesha: NO direct Approve/Reject (403), Read-Only Decision Oversight + Full Cross-Department Audit Trails
    const ayeshaLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin_ayesha', password: 'admin123' })
      .expect(200);
    const ayeshaToken = ayeshaLogin.body.access_token as string;

    await request(app)
      .post(`/api/v1/cases/${submittedCaseId}/decision`)
      .set('Authorization', `Bearer ${ayeshaToken}`)
      .send({ decision: 'REJECTED', decision_reason: 'Admin override attempt', citizen_message: 'Rejected' })
      .expect(403);

    const adminCases = await request(app)
      .get('/api/v1/officer/cases')
      .set('Authorization', `Bearer ${ayeshaToken}`)
      .expect(200);
    const targetRow = (adminCases.body.cases as Array<{ id: string; decision_reason?: string; decided_by_officer_name?: string }>).find(
      (c) => c.id === submittedCaseId,
    );
    expect(targetRow?.decision_reason).toBe('Income and flood damage verified by field check');
    expect(targetRow?.decided_by_officer_name).toContain('Officer Hamza');

    const adminAllAudit = await request(app)
      .get('/api/v1/admin/agent-audit-trail')
      .set('Authorization', `Bearer ${ayeshaToken}`)
      .expect(200);
    const deptSet = new Set((adminAllAudit.body.logs as Array<{ department_id: string }>).map((l) => l.department_id));
    expect(deptSet.has('RELIEF_ASSISTANCE')).toBe(true);
    expect(deptSet.has('SCAM_CYBER_SAFETY')).toBe(true);

    const adminScamOnly = await request(app)
      .get('/api/v1/admin/agent-audit-trail?department_id=SCAM_CYBER_SAFETY')
      .set('Authorization', `Bearer ${ayeshaToken}`)
      .expect(200);
    expect(adminScamOnly.body.logs.length).toBeGreaterThan(0);
    expect(
      (adminScamOnly.body.logs as Array<{ department_id: string }>).every((l) => l.department_id === 'SCAM_CYBER_SAFETY'),
    ).toBe(true);
  });

  it('verifies all 8 Hackathon Rubric Challenges (Live Rule Versioning, Cost-Backed 3 Tiers + Uncertainty Case Notes, Safe Fuzzy Entity Resolution, True Consent Revocation, Forged Doc vs Honest False Alarm, Dual Audit & All-Roles Account Consent)', async () => {
    const { app } = setupTestApp();

    const zainabLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'citizen_zainab', password: 'citizen123' })
      .expect(200);
    const zainabToken = zainabLogin.body.access_token as string;

    const hamzaLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'officer_hamza', password: 'officer123' })
      .expect(200);
    const hamzaToken = hamzaLogin.body.access_token as string;

    const ayeshaLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin_ayesha', password: 'admin123' })
      .expect(200);
    const ayeshaToken = ayeshaLogin.body.access_token as string;

    // 0. All-Roles Account Check Consent Gate (Admin / Officer / Helper ask account created/not instead of immediate /login redirect!)
    for (const phrase of ['I am an admin', 'I am a department officer', 'I am a community helper']) {
      const rRole = await request(app)
        .post('/api/v1/voice/session')
        .send({ workflow_stage: 'HOME_WELCOME', language: 'en', transcript: phrase, synthesize_audio: false })
        .expect(200);
      expect(rRole.body.workflow_stage).toBe('CITIZEN_ACCOUNT_CHECK');
      expect(rRole.body.ui_action).toBe('STAY_HOME');
      expect(rRole.body.navigate_to).toBeNull();

      const rNo = await request(app)
        .post('/api/v1/voice/session')
        .send({ session_id: rRole.body.session_id, transcript: 'No, my account is not created', synthesize_audio: false })
        .expect(200);
      expect(rNo.body.auth_draft.wants_account_question_asked).toBe(true);

      const rDecline = await request(app)
        .post('/api/v1/voice/session')
        .send({ session_id: rRole.body.session_id, transcript: 'No, do not create', synthesize_audio: false })
        .expect(200);
      expect(rDecline.body.workflow_stage).toBe('HOME_WELCOME');
      expect(rDecline.body.ui_action).toBe('PAUSE_VOICE_AGENT');
      expect(rDecline.body.navigate_to).toBe('/');
    }

    // 1. Challenge 04 — Live Dynamic Rule Engine & Immutable Version Preservation
    const submit1 = await request(app)
      .post('/api/v1/mcp')
      .set('Authorization', `Bearer ${zainabToken}`)
      .send({
        jsonrpc: '2.0',
        id: 101,
        method: 'tools/call',
        params: {
          name: 'submit_relief_claim',
          arguments: {
            citizen_id: 'citizen_zainab',
            full_name: 'Zainab Bibi',
            mock_identity_reference: '42101-1234567-2',
            district: 'Multan',
            monthly_income: 22000,
            amount: 4500,
            reason: 'Emergency food & flood support',
            category: 'flood_relief',
            consent_confirmed: true,
            confidence_score: 0.92,
            language: 'en',
          },
        },
      })
      .expect(200);
    const s1 = submit1.body.result.structuredContent;
    const claim1Id = s1.case_id as string;
    expect(s1.rule_version_used).toBe('v1.0');
    expect(s1.decision_tier).toBe('ACT_ALONE_FAST_TRACK');
    expect(s1.eligible_by_rules).toBe(true);

    // Admin publishes v1.1 LIVE (max_monthly_income_pkr 25000 -> 20000) without restart
    const pubRes = await request(app)
      .post('/api/v1/admin/rules/versions')
      .set('Authorization', `Bearer ${ayeshaToken}`)
      .send({
        max_monthly_income_pkr: 20000,
        act_alone_max_amount_pkr: 5000,
        ask_proof_max_amount_pkr: 12000,
        min_confidence_act_alone: 0.85,
        min_confidence_ask_proof: 0.65,
        change_reason: 'Budget revision',
      })
      .expect(201);
    expect(pubRes.body.active_version.version).toBe('v1.1');

    // Claim #2 with exact same income 22000 now evaluates IMMEDIATELY under v1.1 -> HUMAN_OFFICER_HANDOFF!
    const submit2 = await request(app)
      .post('/api/v1/mcp')
      .set('Authorization', `Bearer ${zainabToken}`)
      .send({
        jsonrpc: '2.0',
        id: 102,
        method: 'tools/call',
        params: {
          name: 'submit_relief_claim',
          arguments: {
            citizen_id: 'citizen_zainab',
            full_name: 'Zainab Bibi',
            mock_identity_reference: '42101-1234567-2',
            district: 'Multan',
            monthly_income: 22000,
            amount: 4500,
            reason: 'Follow-up shelter repair',
            category: 'flood_relief',
            consent_confirmed: true,
            confidence_score: 0.92,
            language: 'en',
          },
        },
      })
      .expect(200);
    const s2 = submit2.body.result.structuredContent;
    const claim2Id = s2.case_id as string;
    expect(s2.rule_version_used).toBe('v1.1');
    expect(s2.decision_tier).toBe('HUMAN_OFFICER_HANDOFF');
    expect(s2.eligible_by_rules).toBe(false);

    // Verify Claim #1 STILL permanently retains v1.0 while Claim #2 has v1.1!
    const allCasesAdmin = await request(app)
      .get('/api/v1/officer/cases')
      .set('Authorization', `Bearer ${ayeshaToken}`)
      .expect(200);
    const row1 = (allCasesAdmin.body.cases as Array<{ id: string; rule_version_used?: string }>).find((c) => c.id === claim1Id);
    const row2 = (allCasesAdmin.body.cases as Array<{ id: string; rule_version_used?: string }>).find((c) => c.id === claim2Id);
    expect(row1?.rule_version_used).toBe('v1.0');
    expect(row2?.rule_version_used).toBe('v1.1');

    // 2. Challenge 01 & 02 — Cost-Backed 3-Tier Matrix + Explicit "I am not sure" Case Notes
    const tier1 = await request(app)
      .post('/api/v1/rules/evaluate-tier')
      .set('Authorization', `Bearer ${zainabToken}`)
      .send({ amount_pkr: 4500, monthly_income_pkr: 15000, confidence_score: 0.92, language: 'en' })
      .expect(200);
    expect(tier1.body.evaluation.decision_tier).toBe('ACT_ALONE_FAST_TRACK');
    expect(tier1.body.evaluation.cost_rationale.cost_ratio_false_approval_vs_delay).toBe(25);

    const tier2 = await request(app)
      .post('/api/v1/rules/evaluate-tier')
      .set('Authorization', `Bearer ${zainabToken}`)
      .send({ amount_pkr: 8000, monthly_income_pkr: 15000, confidence_score: 0.88, language: 'en' })
      .expect(200);
    expect(tier2.body.evaluation.decision_tier).toBe('ASK_FOR_MORE_PROOF');

    const tier3Uncertain = await request(app)
      .post('/api/v1/rules/evaluate-tier')
      .set('Authorization', `Bearer ${zainabToken}`)
      .send({ amount_pkr: 4500, monthly_income_pkr: 15000, confidence_score: 0.54, language: 'en' })
      .expect(200);
    expect(tier3Uncertain.body.evaluation.decision_tier).toBe('HUMAN_OFFICER_HANDOFF');
    expect(tier3Uncertain.body.evaluation.is_uncertain).toBe(true);
    expect(tier3Uncertain.body.evaluation.citizen_simple_reason).toContain('I am not sure (Confidence: 54%)');
    expect(tier3Uncertain.body.evaluation.case_notes.uncertainty_reasons.length).toBeGreaterThan(0);

    // 3. Challenge 03 — Pakistani Phonetic Variants, Safe 3-Way Duplicate Guard & Bad-Data Safety
    const seedCand = [
      { id: 'cand-1', user_id: null, display_name: 'Muhammad Ali', cnic: '35202-1112223-1', phone: '03001234567', district: 'Lahore' },
    ];
    const dupExact = await request(app)
      .post('/api/v1/entity-resolution/check')
      .set('Authorization', `Bearer ${zainabToken}`)
      .send({ full_name: 'Mohammad Ali', cnic: '35202-1112223-1', phone: '03001234567', district: 'Lahore', extra_candidates: seedCand })
      .expect(200);
    expect(dupExact.body.resolution.classification).toBe('EXACT_DUPLICATE_PERSON');
    expect(dupExact.body.resolution.should_block_submission).toBe(true);

    const homonymSafe = await request(app)
      .post('/api/v1/entity-resolution/check')
      .set('Authorization', `Bearer ${zainabToken}`)
      .send({ full_name: 'Muhammed Ali', cnic: '42101-9998887-3', phone: '03219876543', district: 'Karachi', extra_candidates: seedCand })
      .expect(200);
    expect(homonymSafe.body.resolution.classification).toBe('DISTINCT_PERSON_HOMONYM');
    expect(homonymSafe.body.resolution.should_block_submission).toBe(false);

    const possibleDup = await request(app)
      .post('/api/v1/entity-resolution/check')
      .set('Authorization', `Bearer ${zainabToken}`)
      .send({ full_name: 'Mohd Ali', cnic: null, phone: '03001234567', district: 'Lahore', extra_candidates: seedCand })
      .expect(200);
    expect(possibleDup.body.resolution.classification).toBe('POSSIBLE_DUPLICATE_NEEDS_HUMAN');
    expect(possibleDup.body.resolution.requires_human_review).toBe(true);

    // Null / malformed bad data -> never crashes!
    const badDataRes = await request(app)
      .post('/api/v1/entity-resolution/check')
      .set('Authorization', `Bearer ${zainabToken}`)
      .send({ full_name: null, cnic: '', phone: null, district: '' })
      .expect(200);
    expect(badDataRes.body.resolution.classification).toBe('NO_MATCH');

    // 4. Challenge 06 — True Consent Visibility & Hard Backend Access Revocation
    const myConsent = await request(app)
      .get('/api/v1/consent/my-data')
      .set('Authorization', `Bearer ${zainabToken}`)
      .expect(200);
    expect(myConsent.body.consent.status).toBe('GRANTED');
    expect(myConsent.body.consent.who_has_access.length).toBeGreaterThanOrEqual(3);

    await request(app)
      .post('/api/v1/consent/withdraw-all')
      .set('Authorization', `Bearer ${zainabToken}`)
      .expect(200);

    // Officer Hamza sees REDACTED / access_blocked on queue & detail, AND decision returns 403 CONSENT_WITHDRAWN!
    const hamzaBlockedQueue = await request(app)
      .get('/api/v1/officer/cases')
      .set('Authorization', `Bearer ${hamzaToken}`)
      .expect(200);
    const blockedItem = (hamzaBlockedQueue.body.cases as Array<{ id: string; access_blocked?: boolean; citizen_display_name: string }>).find(
      (c) => c.id === claim1Id,
    );
    expect(blockedItem?.access_blocked).toBe(true);
    expect(blockedItem?.citizen_display_name).toContain('REDACTED');

    const hamzaBlockedDetail = await request(app)
      .get(`/api/v1/cases/${claim1Id}`)
      .set('Authorization', `Bearer ${hamzaToken}`)
      .expect(200);
    expect(hamzaBlockedDetail.body.case.access_blocked).toBe(true);
    expect(hamzaBlockedDetail.body.answers.length).toBe(0);

    await request(app)
      .post(`/api/v1/cases/${claim1Id}/decision`)
      .set('Authorization', `Bearer ${hamzaToken}`)
      .send({ decision: 'APPROVED', decision_reason: 'Attempt after revoke', citizen_message: 'Approved' })
      .expect(403);

    // Admin audit trail contains BOTH CONSENT_WITHDRAWN and DATA_ACCESS_BLOCKED_CONSENT_WITHDRAWN!
    const consentAudit = await request(app)
      .get('/api/v1/admin/agent-audit-trail')
      .set('Authorization', `Bearer ${ayeshaToken}`)
      .expect(200);
    const consentEvents = new Set(
      (consentAudit.body.logs as Array<{ consent_event_type?: string | null }>).map((l) => l.consent_event_type),
    );
    expect(consentEvents.has('CONSENT_WITHDRAWN')).toBe(true);
    expect(consentEvents.has('DATA_ACCESS_BLOCKED_CONSENT_WITHDRAWN')).toBe(true);

    // Restore consent cleanly
    await request(app)
      .post('/api/v1/consent/grant-all')
      .set('Authorization', `Bearer ${zainabToken}`)
      .expect(200);

    // 5. Challenge 08 — Forged Document Detection vs Honest False-Alarm Protection
    const tamperedDoc = await request(app)
      .post('/api/v1/documents/analyze-authenticity')
      .set('Authorization', `Bearer ${zainabToken}`)
      .send({ sample_preset: 'tampered_edited_doc', language: 'en' })
      .expect(200);
    expect(tamperedDoc.body.analysis.outcome).toBe('LIKELY_FORGED_NEEDS_REVIEW');
    expect(tamperedDoc.body.analysis.tamper_indicators.length).toBeGreaterThan(0);

    const blurryDoc = await request(app)
      .post('/api/v1/documents/analyze-authenticity')
      .set('Authorization', `Bearer ${zainabToken}`)
      .send({ sample_preset: 'blurry_rural_photo', language: 'en' })
      .expect(200);
    expect(blurryDoc.body.analysis.outcome).toBe('POSSIBLE_FALSE_ALARM_LOW_QUALITY');
    expect(blurryDoc.body.analysis.false_alarm_risk).toBe('HIGH');
    expect(blurryDoc.body.analysis.non_blocking_options).toContain('RETAKE_CLEARER_PHOTO');
    expect(blurryDoc.body.analysis.non_blocking_options).toContain('SEND_TO_HUMAN_OFFICER');

    const validDoc = await request(app)
      .post('/api/v1/documents/analyze-authenticity')
      .set('Authorization', `Bearer ${zainabToken}`)
      .send({ sample_preset: 'valid_cnic', language: 'en' })
      .expect(200);
    expect(validDoc.body.analysis.outcome).toBe('VERIFIED_AUTHENTIC');

    const metricsRes = await request(app)
      .get('/api/v1/documents/authenticity-metrics')
      .set('Authorization', `Bearer ${ayeshaToken}`)
      .expect(200);
    expect(metricsRes.body.metrics.total_scanned).toBe(3);
    expect(metricsRes.body.metrics.likely_forged_flagged).toBe(1);
    expect(metricsRes.body.metrics.possible_false_alarms_protected).toBe(1);
  });
});
