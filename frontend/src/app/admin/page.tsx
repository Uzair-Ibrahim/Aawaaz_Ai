'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type {
  AgentEscalationRecord,
  AgentNluRagMemoryRecord,
  AgentReasoningAuditLogRecord,
  CaseRecord,
  Department,
  DocumentAuthenticityMetrics,
  DynamicRuleVersionRecord,
  EligibilityRuleRecord,
  PolicyRecord,
  RuleVersionRecord,
  ServiceDepartmentCode,
  UniversalRagCollection,
  UniversalRagDocumentRecord,
} from '@awaaz/shared';
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  Brain,
  Building2,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  Database,
  Headphones,
  Settings2,
  ShieldCheck,
  Sparkles,
  UserPlus,
} from 'lucide-react';
import { ApiClientError, apiRequest } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/context';
import { formatText, useI18n } from '@/lib/i18n/context';
import { getRoleLandingRoute } from '@/lib/modules/registry';

interface RuleEntry {
  rule: EligibilityRuleRecord;
  active_version: RuleVersionRecord | null;
  versions_count: number;
}

interface MetricsPayload {
  total_cases: number;
  cases_by_status: Record<string, number>;
  total_members: number;
  total_rules: number;
  total_policies: number;
  total_ai_runs: number;
}

interface DeptAccountRow {
  user_id: string;
  email: string;
  display_name: string;
  role: string;
  department_id: string | null;
  department_name: string | null;
}

interface AdminCaseRow extends CaseRecord {
  citizen_display_name: string;
  mock_identity_reference: string;
}

interface AdminRagMemoryPayload {
  total: number;
  seeded_count: number;
  learned_count: number;
  total_hits: number;
  memories: AgentNluRagMemoryRecord[];
}

interface AdminUniversalRagPayload {
  total_documents: number;
  total_hits: number;
  collections_summary: Array<{
    collection: UniversalRagCollection;
    count: number;
    hits: number;
  }>;
  documents: UniversalRagDocumentRecord[];
}

export default function AdminDashboardPage() {
  const { user, token, activeOrganizationId } = useAuth();
  const { dict, roleLabel, statusLabel } = useI18n();
  const [metrics, setMetrics] = useState<MetricsPayload | null>(null);
  const [submittedCases, setSubmittedCases] = useState<AdminCaseRow[]>([]);
  const [agentAuditLogs, setAgentAuditLogs] = useState<AgentReasoningAuditLogRecord[]>([]);
  const [escalations, setEscalations] = useState<AgentEscalationRecord[]>([]);
  const [ragStats, setRagStats] = useState<AdminRagMemoryPayload | null>(null);
  const [universalRag, setUniversalRag] = useState<AdminUniversalRagPayload | null>(null);
  const [universalColFilter, setUniversalColFilter] = useState<'ALL' | UniversalRagCollection>('ALL');
  const [ragFilterSource, setRagFilterSource] = useState<'ALL' | 'LEARNED_FROM_CORRECTION' | 'LEARNED_FROM_CONFIRMATION' | 'SEED_EXEMPLAR'>('ALL');
  const [ragSearch, setRagSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'overview' | 'live-rules' | 'escalations' | 'agent-audit' | 'rag-memory'>('overview');
  const [liveRuleActive, setLiveRuleActive] = useState<DynamicRuleVersionRecord | null>(null);
  const [liveRuleHistory, setLiveRuleHistory] = useState<DynamicRuleVersionRecord[]>([]);
  const [docAuthMetrics, setDocAuthMetrics] = useState<DocumentAuthenticityMetrics | null>(null);
  const [lrMaxIncome, setLrMaxIncome] = useState('25000');
  const [lrActAlone, setLrActAlone] = useState('5000');
  const [lrAskProof, setLrAskProof] = useState('12000');
  const [lrMinConfAct, setLrMinConfAct] = useState('0.85');
  const [lrMinConfProof, setLrMinConfProof] = useState('0.65');
  const [lrChangeReason, setLrChangeReason] = useState('');
  const [publishingLiveRule, setPublishingLiveRule] = useState(false);
  const [expandedAuditIds, setExpandedAuditIds] = useState<Record<string, boolean>>({});
  const [auditFilterScope, setAuditFilterScope] = useState<'ALL' | 'OUT_OF_SCOPE_ESCALATED' | 'DENIED'>('ALL');
  const [auditFilterDept, setAuditFilterDept] = useState<'ALL' | ServiceDepartmentCode>('ALL');
  const [auditSearch, setAuditSearch] = useState('');
  const [rules, setRules] = useState<RuleEntry[]>([]);
  const [versions, setVersions] = useState<Array<RuleVersionRecord & { cases_evaluated_count: number }>>([]);
  const [policies, setPolicies] = useState<PolicyRecord[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [accounts, setAccounts] = useState<DeptAccountRow[]>([]);

  // Super Admin: Create Department & Create Department Staff Account
  const [deptName, setDeptName] = useState('');
  const [deptCode, setDeptCode] = useState('');
  const [staffName, setStaffName] = useState('');
  const [staffEmail, setStaffEmail] = useState('');
  const [staffPassword, setStaffPassword] = useState('');
  const [staffRole, setStaffRole] = useState<'officer' | 'helper' | 'admin'>('officer');
  const [staffDeptId, setStaffDeptId] = useState('');

  // Rule Editor
  const [incomeLimit, setIncomeLimit] = useState('25000');
  const [officerReadyMin, setOfficerReadyMin] = useState('90');
  const [needsMoreInfoMin, setNeedsMoreInfoMin] = useState('70');
  const [mockGrantPkr, setMockGrantPkr] = useState('15000');

  // Policy Ingestion
  const [policyTitle, setPolicyTitle] = useState('');
  const [policyRef, setPolicyRef] = useState('');
  const [policyContent, setPolicyContent] = useState('');

  const [banner, setBanner] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadAdminData = useCallback(async () => {
    if (!token || !activeOrganizationId || user?.active_role !== 'admin') return;
    try {
      const [metricsRes, rulesRes, policiesRes, deptAccountsRes, casesRes, auditTrailRes, escalationsRes, ragRes, universalRagRes, liveRulesRes, docMetricsRes] =
        await Promise.all([
          apiRequest<{ metrics: MetricsPayload }>('/admin/metrics', { token, organizationId: activeOrganizationId }),
          apiRequest<{ rules: RuleEntry[] }>('/admin/rules', { token, organizationId: activeOrganizationId }),
          apiRequest<{ policies: PolicyRecord[] }>('/policies', { token, organizationId: activeOrganizationId }),
          apiRequest<{ departments: Department[]; accounts: DeptAccountRow[] }>('/admin/department-accounts', {
            token,
            organizationId: activeOrganizationId,
          }),
          apiRequest<{ cases: AdminCaseRow[] }>('/officer/cases', {
            token,
            organizationId: activeOrganizationId,
          }),
          apiRequest<{ logs: AgentReasoningAuditLogRecord[] }>('/admin/agent-audit-trail', {
            token,
            organizationId: activeOrganizationId,
          }),
          apiRequest<{ escalations: AgentEscalationRecord[] }>('/admin/escalations', {
            token,
            organizationId: activeOrganizationId,
          }),
          apiRequest<AdminRagMemoryPayload>('/admin/nlu-rag-memory', {
            token,
            organizationId: activeOrganizationId,
          }),
          apiRequest<AdminUniversalRagPayload>('/admin/universal-rag', {
            token,
            organizationId: activeOrganizationId,
          }),
          apiRequest<{ active_version: DynamicRuleVersionRecord; versions: DynamicRuleVersionRecord[] }>('/rules/versions', {
            token,
            organizationId: activeOrganizationId,
          }),
          apiRequest<{ metrics: DocumentAuthenticityMetrics }>('/documents/authenticity-metrics', {
            token,
            organizationId: activeOrganizationId,
          }),
        ]);
      setMetrics(metricsRes.metrics);
      setRules(rulesRes.rules);
      setPolicies(policiesRes.policies);
      setDepartments(deptAccountsRes.departments);
      setAccounts(deptAccountsRes.accounts);
      setSubmittedCases(casesRes.cases);
      setAgentAuditLogs(auditTrailRes.logs);
      setEscalations(escalationsRes.escalations);
      setRagStats(ragRes);
      setUniversalRag(universalRagRes);
      setLiveRuleActive(liveRulesRes.active_version);
      setLiveRuleHistory(liveRulesRes.versions);
      setDocAuthMetrics(docMetricsRes.metrics);
      if (liveRulesRes.active_version) {
        setLrMaxIncome(String(liveRulesRes.active_version.max_monthly_income_pkr));
        setLrActAlone(String(liveRulesRes.active_version.act_alone_max_amount_pkr));
        setLrAskProof(String(liveRulesRes.active_version.ask_proof_max_amount_pkr));
        setLrMinConfAct(String(liveRulesRes.active_version.min_confidence_act_alone));
        setLrMinConfProof(String(liveRulesRes.active_version.min_confidence_ask_proof));
      }

      const primaryRule = rulesRes.rules[0];
      if (primaryRule) {
        const verRes = await apiRequest<{
          versions: Array<RuleVersionRecord & { cases_evaluated_count: number }>;
        }>(`/admin/rules/${primaryRule.rule.id}/versions`, {
          token,
          organizationId: activeOrganizationId,
        });
        setVersions(verRes.versions);

        const activeDef = primaryRule.active_version?.rules_json;
        const incomeCond = activeDef?.conditions.find((c) => c.field === 'monthly_income');
        if (incomeCond && typeof incomeCond.value === 'number') setIncomeLimit(String(incomeCond.value));
        if (activeDef?.thresholds) {
          setOfficerReadyMin(String(activeDef.thresholds.officer_ready_min));
          setNeedsMoreInfoMin(String(activeDef.thresholds.needs_more_info_min));
        }
        if (activeDef?.default_mock_grant_pkr) setMockGrantPkr(String(activeDef.default_mock_grant_pkr));
      }
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : dict.auth.authFailed);
    }
  }, [token, activeOrganizationId, user?.active_role, dict.auth.authFailed]);

  useEffect(() => {
    void loadAdminData();
  }, [loadAdminData]);

  if (!user) {
    return (
      <div className="rounded-xl bg-white border border-slate-200 p-8 text-center space-y-3">
        <p className="text-slate-700">{dict.admin.roleRequired}</p>
        <Link href="/login" className="inline-block px-5 py-2.5 rounded-xl bg-teal-700 text-white font-semibold">
          {dict.admin.signInAsAdmin}
        </Link>
      </div>
    );
  }

  if (user.active_role !== 'admin') {
    return (
      <div className="rounded-xl bg-white border border-rose-200 p-8 text-center space-y-3">
        <p className="text-slate-700">{dict.admin.roleRequired}</p>
        <Link
          href={getRoleLandingRoute(user.active_role)}
          className="inline-block px-5 py-2.5 rounded-xl bg-teal-700 text-white font-semibold"
        >
          {formatText(dict.home.openRoleWorkspace, { role: roleLabel(user.active_role) })}
        </Link>
      </div>
    );
  }

  const handleCreateDepartment = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBanner(null);
    try {
      const res = await apiRequest<{ department: Department }>('/workspaces/current/departments', {
        method: 'POST',
        token,
        organizationId: activeOrganizationId,
        body: { name: deptName.trim(), code: deptCode.trim().toUpperCase() },
      });
      setDeptName('');
      setDeptCode('');
      setBanner(formatText(dict.admin.deptCreatedMsg, { name: res.department.name }));
      await loadAdminData();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : dict.auth.authFailed);
    }
  };

  const handleCreateDepartmentAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBanner(null);
    try {
      const res = await apiRequest<{ account: { email: string; role: string } }>('/admin/department-accounts', {
        method: 'POST',
        token,
        organizationId: activeOrganizationId,
        body: {
          display_name: staffName.trim(),
          email: staffEmail.trim(),
          password: staffPassword,
          role: staffRole,
          department_id: staffDeptId || null,
        },
      });
      setStaffName('');
      setStaffEmail('');
      setStaffPassword('');
      setBanner(
        formatText(dict.admin.accountCreatedMsg, {
          email: res.account.email,
          role: roleLabel(res.account.role),
        }),
      );
      await loadAdminData();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : dict.auth.authFailed);
    }
  };

  const handlePublishRuleVersion = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBanner(null);
    try {
      const res = await apiRequest<{ version: RuleVersionRecord }>('/admin/rules', {
        method: 'POST',
        token,
        organizationId: activeOrganizationId,
        body: {
          scheme_id: 'MOCK_RELIEF_01',
          combinator: 'AND',
          conditions: [
            {
              id: 'cond_income_cap',
              field: 'monthly_income',
              operator: 'lte',
              value: Number(incomeLimit),
              description: `Synthetic rule: monthly income <= ${incomeLimit} PKR`,
            },
            {
              id: 'cond_household_size',
              field: 'household_size',
              operator: 'gte',
              value: 1,
            },
          ],
          required_fields: [
            'full_name',
            'mock_identity_reference',
            'district',
            'household_size',
            'monthly_income',
            'employment_status',
            'relief_reason',
          ],
          required_documents: ['mock_identity_document', 'mock_proof_of_income'],
          thresholds: {
            officer_ready_min: Number(officerReadyMin),
            needs_more_info_min: Number(needsMoreInfoMin),
          },
          default_mock_grant_pkr: Number(mockGrantPkr),
        },
      });
      setBanner(formatText(dict.admin.rulePublishedMsg, { version: res.version.version_number }));
      await loadAdminData();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : dict.auth.authFailed);
    }
  };

  const handleCreatePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBanner(null);
    try {
      await apiRequest('/admin/policies', {
        method: 'POST',
        token,
        organizationId: activeOrganizationId,
        body: {
          title: policyTitle,
          document_type: 'policy_update',
          version: '1.0',
          effective_date: new Date().toISOString().slice(0, 10),
          language: 'en',
          source_reference: policyRef,
          content: policyContent,
        },
      });
      setPolicyTitle('');
      setPolicyRef('');
      setPolicyContent('');
      setBanner(dict.admin.policyIngestedMsg);
      await loadAdminData();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : dict.auth.authFailed);
    }
  };

  const handlePublishLiveRuleVersion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !activeOrganizationId) return;
    setPublishingLiveRule(true);
    setError(null);
    setBanner(null);
    try {
      const res = await apiRequest<{ active_version: DynamicRuleVersionRecord; history: DynamicRuleVersionRecord[] }>(
        '/admin/rules/versions',
        {
          method: 'POST',
          token,
          organizationId: activeOrganizationId,
          body: {
            max_monthly_income_pkr: Number(lrMaxIncome),
            act_alone_max_amount_pkr: Number(lrActAlone),
            ask_proof_max_amount_pkr: Number(lrAskProof),
            min_confidence_act_alone: Number(lrMinConfAct),
            min_confidence_ask_proof: Number(lrMinConfProof),
            change_reason: lrChangeReason.trim() || 'Live policy update',
          },
        },
      );
      setLiveRuleActive(res.active_version);
      setLiveRuleHistory(res.history);
      setLrChangeReason('');
      setBanner(`Published live policy ${res.active_version.version} immediately (zero restart — past applications retain their original rule version).`);
      await loadAdminData();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : dict.auth.authFailed);
    } finally {
      setPublishingLiveRule(false);
    }
  };

  const handleUpdateEscalationStatus = async (escalationId: string, status: 'OPEN' | 'IN_REVIEW' | 'RESOLVED') => {
    setError(null);
    setBanner(null);
    try {
      const res = await apiRequest<{ escalation: AgentEscalationRecord }>(`/admin/escalations/${escalationId}`, {
        method: 'PATCH',
        token,
        organizationId: activeOrganizationId,
        body: {
          status,
          resolution_notes: `Updated to ${status} by ${user.display_name}`,
        },
      });
      setBanner(`Escalation ticket ${res.escalation.ticket_reference} marked as ${status}.`);
      await loadAdminData();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : dict.auth.authFailed);
    }
  };

  const filteredAuditLogs = agentAuditLogs.filter((log) => {
    if (auditFilterDept !== 'ALL' && (log.department_id ?? 'GENERAL_INQUIRY') !== auditFilterDept) return false;
    if (auditFilterScope === 'OUT_OF_SCOPE_ESCALATED' && log.capability_check !== 'OUT_OF_SCOPE_ESCALATED') return false;
    if (auditFilterScope === 'DENIED' && log.access_control_decision.decision !== 'DENIED') return false;
    if (auditSearch.trim()) {
      const q = auditSearch.trim().toLowerCase();
      return (
        log.user_input.toLowerCase().includes(q) ||
        log.intent_detected.toLowerCase().includes(q) ||
        log.session_id.toLowerCase().includes(q) ||
        log.final_agent_response.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Settings2 className="h-6 w-6 text-teal-700" />
            {dict.admin.superAdminTitle}
          </h1>
          <p className="text-sm text-slate-600">
            {formatText(dict.admin.superAdminSubtitle, { org: user.active_organization.name })}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => void loadAdminData()}
            className="px-4 py-2 rounded-xl border border-slate-300 bg-white text-sm font-semibold hover:bg-slate-50"
          >
            {dict.refresh}
          </button>
          <Link href="/workspace" className="px-4 py-2 rounded-xl border border-slate-300 bg-white text-sm font-semibold">
            {dict.admin.manageUsersLink}
          </Link>
        </div>
      </div>

      {/* Admin Navigation Tabs: Overview | AI Escalated Requests | Agent Reasoning & Audit Trail */}
      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
        <button
          type="button"
          data-testid="admin-tab-overview"
          onClick={() => setActiveTab('overview')}
          className={`px-4 py-2 rounded-xl text-sm font-bold transition ${
            activeTab === 'overview'
              ? 'bg-teal-700 text-white shadow-xs'
              : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
          }`}
        >
          Overview &amp; Applications ({submittedCases.length})
        </button>
        <button
          type="button"
          data-testid="admin-tab-live-rules"
          onClick={() => setActiveTab('live-rules')}
          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold transition ${
            activeTab === 'live-rules'
              ? 'bg-cyan-700 text-white shadow-xs'
              : 'bg-white border border-cyan-300 text-cyan-950 hover:bg-cyan-50'
          }`}
        >
          <Settings2 className="h-4 w-4" />
          <span>Live Policy Rules ({liveRuleActive?.version ?? 'v1.0'})</span>
        </button>
        <button
          type="button"
          data-testid="admin-tab-escalations"
          onClick={() => setActiveTab('escalations')}
          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold transition ${
            activeTab === 'escalations'
              ? 'bg-amber-600 text-white shadow-xs'
              : 'bg-white border border-amber-300 text-amber-900 hover:bg-amber-50'
          }`}
        >
          <Headphones className="h-4 w-4" />
          <span>AI Escalated Requests ({escalations.length})</span>
        </button>
        <button
          type="button"
          data-testid="admin-tab-agent-audit"
          onClick={() => setActiveTab('agent-audit')}
          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold transition ${
            activeTab === 'agent-audit'
              ? 'bg-indigo-700 text-white shadow-xs'
              : 'bg-white border border-indigo-300 text-indigo-900 hover:bg-indigo-50'
          }`}
        >
          <Brain className="h-4 w-4" />
          <span>Agent Reasoning &amp; Audit Trail ({agentAuditLogs.length})</span>
        </button>
        <button
          type="button"
          data-testid="admin-tab-rag-memory"
          onClick={() => setActiveTab('rag-memory')}
          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold transition ${
            activeTab === 'rag-memory'
              ? 'bg-emerald-700 text-white shadow-xs'
              : 'bg-white border border-emerald-300 text-emerald-900 hover:bg-emerald-50'
          }`}
        >
          <Database className="h-4 w-4" />
          <span>
            Self-Learning RAG Memory ({ragStats?.total ?? 0}
            {ragStats && ragStats.learned_count > 0 ? ` • +${ragStats.learned_count} Learned` : ''})
          </span>
        </button>
      </div>

      {banner && <div className="rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 px-4 py-3 text-sm">{banner}</div>}
      {error && <div className="rounded-xl bg-rose-50 border border-rose-200 text-rose-900 px-4 py-3 text-sm">{error}</div>}

      {/* TAB: LIVE POLICY RULES & COST-BACKED 3-TIER MATRIX (MODULES 1 & 2) */}
      {activeTab === 'live-rules' && (
        <section
          data-testid="admin-live-rules-panel"
          className="space-y-5"
        >
          {/* Decision Cost Model & 3-Tier Thresholds Breakdown */}
          {liveRuleActive && (
            <div
              data-testid="admin-cost-model-card"
              className="rounded-2xl bg-gradient-to-br from-slate-900 to-teal-950 text-white p-5 space-y-4 shadow-sm"
            >
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h2 className="text-lg font-bold">Decision Cost Model &amp; 3-Tier Thresholds</h2>
                <span
                  data-testid="active-rule-version-badge"
                  className="px-3 py-1 rounded-full bg-emerald-500 text-slate-950 font-mono font-extrabold text-xs"
                >
                  ACTIVE: {liveRuleActive.version}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-white/10 border border-white/15">
                  <div className="text-rose-200 font-bold">False Approval Cost (25x Delay)</div>
                  <div className="text-xl font-extrabold mt-1">PKR {liveRuleActive.false_approval_cost_pkr.toLocaleString()}</div>
                </div>
                <div className="p-3 rounded-xl bg-white/10 border border-white/15">
                  <div className="text-amber-200 font-bold">False Delay Cost</div>
                  <div className="text-xl font-extrabold mt-1">PKR {liveRuleActive.false_delay_cost_pkr.toLocaleString()}</div>
                </div>
                <div className="p-3 rounded-xl bg-white/10 border border-white/15">
                  <div className="text-cyan-200 font-bold">Wrongful Rejection Cost</div>
                  <div className="text-xl font-extrabold mt-1">PKR {liveRuleActive.wrongful_rejection_cost_pkr.toLocaleString()}</div>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-emerald-500/20 border border-emerald-400/40">
                  <div className="font-bold text-emerald-200">Tier 1 — ACT_ALONE_FAST_TRACK</div>
                  <p className="mt-1 text-emerald-50">
                    Amount ≤ PKR {liveRuleActive.act_alone_max_amount_pkr.toLocaleString()}, Income ≤ PKR {liveRuleActive.max_monthly_income_pkr.toLocaleString()}, Confidence ≥ {Math.round(liveRuleActive.min_confidence_act_alone * 100)}%, zero duplicate/forgery flags.
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-amber-500/20 border border-amber-400/40">
                  <div className="font-bold text-amber-200">Tier 2 — ASK_FOR_MORE_PROOF</div>
                  <p className="mt-1 text-amber-50">
                    Amount PKR {(liveRuleActive.act_alone_max_amount_pkr + 1).toLocaleString()}–{liveRuleActive.ask_proof_max_amount_pkr.toLocaleString()} OR Confidence {Math.round(liveRuleActive.min_confidence_ask_proof * 100)}–{Math.round(liveRuleActive.min_confidence_act_alone * 100) - 1}% OR blurry/missing proof.
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-rose-500/20 border border-rose-400/40">
                  <div className="font-bold text-rose-200">Tier 3 — HUMAN_OFFICER_HANDOFF</div>
                  <p className="mt-1 text-rose-50">
                    Amount &gt; PKR {liveRuleActive.ask_proof_max_amount_pkr.toLocaleString()} OR Income &gt; PKR {liveRuleActive.max_monthly_income_pkr.toLocaleString()} OR Confidence &lt; {Math.round(liveRuleActive.min_confidence_ask_proof * 100)}% (explicit &ldquo;I am not sure&rdquo; + Case Notes).
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Live Rule Editor Form (Zero Restart) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <form
              onSubmit={(e) => void handlePublishLiveRuleVersion(e)}
              className="rounded-2xl bg-white border-2 border-cyan-200 p-5 space-y-4 shadow-xs"
            >
              <h3 className="text-base font-bold text-slate-900">Publish New Live Rule Version (Zero Code / Zero Restart)</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <label className="space-y-1">
                  <span className="font-bold text-slate-700">Max Monthly Income (PKR)</span>
                  <input
                    data-testid="rule-input-max-income"
                    type="number"
                    required
                    value={lrMaxIncome}
                    onChange={(e) => setLrMaxIncome(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="space-y-1">
                  <span className="font-bold text-slate-700">Tier 1 Act-Alone Max (PKR)</span>
                  <input
                    data-testid="rule-input-act-alone"
                    type="number"
                    required
                    value={lrActAlone}
                    onChange={(e) => setLrActAlone(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="space-y-1">
                  <span className="font-bold text-slate-700">Tier 2 Ask-Proof Max (PKR)</span>
                  <input
                    data-testid="rule-input-ask-proof"
                    type="number"
                    required
                    value={lrAskProof}
                    onChange={(e) => setLrAskProof(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="space-y-1">
                  <span className="font-bold text-slate-700">Min Confidence Act Alone (0.1–1.0)</span>
                  <input
                    data-testid="rule-input-min-conf-act"
                    type="number"
                    step="0.01"
                    min="0.1"
                    max="1"
                    required
                    value={lrMinConfAct}
                    onChange={(e) => setLrMinConfAct(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="space-y-1 sm:col-span-2">
                  <span className="font-bold text-slate-700">Min Confidence Ask Proof (0.1–1.0)</span>
                  <input
                    data-testid="rule-input-min-conf-proof"
                    type="number"
                    step="0.01"
                    min="0.1"
                    max="1"
                    required
                    value={lrMinConfProof}
                    onChange={(e) => setLrMinConfProof(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="space-y-1 sm:col-span-2">
                  <span className="font-bold text-slate-700">Change Reason (Audit Logged) *</span>
                  <input
                    data-testid="rule-input-change-reason"
                    type="text"
                    required
                    minLength={3}
                    placeholder="e.g., Budget revision"
                    value={lrChangeReason}
                    onChange={(e) => setLrChangeReason(e.target.value)}
                    className="w-full rounded-xl border-2 border-cyan-300 px-3 py-2 text-sm"
                  />
                </label>
              </div>
              <button
                type="submit"
                data-testid="publish-rule-version-btn"
                disabled={publishingLiveRule || lrChangeReason.trim().length < 3}
                className="w-full py-2.5 rounded-xl bg-cyan-700 hover:bg-cyan-800 disabled:opacity-45 text-white font-bold text-sm transition"
              >
                {publishingLiveRule ? 'Publishing...' : 'Publish New Rule Version'}
              </button>
            </form>

            {/* Immutable Rule Version History */}
            <div
              data-testid="rule-versions-history"
              className="rounded-2xl bg-white border border-slate-200 p-5 space-y-3 shadow-xs"
            >
              <h3 className="text-base font-bold text-slate-900">Immutable Rule Version History ({liveRuleHistory.length})</h3>
              <div className="space-y-2.5 max-h-96 overflow-y-auto">
                {liveRuleHistory.map((rv) => (
                  <div
                    key={rv.id}
                    data-testid={`rule-version-row-${rv.version}`}
                    className={`p-3 rounded-xl border text-xs space-y-1 ${
                      rv.is_active ? 'bg-emerald-50 border-emerald-300' : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-extrabold text-sm text-slate-900">
                        {rv.version}{' '}
                        {rv.is_active && (
                          <span className="ms-1 px-2 py-0.5 rounded-full bg-emerald-700 text-white text-[10px]">ACTIVE</span>
                        )}
                      </span>
                      <span className="text-slate-500">{rv.updated_by}</span>
                    </div>
                    <div className="text-slate-700">
                      Max Income: <strong>PKR {rv.max_monthly_income_pkr.toLocaleString()}</strong> • Tier 1 ≤{' '}
                      <strong>{rv.act_alone_max_amount_pkr.toLocaleString()}</strong> • Tier 2 ≤{' '}
                      <strong>{rv.ask_proof_max_amount_pkr.toLocaleString()}</strong>
                    </div>
                    <div className="text-slate-600">
                      <strong>Reason:</strong> {rv.change_reason}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* TAB 2: AI ESCALATED REQUESTS (PILLAR 5) */}
      {activeTab === 'escalations' && (
        <section
          data-testid="admin-escalations-panel"
          className="rounded-2xl bg-white border-2 border-amber-200 p-5 space-y-4 shadow-xs"
        >
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <Headphones className="h-5 w-5 text-amber-600" />
                <span>AI Escalated Requests Queue ({escalations.length})</span>
              </h2>
              <p className="text-xs text-slate-600">
                Out-of-scope citizen requests gracefully handed off by the Autonomous Voice Agent to human Officers &amp; Administrators.
              </p>
            </div>
          </div>

          {escalations.length === 0 ? (
            <p className="text-sm text-slate-500">No AI escalations forwarded yet.</p>
          ) : (
            <div className="space-y-3">
              {escalations.map((esc) => (
                <div
                  key={esc.id}
                  data-testid={`escalation-row-${esc.ticket_reference}`}
                  className="p-4 rounded-xl bg-amber-50/40 border border-amber-200 space-y-2.5 text-sm"
                >
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-bold bg-amber-600 text-white px-2.5 py-0.5 rounded-lg text-xs">
                        {esc.ticket_reference}
                      </span>
                      <span className="font-bold text-slate-900">{esc.citizen_display_name}</span>
                      {esc.citizen_cnic && (
                        <span className="text-xs text-slate-600 font-mono">({esc.citizen_cnic})</span>
                      )}
                      <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-900 text-xs font-bold">
                        Assigned: {esc.assigned_admin}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                          esc.status === 'RESOLVED'
                            ? 'bg-emerald-100 text-emerald-900'
                            : esc.status === 'IN_REVIEW'
                              ? 'bg-blue-100 text-blue-900'
                              : 'bg-rose-100 text-rose-900'
                        }`}
                      >
                        {esc.status}
                      </span>
                    </div>
                    <span className="text-xs text-slate-500">{new Date(esc.created_at).toLocaleString()}</span>
                  </div>

                  <div className="text-xs text-slate-800 bg-white p-3 rounded-lg border border-amber-100 space-y-1">
                    <div>
                      <strong>Out-of-Scope Reason:</strong> {esc.reason_out_of_scope}
                    </div>
                    <div>
                      <strong>Citizen Request &amp; Summary:</strong> {esc.conversation_summary}
                    </div>
                  </div>

                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setAuditSearch(esc.session_id);
                        setActiveTab('agent-audit');
                      }}
                      className="text-xs font-bold text-indigo-700 hover:underline inline-flex items-center gap-1"
                    >
                      <Brain className="h-3.5 w-3.5" />
                      <span>Inspect Linked Agent Reasoning Trail</span>
                    </button>

                    <div className="flex items-center gap-2">
                      {esc.status === 'OPEN' && (
                        <button
                          type="button"
                          onClick={() => void handleUpdateEscalationStatus(esc.id, 'IN_REVIEW')}
                          className="px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-bold"
                        >
                          Start Review (IN_REVIEW)
                        </button>
                      )}
                      {esc.status !== 'RESOLVED' && (
                        <button
                          type="button"
                          onClick={() => void handleUpdateEscalationStatus(esc.id, 'RESOLVED')}
                          className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold"
                        >
                          Mark Resolved
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* TAB 3: AGENT REASONING & AUDIT TRAIL (PILLAR 4) */}
      {activeTab === 'agent-audit' && (
        <section
          data-testid="admin-agent-audit-panel"
          className="rounded-2xl bg-white border-2 border-indigo-200 p-5 space-y-4 shadow-xs"
        >
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <Brain className="h-5 w-5 text-indigo-700" />
                <span>Agent Reasoning &amp; Explainability Audit Trail ({filteredAuditLogs.length})</span>
              </h2>
              <p className="text-xs text-slate-600">
                Full turn-by-turn cognitive logs: User Input → Intent/Mood → RBAC Check → Capability Check → Reasoning Steps → Self-Reflection → Memory Diff → MCP Tool Calls → Final Reply.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <select
                data-testid="admin-audit-dept-filter"
                value={auditFilterDept}
                onChange={(e) => setAuditFilterDept(e.target.value as 'ALL' | ServiceDepartmentCode)}
                className="rounded-lg border border-indigo-300 bg-indigo-50/40 px-2.5 py-1.5 text-xs font-bold text-indigo-950"
              >
                <option value="ALL">All Departments</option>
                <option value="RELIEF_ASSISTANCE">Relief Assistance</option>
                <option value="SCAM_CYBER_SAFETY">Scam &amp; Cyber Safety</option>
                <option value="SYSTEM_ONBOARDING">System Onboarding</option>
                <option value="GENERAL_INQUIRY">General Inquiry</option>
              </select>
              <select
                value={auditFilterScope}
                onChange={(e) => setAuditFilterScope(e.target.value as 'ALL' | 'OUT_OF_SCOPE_ESCALATED' | 'DENIED')}
                className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold"
              >
                <option value="ALL">All Turns</option>
                <option value="OUT_OF_SCOPE_ESCALATED">Out-of-Scope Escalated Only</option>
                <option value="DENIED">RBAC Denied Only</option>
              </select>
              <input
                type="text"
                value={auditSearch}
                onChange={(e) => setAuditSearch(e.target.value)}
                placeholder="Filter by text, intent, or session..."
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs w-56"
              />
            </div>
          </div>

          {filteredAuditLogs.length === 0 ? (
            <p className="text-sm text-slate-500">No agent reasoning logs recorded yet.</p>
          ) : (
            <div className="space-y-3 max-h-[700px] overflow-y-auto">
              {filteredAuditLogs.map((log, idx) => {
                const expanded = expandedAuditIds[log.id] ?? idx < 5;
                return (
                  <div
                    key={log.id}
                    data-testid={`agent-audit-card-${idx}`}
                    className="rounded-xl border border-slate-200 bg-slate-50 overflow-hidden text-xs"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedAuditIds((prev) => ({
                          ...prev,
                          [log.id]: !expanded,
                        }))
                      }
                      className="w-full p-3.5 flex items-center justify-between flex-wrap gap-2 text-start hover:bg-slate-100"
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          data-testid="audit-dept-badge"
                          className="px-2 py-0.5 rounded bg-cyan-100 text-cyan-950 border border-cyan-200 font-bold"
                        >
                          {log.department_id ?? 'GENERAL_INQUIRY'}
                        </span>
                        <span
                          data-testid="audit-rule-version-badge"
                          className="px-2 py-0.5 rounded bg-slate-900 text-white font-mono font-bold"
                        >
                          Rule: {log.rule_version_used ?? 'v1.0'}
                        </span>
                        <span
                          data-testid="audit-model-version-badge"
                          className="px-2 py-0.5 rounded bg-slate-200 text-slate-900 font-mono font-semibold"
                        >
                          Model: {log.model_version ?? 'Awaaz-LangGraph-v2.0'}
                        </span>
                        <span
                          data-testid="audit-confidence-badge"
                          className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-950 font-mono font-bold"
                        >
                          Conf: {Math.round((log.confidence_score ?? 0.91) * 100)}%
                        </span>
                        {log.consent_event_type && (
                          <span
                            data-testid={`audit-consent-event-${log.consent_event_type}`}
                            className="px-2 py-0.5 rounded bg-rose-600 text-white font-bold"
                          >
                            {log.consent_event_type}
                          </span>
                        )}
                        <span className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-900 font-bold">
                          {log.intent_detected}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-slate-200 text-slate-800 font-semibold">
                          Stage: {log.workflow_stage} ({log.detected_language.toUpperCase()})
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-bold ${
                            log.access_control_decision.decision === 'ALLOWED'
                              ? 'bg-emerald-100 text-emerald-900'
                              : 'bg-rose-100 text-rose-900'
                          }`}
                        >
                          <ShieldCheck className="h-3 w-3" />
                          RBAC: {log.access_control_decision.decision}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded font-bold ${
                            log.capability_check === 'IN_SCOPE'
                              ? 'bg-teal-100 text-teal-900'
                              : 'bg-amber-100 text-amber-900'
                          }`}
                        >
                          {log.capability_check}
                        </span>
                        {log.memory_snapshot_diff.action !== 'NONE' && (
                          <span className="px-2 py-0.5 rounded bg-purple-100 text-purple-900 font-bold">
                            Memory: {log.memory_snapshot_diff.action}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-slate-500">
                        <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
                        {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </div>
                    </button>

                    {expanded && (
                      <div className="p-3.5 border-t border-slate-200 bg-white space-y-2.5">
                        <div>
                          <strong className="text-slate-700">User Input:</strong>{' '}
                          <span className="text-slate-900 font-medium">{log.user_input}</span>{' '}
                          <span className="text-slate-500">(Mood/Context: {log.mood_or_context_switch})</span>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                          <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
                            <div className="font-bold text-indigo-900">Reasoning Steps:</div>
                            {log.reasoning_steps.map((step, sIdx) => (
                              <div key={sIdx} className="text-slate-700">
                                • {step}
                              </div>
                            ))}
                          </div>

                          <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 space-y-1.5">
                            <div>
                              <strong className="text-emerald-800">Self-Reflection Check:</strong>{' '}
                              {log.self_reflection_check.passed ? 'PASSED' : 'FLAGGED'}{' '}
                              {log.self_reflection_check.self_corrected ? '(SELF-CORRECTED)' : ''} —{' '}
                              {log.self_reflection_check.notes}
                            </div>
                            <div>
                              <strong className="text-slate-800">RBAC Rule:</strong>{' '}
                              {log.access_control_decision.rule_reason}
                            </div>
                            <div>
                              <strong className="text-purple-800">Memory Diff:</strong>{' '}
                              [{log.memory_snapshot_diff.action}] {log.memory_snapshot_diff.summary} (Suspended:{' '}
                              {log.memory_snapshot_diff.suspended_count})
                            </div>
                          </div>
                        </div>

                        {log.langgraph_nodes_visited && log.langgraph_nodes_visited.length > 0 && (
                          <div
                            data-testid="audit-langgraph-nodes"
                            className="p-2.5 rounded-lg bg-teal-50 border border-teal-200 text-teal-950 flex flex-wrap items-center justify-between gap-2"
                          >
                            <div className="font-mono text-[11px]" dir="ltr">
                              <strong>LangGraph Nodes:</strong> {log.langgraph_nodes_visited.join(' → ')}
                            </div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {log.language_guard_status && (
                                <span
                                  data-testid="audit-language-guard"
                                  className="px-2 py-0.5 rounded bg-emerald-200 text-emerald-950 font-bold"
                                >
                                  🔒 {(log.locked_language ?? log.detected_language).toUpperCase()} | Guard:{' '}
                                  {log.language_guard_status}
                                </span>
                              )}
                              {log.mcp_protocol_info && (
                                <span
                                  data-testid="audit-mcp-protocol-badge"
                                  className="px-2 py-0.5 rounded bg-cyan-200 text-cyan-950 font-bold"
                                >
                                  {log.mcp_protocol_info.sdk} ({log.mcp_protocol_info.discovered_tools_count} tools)
                                </span>
                              )}
                            </div>
                          </div>
                        )}

                        {log.universal_rag_chunks && log.universal_rag_chunks.length > 0 && (
                          <div
                            data-testid="audit-universal-rag-box"
                            className="p-2.5 rounded-lg bg-cyan-50/70 border border-cyan-200 text-cyan-950 space-y-1"
                          >
                            <div className="font-bold text-cyan-900">
                              Universal RAG Retrieved Chunks ({log.universal_rag_chunks.length}):
                            </div>
                            {log.universal_rag_chunks.slice(0, 5).map((ch) => (
                              <div key={ch.id} className="text-[11px] text-slate-800 flex flex-wrap items-center gap-1.5">
                                <span className="px-1.5 py-0.5 rounded bg-cyan-200 text-cyan-950 font-mono font-bold">
                                  {ch.collection}
                                </span>
                                <span className="px-1.5 py-0.5 rounded bg-emerald-200 text-emerald-950 font-mono font-bold">
                                  score={ch.score.toFixed(2)}
                                </span>
                                <span className="font-semibold">{ch.title}:</span>
                                <span className="truncate max-w-md">{ch.snippet}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {log.semantic_nlu_summary && (
                          <div
                            data-testid="audit-semantic-nlu-box"
                            className="p-2.5 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-950 space-y-1"
                          >
                            <div className="flex items-center justify-between flex-wrap gap-1.5">
                              <span className="font-bold flex items-center gap-1">
                                <Sparkles className="h-3.5 w-3.5 text-indigo-700" />
                                Semantic NLU Engine ({log.semantic_nlu_summary.parser_mode})
                              </span>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="px-2 py-0.5 rounded bg-indigo-200 text-indigo-950 font-bold">
                                  Intent: {log.semantic_nlu_summary.primary_intent}
                                </span>
                                {log.semantic_nlu_summary.target_field && (
                                  <span className="px-2 py-0.5 rounded bg-amber-200 text-amber-950 font-bold">
                                    Coreference Target: {log.semantic_nlu_summary.target_field}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="text-slate-800">{log.semantic_nlu_summary.reasoning_summary}</div>
                            {Object.keys(log.semantic_nlu_summary.extracted_clean_values ?? {}).length > 0 && (
                              <div className="font-mono text-[11px] text-emerald-900 bg-emerald-50 border border-emerald-200 rounded px-2 py-1" dir="ltr">
                                Clean Extracted Values: {JSON.stringify(log.semantic_nlu_summary.extracted_clean_values)}
                              </div>
                            )}
                          </div>
                        )}

                        {log.rag_memories_retrieved && log.rag_memories_retrieved.length > 0 && (
                          <div
                            data-testid="audit-rag-matches-box"
                            className="p-2.5 rounded-lg bg-emerald-50/70 border border-emerald-200 text-emerald-950 space-y-1"
                          >
                            <div className="font-bold text-emerald-900">
                              Top-{log.rag_memories_retrieved.length} Retrieved RAG Exemplars:
                            </div>
                            {log.rag_memories_retrieved.map((m) => (
                              <div key={m.id} className="text-[11px] text-slate-800 flex flex-wrap items-center gap-1.5">
                                <span className="px-1.5 py-0.5 rounded bg-emerald-200 text-emerald-950 font-mono font-bold">
                                  sim={m.similarity.toFixed(2)}
                                </span>
                                <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-800 font-semibold">
                                  {m.source}
                                </span>
                                <span>&ldquo;{m.raw_utterance}&rdquo;</span>
                                <span className="text-indigo-800 font-semibold">
                                  → {m.resolved_intent}
                                  {m.target_field ? ` (${m.target_field})` : ''}
                                  {m.clean_value !== null ? ` = ${String(m.clean_value)}` : ''}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}

                        {log.learned_memory_saved && (
                          <div
                            data-testid="audit-learned-memory-badge"
                            className="p-2.5 rounded-lg bg-amber-50 border border-amber-300 text-amber-950 flex flex-wrap items-center gap-2"
                          >
                            <span className="px-2 py-0.5 rounded bg-amber-600 text-white font-bold">
                              ✨ SELF-LEARNED TO RAG
                            </span>
                            <span>
                              &ldquo;{log.learned_memory_saved.raw_utterance}&rdquo; →{' '}
                              <strong>{log.learned_memory_saved.resolved_intent}</strong>
                              {log.learned_memory_saved.target_field ? ` [${log.learned_memory_saved.target_field}]` : ''}
                              {log.learned_memory_saved.clean_value !== null
                                ? ` = ${String(log.learned_memory_saved.clean_value)}`
                                : ''}
                            </span>
                          </div>
                        )}

                        {log.validation_errors.length > 0 && (
                          <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-900 flex items-start gap-2">
                            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                            <div>
                              <strong>Validation Errors Caught:</strong>{' '}
                              {log.validation_errors.map((ve) => `${ve.field}: ${ve.message}`).join(' | ')}
                            </div>
                          </div>
                        )}

                        {log.mcp_tools_invoked.length > 0 && (
                          <div className="p-2.5 rounded-lg bg-slate-900 text-slate-100 font-mono space-y-1" dir="ltr">
                            <div className="text-emerald-400 font-bold">MCP Tools Invoked ({log.mcp_tools_invoked.length}):</div>
                            {log.mcp_tools_invoked.map((tc, tIdx) => (
                              <div key={tIdx} className="break-all">
                                → {tc.tool_name}({JSON.stringify(tc.arguments)}) [{tc.status}, {tc.duration_ms}ms] ⇒{' '}
                                {tc.result_summary}
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="p-2.5 rounded-lg bg-teal-50 border border-teal-200 text-teal-950">
                          <strong>Final Agent Response:</strong> {log.final_agent_response}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* TAB 4: SELF-LEARNING RAG MEMORY (LAYER 2) */}
      {activeTab === 'rag-memory' && (
        <section
          data-testid="admin-rag-memory-panel"
          className="rounded-2xl bg-white border-2 border-emerald-200 p-5 space-y-4 shadow-xs"
        >
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <Database className="h-5 w-5 text-emerald-700" />
                <span>Self-Learning Semantic RAG Memory ({ragStats?.total ?? 0})</span>
              </h2>
              <p className="text-xs text-slate-600">
                Hybrid vector + char-3gram NLU memory bank: seeded multilingual Pakistani exemplars plus live corrections automatically learned from real citizen conversations.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <select
                data-testid="rag-source-filter"
                value={ragFilterSource}
                onChange={(e) =>
                  setRagFilterSource(
                    e.target.value as 'ALL' | 'LEARNED_FROM_CORRECTION' | 'LEARNED_FROM_CONFIRMATION' | 'SEED_EXEMPLAR',
                  )
                }
                className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold"
              >
                <option value="ALL">All Patterns ({ragStats?.total ?? 0})</option>
                <option value="LEARNED_FROM_CORRECTION">Newly Learned Corrections</option>
                <option value="LEARNED_FROM_CONFIRMATION">Learned Confirmations</option>
                <option value="SEED_EXEMPLAR">Seeded Multilingual Exemplars</option>
              </select>
              <input
                type="text"
                value={ragSearch}
                onChange={(e) => setRagSearch(e.target.value)}
                placeholder="Search utterance, intent, or clean value..."
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs w-60"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5">
              <div className="text-xs text-slate-500">Total Universal RAG Docs</div>
              <div data-testid="rag-total-count" className="text-2xl font-bold text-slate-900 mt-1">
                {universalRag?.total_documents ?? ragStats?.total ?? 0}
              </div>
            </div>
            <div className="rounded-xl bg-teal-50 border border-teal-200 p-3.5">
              <div className="text-xs text-teal-700 font-semibold">Seeded Multilingual Exemplars</div>
              <div data-testid="rag-seeded-count" className="text-2xl font-bold text-teal-900 mt-1">
                {ragStats?.seeded_count ?? 0}
              </div>
            </div>
            <div className="rounded-xl bg-amber-50 border border-amber-300 p-3.5">
              <div className="text-xs text-amber-800 font-semibold">Newly Learned (Live Self-Learning)</div>
              <div data-testid="rag-learned-count" className="text-2xl font-bold text-amber-900 mt-1">
                {ragStats?.learned_count ?? 0}
              </div>
            </div>
            <div className="rounded-xl bg-indigo-50 border border-indigo-200 p-3.5">
              <div className="text-xs text-indigo-700 font-semibold">Total Retrieval Hits</div>
              <div data-testid="rag-hits-count" className="text-2xl font-bold text-indigo-900 mt-1">
                {(universalRag?.total_hits ?? 0) + (ragStats?.total_hits ?? 0)}
              </div>
            </div>
          </div>

          {/* 5 Universal RAG Collections Overview */}
          {universalRag && (
            <div
              data-testid="admin-universal-rag-collections"
              className="rounded-xl bg-cyan-50/50 border border-cyan-200 p-4 space-y-3"
            >
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h3 className="text-sm font-bold text-cyan-950">
                  Universal Hybrid RAG Explorer — 5 Persistent Collections ({universalRag.total_documents} docs)
                </h3>
                <select
                  data-testid="universal-rag-collection-filter"
                  value={universalColFilter}
                  onChange={(e) => setUniversalColFilter(e.target.value as 'ALL' | UniversalRagCollection)}
                  className="rounded-lg border border-cyan-300 bg-white px-2.5 py-1 text-xs font-semibold"
                >
                  <option value="ALL">All 5 Collections</option>
                  {universalRag.collections_summary.map((c) => (
                    <option key={c.collection} value={c.collection}>
                      {c.collection} ({c.count})
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
                {universalRag.collections_summary.map((col) => (
                  <button
                    key={col.collection}
                    type="button"
                    data-testid={`universal-rag-col-${col.collection}`}
                    onClick={() =>
                      setUniversalColFilter((prev) => (prev === col.collection ? 'ALL' : col.collection))
                    }
                    className={`p-2.5 rounded-lg border text-start transition ${
                      universalColFilter === col.collection
                        ? 'bg-cyan-700 text-white border-cyan-800'
                        : 'bg-white border-cyan-200 text-slate-800 hover:bg-cyan-50'
                    }`}
                  >
                    <div className="font-mono text-[10px] font-bold break-all">{col.collection}</div>
                    <div className="text-lg font-bold mt-0.5">{col.count} docs</div>
                    <div className="text-[10px] opacity-80">Hits: {col.hits}</div>
                  </button>
                ))}
              </div>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {universalRag.documents
                  .filter((d) => universalColFilter === 'ALL' || d.collection === universalColFilter)
                  .slice(0, 25)
                  .map((d) => (
                    <div
                      key={d.id}
                      data-testid={`universal-rag-doc-${d.collection}`}
                      className="p-2 rounded-lg bg-white border border-slate-200 text-xs flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <span className="px-1.5 py-0.5 rounded bg-cyan-100 text-cyan-900 font-mono text-[10px] font-bold me-1.5">
                          {d.collection}
                        </span>
                        <span className="font-bold text-slate-900">{d.title}:</span>{' '}
                        <span className="text-slate-700">{d.content.slice(0, 140)}</span>
                      </div>
                      <span className="shrink-0 font-mono text-[10px] text-indigo-800 font-bold">
                        hits={d.hit_count}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          <div className="space-y-2 max-h-[600px] overflow-y-auto">
            {(ragStats?.memories ?? [])
              .filter((m) => {
                if (ragFilterSource !== 'ALL' && m.source !== ragFilterSource) return false;
                if (ragSearch.trim()) {
                  const q = ragSearch.trim().toLowerCase();
                  return (
                    m.raw_utterance.toLowerCase().includes(q) ||
                    m.resolved_intent.toLowerCase().includes(q) ||
                    String(m.target_field ?? '').toLowerCase().includes(q) ||
                    String(m.clean_value ?? '').toLowerCase().includes(q)
                  );
                }
                return true;
              })
              .map((m) => (
                <div
                  key={m.id}
                  data-testid={`rag-memory-row-${m.source}`}
                  className={`p-3 rounded-xl border text-xs flex flex-wrap items-center justify-between gap-2 ${
                    m.source === 'LEARNED_FROM_CORRECTION'
                      ? 'bg-amber-50/70 border-amber-300'
                      : m.source === 'LEARNED_FROM_CONFIRMATION'
                        ? 'bg-emerald-50/60 border-emerald-200'
                        : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span
                        className={`px-2 py-0.5 rounded font-bold ${
                          m.source === 'LEARNED_FROM_CORRECTION'
                            ? 'bg-amber-600 text-white'
                            : m.source === 'LEARNED_FROM_CONFIRMATION'
                              ? 'bg-emerald-700 text-white'
                              : 'bg-slate-700 text-white'
                        }`}
                      >
                        {m.source}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-900 font-bold">
                        {m.resolved_intent}
                      </span>
                      {m.target_field && (
                        <span className="px-2 py-0.5 rounded bg-teal-100 text-teal-900 font-semibold">
                          Field: {m.target_field}
                        </span>
                      )}
                      {m.clean_value !== null && (
                        <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-950 font-mono font-bold">
                          Clean: {String(m.clean_value)}
                        </span>
                      )}
                      <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 font-semibold">
                        {m.language.toUpperCase()}
                      </span>
                    </div>
                    <div className="text-slate-900 font-medium break-words">&ldquo;{m.raw_utterance}&rdquo;</div>
                  </div>
                  <div className="text-end shrink-0 space-y-0.5">
                    <div className="font-bold text-indigo-800">Hits: {m.hit_count}</div>
                    <div className="text-[10px] text-slate-500">{new Date(m.created_at).toLocaleTimeString()}</div>
                  </div>
                </div>
              ))}
          </div>
        </section>
      )}

      {activeTab === 'overview' && (
        <>

      {metrics && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="rounded-xl bg-white border border-slate-200 p-4">
            <div className="text-xs text-slate-500 flex items-center gap-1"><BarChart3 className="h-3.5 w-3.5" /> {dict.admin.totalCases}</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{metrics.total_cases}</div>
          </div>
          <div className="rounded-xl bg-white border border-slate-200 p-4">
            <div className="text-xs text-slate-500">{dict.admin.members}</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{metrics.total_members}</div>
          </div>
          <div className="rounded-xl bg-white border border-slate-200 p-4">
            <div className="text-xs text-slate-500">{dict.admin.rulesets}</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{metrics.total_rules}</div>
          </div>
          <div className="rounded-xl bg-white border border-slate-200 p-4">
            <div className="text-xs text-slate-500">{dict.admin.policies}</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{metrics.total_policies}</div>
          </div>
          <div className="rounded-xl bg-white border border-slate-200 p-4">
            <div className="text-xs text-slate-500">{dict.admin.aiRunsLogged}</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{metrics.total_ai_runs}</div>
          </div>
        </div>
      )}

      {/* Module 5 (Challenge 08): Forgery & False-Alarm Metrics Mini-Card */}
      {docAuthMetrics && (
        <div
          data-testid="admin-forgery-metrics"
          className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs"
        >
          <div className="rounded-xl bg-white border border-slate-200 p-3.5">
            <div className="text-slate-500">Documents Scanned</div>
            <div className="text-xl font-bold text-slate-900 mt-1">{docAuthMetrics.total_scanned}</div>
          </div>
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3.5">
            <div className="text-emerald-800 font-semibold">Verified Authentic</div>
            <div className="text-xl font-bold text-emerald-950 mt-1">{docAuthMetrics.verified_authentic}</div>
          </div>
          <div className="rounded-xl bg-rose-50 border border-rose-200 p-3.5">
            <div className="text-rose-800 font-semibold">Likely Forged Flagged</div>
            <div className="text-xl font-bold text-rose-950 mt-1">{docAuthMetrics.likely_forged_flagged}</div>
          </div>
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-3.5">
            <div className="text-amber-900 font-semibold">False Alarms Protected (Unblocked)</div>
            <div className="text-xl font-bold text-amber-950 mt-1">{docAuthMetrics.possible_false_alarms_protected}</div>
          </div>
        </div>
      )}

      {/* PHASE 2: Admin Read-Only Oversight Table — Officer Decisions & Reasons (NO direct Approve/Reject by Admin!) */}
      <section
        data-testid="admin-officer-decisions-section"
        className="rounded-2xl bg-white border-2 border-teal-200 p-5 space-y-4 shadow-xs"
      >
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5 text-teal-700" />
              <span>Officer Decisions &amp; Reasons ({submittedCases.length})</span>
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Read-only governance oversight — approvals and rejections are executed strictly by assigned Department Officers.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadAdminData()}
            className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold hover:bg-slate-50"
          >
            {dict.refresh}
          </button>
        </div>

        {submittedCases.length === 0 ? (
          <p className="text-sm text-slate-500">No citizen applications submitted yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table data-testid="admin-officer-decisions-table" className="w-full text-start text-xs sm:text-sm border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-slate-600 text-xs uppercase">
                  <th className="py-2.5 pe-3 text-start">Ref</th>
                  <th className="py-2.5 pe-3 text-start">Citizen</th>
                  <th className="py-2.5 pe-3 text-start">Rule Version</th>
                  <th className="py-2.5 pe-3 text-start">Department</th>
                  <th className="py-2.5 pe-3 text-start">Officer</th>
                  <th className="py-2.5 pe-3 text-start">Status</th>
                  <th className="py-2.5 text-start">Officer Decision Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {submittedCases.map((c) => {
                  const refCode = `AWZ-${c.id.slice(0, 8).toUpperCase()}`;
                  return (
                    <tr key={c.id} data-testid={`admin-case-row-${refCode}`} className="hover:bg-slate-50/70">
                      <td className="py-3 pe-3 font-mono font-bold text-teal-900 whitespace-nowrap" dir="ltr">
                        {refCode}
                      </td>
                      <td className="py-3 pe-3">
                        <div className="font-semibold text-slate-900">{c.citizen_display_name}</div>
                        <div className="text-[11px] text-slate-500 font-mono" dir="ltr">
                          {c.mock_identity_reference}
                        </div>
                      </td>
                      <td className="py-3 pe-3 whitespace-nowrap">
                        <span
                          data-testid={`admin-case-rule-version-${refCode}`}
                          className="px-2 py-0.5 rounded bg-slate-900 text-white font-mono font-bold text-xs"
                        >
                          {c.rule_version_used ?? 'v1.0'}
                        </span>
                        {c.decision_tier && (
                          <div className="text-[10px] text-slate-600 font-semibold mt-0.5">{c.decision_tier}</div>
                        )}
                      </td>
                      <td className="py-3 pe-3 whitespace-nowrap">
                        <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-900 text-xs font-bold">
                          {c.assigned_department ?? 'RELIEF_ASSISTANCE'}
                        </span>
                      </td>
                      <td className="py-3 pe-3 text-slate-800 whitespace-nowrap">
                        {c.decided_by_officer_name ?? <span className="text-slate-400">Assigned to Dept Queue</span>}
                      </td>
                      <td className="py-3 pe-3 whitespace-nowrap">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                            c.status === 'APPROVED' || c.status === 'MOCK_PAYMENT_COMPLETED'
                              ? 'bg-emerald-100 text-emerald-900'
                              : c.status === 'REJECTED'
                                ? 'bg-rose-100 text-rose-900'
                                : 'bg-amber-100 text-amber-900'
                          }`}
                        >
                          {statusLabel(c.status)}
                        </span>
                      </td>
                      <td data-testid={`admin-decision-reason-${refCode}`} className="py-3 text-slate-800 max-w-sm">
                        {c.decision_reason ? (
                          <span className="font-medium">{c.decision_reason}</span>
                        ) : (
                          <span className="text-slate-400 italic">Awaiting officer review</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Super Admin Authority: Create Departments & Provision Department Accounts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="rounded-2xl bg-white border border-teal-200 p-5 space-y-4 shadow-xs">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-teal-700" />
            {dict.admin.createStaffTitle}
          </h2>
          <form onSubmit={(e) => void handleCreateDepartmentAccount(e)} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <input
                type="text"
                required
                minLength={2}
                placeholder={dict.admin.staffNamePlaceholder}
                value={staffName}
                onChange={(e) => setStaffName(e.target.value)}
                className="rounded-xl border border-slate-300 px-3 py-2.5"
              />
              <input
                type="email"
                dir="ltr"
                required
                placeholder={dict.admin.staffEmailPlaceholder}
                value={staffEmail}
                onChange={(e) => setStaffEmail(e.target.value)}
                className="rounded-xl border border-slate-300 px-3 py-2.5"
              />
              <input
                type="password"
                dir="ltr"
                required
                minLength={8}
                placeholder={dict.admin.staffPasswordPlaceholder}
                value={staffPassword}
                onChange={(e) => setStaffPassword(e.target.value)}
                className="rounded-xl border border-slate-300 px-3 py-2.5"
              />
              <select
                value={staffRole}
                onChange={(e) => setStaffRole(e.target.value as 'officer' | 'helper' | 'admin')}
                className="rounded-xl border border-slate-300 px-3 py-2.5"
              >
                <option value="officer">{roleLabel('officer')}</option>
                <option value="helper">{roleLabel('helper')}</option>
                <option value="admin">{roleLabel('admin')}</option>
              </select>
            </div>
            <label className="block space-y-1 text-sm">
              <span className="text-xs font-medium text-slate-600">{dict.admin.assignDeptLabel}</span>
              <select
                value={staffDeptId}
                onChange={(e) => setStaffDeptId(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5"
              >
                <option value="">{dict.admin.noDepartmentOption}</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.code})
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="px-5 py-2.5 rounded-xl bg-teal-700 text-white text-sm font-semibold hover:bg-teal-800">
              {dict.admin.createAccountBtn}
            </button>
          </form>
        </section>

        <section className="rounded-2xl bg-white border border-slate-200 p-5 space-y-4">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Building2 className="h-5 w-5 text-teal-700" />
            {dict.admin.deptAccountsListTitle}
          </h2>
          <form onSubmit={(e) => void handleCreateDepartment(e)} className="flex flex-wrap gap-2">
            <input
              type="text"
              required
              minLength={2}
              placeholder={dict.admin.deptNamePlaceholder}
              value={deptName}
              onChange={(e) => setDeptName(e.target.value)}
              className="flex-1 min-w-[160px] rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <input
              type="text"
              dir="ltr"
              required
              minLength={2}
              placeholder={dict.admin.deptCodePlaceholder}
              value={deptCode}
              onChange={(e) => setDeptCode(e.target.value)}
              className="w-36 rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <button type="submit" className="px-3.5 py-2 rounded-lg bg-slate-800 text-white text-sm font-semibold hover:bg-slate-900">
              {dict.admin.createDeptBtn}
            </button>
          </form>

          <div className="space-y-2 max-h-56 overflow-y-auto pt-2 border-t border-slate-200">
            {accounts.map((acc) => (
              <div key={acc.user_id} className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-2 text-xs">
                <div>
                  <div className="font-bold text-slate-900">{acc.display_name}</div>
                  <div className="text-slate-500">
                    <span dir="ltr">{acc.email}</span>
                    {acc.department_name ? ` • ${acc.department_name}` : ''}
                  </div>
                </div>
                <span className="px-2.5 py-0.5 rounded-full bg-teal-100 text-teal-900 font-semibold">
                  {roleLabel(acc.role)}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Rules & Policy Management */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="rounded-2xl bg-white border border-slate-200 p-5 space-y-4">
          <h2 className="text-lg font-bold">{dict.admin.ruleEditorTitle}</h2>
          <form onSubmit={(e) => void handlePublishRuleVersion(e)} className="space-y-3">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <label className="space-y-1">
                <span className="text-xs font-medium text-slate-600">{dict.admin.maxIncomeLabel}</span>
                <input
                  type="number"
                  required
                  value={incomeLimit}
                  onChange={(e) => setIncomeLimit(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-slate-600">{dict.admin.defaultGrantLabel}</span>
                <input
                  type="number"
                  required
                  value={mockGrantPkr}
                  onChange={(e) => setMockGrantPkr(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-slate-600">{dict.admin.officerReadyMinLabel}</span>
                <input
                  type="number"
                  required
                  value={officerReadyMin}
                  onChange={(e) => setOfficerReadyMin(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-slate-600">{dict.admin.needsMoreInfoMinLabel}</span>
                <input
                  type="number"
                  required
                  value={needsMoreInfoMin}
                  onChange={(e) => setNeedsMoreInfoMin(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>
            </div>
            <button type="submit" className="px-4 py-2.5 rounded-xl bg-teal-700 text-white text-sm font-semibold hover:bg-teal-800">
              {dict.admin.publishRuleBtn}
            </button>
          </form>

          <div className="pt-3 border-t border-slate-200 space-y-2">
            <h3 className="text-sm font-bold text-slate-800">{dict.admin.ruleHistoryTitle} ({versions.length})</h3>
            {versions.map((v) => {
              const isActive = rules.some((r) => r.rule.active_version_id === v.id);
              const inc = v.rules_json.conditions.find((c) => c.field === 'monthly_income')?.value;
              return (
                <div key={v.id} className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs flex items-center justify-between gap-2">
                  <div>
                    <div className="font-bold text-slate-900">
                      v{v.version_number} {isActive ? `(${dict.active})` : ''}
                    </div>
                    <div className="text-slate-600">
                      &le; {String(inc ?? '—')} PKR • {dict.admin.casesEvaluated}: {v.cases_evaluated_count}
                    </div>
                  </div>
                  <span className="text-slate-400">{new Date(v.published_at).toLocaleDateString()}</span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-2xl bg-white border border-slate-200 p-5 space-y-4">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-teal-700" />
            {dict.admin.policyKbTitle} ({policies.length})
          </h2>
          <form onSubmit={(e) => void handleCreatePolicy(e)} className="space-y-2.5">
            <input
              type="text"
              required
              placeholder={dict.admin.policyTitlePlaceholder}
              value={policyTitle}
              onChange={(e) => setPolicyTitle(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <input
              type="text"
              dir="ltr"
              required
              placeholder={dict.admin.policyRefPlaceholder}
              value={policyRef}
              onChange={(e) => setPolicyRef(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <textarea
              rows={3}
              required
              minLength={20}
              placeholder={dict.admin.policyContentPlaceholder}
              value={policyContent}
              onChange={(e) => setPolicyContent(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <button type="submit" className="px-4 py-2 rounded-xl bg-teal-700 text-white text-sm font-semibold">
              {dict.admin.ingestPolicyBtn}
            </button>
          </form>

          <div className="space-y-2 pt-2 border-t border-slate-200 max-h-64 overflow-y-auto">
            {policies.map((p) => (
              <div key={p.id} className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                <div className="font-bold text-slate-900">{p.source_reference}: {p.title}</div>
                <div className="text-slate-500">v{p.version} • {p.language} • {dict.admin.effectiveLabel} {p.effective_date}</div>
              </div>
            ))}
          </div>
        </section>
      </div>
        </>
      )}
    </div>
  );
}
