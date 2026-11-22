'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  CASE_STATUSES,
  type AgentReasoningAuditLogRecord,
  type AssistanceRequestRecord,
  type CaseAnswerRecord,
  type CaseRecord,
  type CaseReviewRecord,
  type CitizenRecord,
  type DocumentAuthenticityMetrics,
  type DocumentRecord,
  type DynamicRuleVersionRecord,
  type HumanizedGuidanceRecord,
  type MockPaymentRecord,
  type OfficerInquiryRecord,
  type ServiceDepartmentCode,
} from '@awaaz/shared';
import {
  AlertTriangle,
  Brain,
  CheckCircle2,
  ClipboardCheck,
  ExternalLink,
  Lock,
  MessageSquareHeart,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  Wallet,
  XCircle,
} from 'lucide-react';
import { API_BASE_URL, ApiClientError, apiRequest } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/context';
import { formatText, useI18n } from '@/lib/i18n/context';
import { getRoleLandingRoute } from '@/lib/modules/registry';

interface QueueCase extends CaseRecord {
  citizen_display_name: string;
  mock_identity_reference: string;
}

interface OfficerCaseDetail {
  case: CaseRecord;
  citizen: CitizenRecord | null;
  answers: CaseAnswerRecord[];
  documents: DocumentRecord[];
  reviews: CaseReviewRecord[];
  mock_payments: MockPaymentRecord[];
  has_active_processing_consent: boolean;
}

export default function OfficerDashboardPage() {
  const { user, token, activeOrganizationId } = useAuth();
  const { language, dict, statusLabel, docTypeLabel, roleLabel } = useI18n();

  const [activeTab, setActiveTab] = useState<'cases' | 'inquiries' | 'chat' | 'audit-trails'>('cases');
  const [officerDepartment, setOfficerDepartment] = useState<ServiceDepartmentCode | null>(null);
  const [deptAuditLogs, setDeptAuditLogs] = useState<AgentReasoningAuditLogRecord[]>([]);
  const [docMetrics, setDocMetrics] = useState<DocumentAuthenticityMetrics | null>(null);
  const [activeRule, setActiveRule] = useState<DynamicRuleVersionRecord | null>(null);
  const [queue, setQueue] = useState<QueueCase[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<OfficerCaseDetail | null>(null);

  // Phase 4: Citizen Direct Inquiries state
  const [officerInquiries, setOfficerInquiries] = useState<OfficerInquiryRecord[]>([]);
  const [inquiryReplyDrafts, setInquiryReplyDrafts] = useState<Record<string, string>>({});

  // Humanized Chatbot Assistance state
  const [assistanceRequests, setAssistanceRequests] = useState<AssistanceRequestRecord[]>([]);
  const [guidanceList, setGuidanceList] = useState<HumanizedGuidanceRecord[]>([]);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [saveGuidanceFlags, setSaveGuidanceFlags] = useState<Record<string, boolean>>({});
  const [newGuideQ, setNewGuideQ] = useState('');
  const [newGuideA, setNewGuideA] = useState('');

  const [decisionReason, setDecisionReason] = useState('');
  const [internalNotes, setInternalNotes] = useState('');
  const [citizenMessage, setCitizenMessage] = useState('');
  const [missingItemsText, setMissingItemsText] = useState('');
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    if (!token || !activeOrganizationId || user?.active_role !== 'officer') return;
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    if (search.trim()) params.set('search', search.trim());
    try {
      const [casesRes, assistRes, guideRes, inqRes, auditRes, docMetRes, ruleRes] = await Promise.all([
        apiRequest<{ cases: QueueCase[]; officer_department?: ServiceDepartmentCode | null }>(
          `/officer/cases${params.toString() ? `?${params.toString()}` : ''}`,
          { token, organizationId: activeOrganizationId },
        ),
        apiRequest<{ requests: AssistanceRequestRecord[] }>('/assistance/requests', {
          token,
          organizationId: activeOrganizationId,
        }),
        apiRequest<{ guidance: HumanizedGuidanceRecord[] }>('/assistance/guidance', {
          token,
          organizationId: activeOrganizationId,
        }),
        apiRequest<{ inquiries: OfficerInquiryRecord[] }>('/officer-inquiries', {
          token,
          organizationId: activeOrganizationId,
        }),
        apiRequest<{ logs: AgentReasoningAuditLogRecord[]; department_id: ServiceDepartmentCode | null }>(
          '/officer/agent-audit-trail',
          { token, organizationId: activeOrganizationId },
        ),
        apiRequest<{ metrics: DocumentAuthenticityMetrics }>('/documents/authenticity-metrics', {
          token,
          organizationId: activeOrganizationId,
        }),
        apiRequest<{ active_version: DynamicRuleVersionRecord }>('/rules/versions', {
          token,
          organizationId: activeOrganizationId,
        }),
      ]);
      setQueue(casesRes.cases);
      setOfficerDepartment(auditRes.department_id ?? casesRes.officer_department ?? null);
      setDeptAuditLogs(auditRes.logs);
      setDocMetrics(docMetRes.metrics);
      setActiveRule(ruleRes.active_version);
      setAssistanceRequests(assistRes.requests);
      setGuidanceList(guideRes.guidance);
      setOfficerInquiries(inqRes.inquiries);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : dict.auth.authFailed);
    }
  }, [token, activeOrganizationId, user?.active_role, statusFilter, search, dict.auth.authFailed]);

  const loadDetail = useCallback(
    async (caseId: string) => {
      if (!token || !activeOrganizationId) return;
      try {
        const res = await apiRequest<OfficerCaseDetail>(`/cases/${caseId}`, {
          token,
          organizationId: activeOrganizationId,
        });
        setSelected(res);
      } catch (err) {
        setError(err instanceof ApiClientError ? err.message : dict.auth.authFailed);
      }
    },
    [token, activeOrganizationId, dict.auth.authFailed],
  );

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  if (!user) {
    return (
      <div className="rounded-xl bg-white border border-slate-200 p-8 text-center space-y-3">
        <p className="text-slate-700">{dict.officer.roleRequired}</p>
        <Link href="/login" className="inline-block px-5 py-2.5 rounded-xl bg-teal-700 text-white font-semibold">
          {dict.officer.signInAsOfficer}
        </Link>
      </div>
    );
  }

  if (user.active_role !== 'officer') {
    return (
      <div className="rounded-xl bg-white border border-rose-200 p-8 text-center space-y-3">
        <p className="text-slate-700">{dict.officer.roleRequired}</p>
        <Link
          href={getRoleLandingRoute(user.active_role)}
          className="inline-block px-5 py-2.5 rounded-xl bg-teal-700 text-white font-semibold"
        >
          {formatText(dict.home.openRoleWorkspace, { role: roleLabel(user.active_role) })}
        </Link>
      </div>
    );
  }

  const handleDecision = async (decision: 'APPROVED' | 'REJECTED') => {
    if (!selected || !token) return;
    if (decisionReason.trim().length < 3) {
      setError('A mandatory decision reason (at least 3 characters) is required before approving or rejecting.');
      return;
    }
    setBusy(true);
    setError(null);
    setBanner(null);
    try {
      await apiRequest(`/cases/${selected.case.id}/decision`, {
        method: 'POST',
        token,
        organizationId: activeOrganizationId,
        body: {
          decision,
          decision_reason: decisionReason.trim(),
          internal_notes: internalNotes.trim() || decisionReason.trim(),
          citizen_message:
            citizenMessage.trim() ||
            `${formatText(dict.officer.decisionRecordedMsg, { decision: statusLabel(decision) })} — ${decisionReason.trim()}`,
        },
      });
      setDecisionReason('');
      setInternalNotes('');
      setCitizenMessage('');
      setBanner(formatText(dict.officer.decisionRecordedMsg, { decision: statusLabel(decision) }));
      await loadDetail(selected.case.id);
      await loadQueue();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : dict.auth.authFailed);
    } finally {
      setBusy(false);
    }
  };

  const handleRequestInfo = async () => {
    if (!selected || !token) return;
    const items = missingItemsText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (items.length === 0) {
      setError(dict.officer.missingItemsPlaceholder);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiRequest(`/cases/${selected.case.id}/request-information`, {
        method: 'POST',
        token,
        organizationId: activeOrganizationId,
        body: {
          missing_items: items,
          internal_notes: internalNotes,
          citizen_message: citizenMessage.trim() || dict.officer.requestedInfoMsg,
        },
      });
      setMissingItemsText('');
      setBanner(dict.officer.requestedInfoMsg);
      await loadDetail(selected.case.id);
      await loadQueue();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : dict.auth.authFailed);
    } finally {
      setBusy(false);
    }
  };

  const handleMockPayment = async () => {
    if (!selected || !token) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiRequest<{ payment: MockPaymentRecord }>('/mock-payments', {
        method: 'POST',
        token,
        organizationId: activeOrganizationId,
        body: { case_id: selected.case.id },
      });
      setBanner(
        formatText(dict.officer.mockPaymentMsg, {
          ref: res.payment.reference_code,
          amount: res.payment.amount_pkr,
        }),
      );
      await loadDetail(selected.case.id);
      await loadQueue();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : dict.auth.authFailed);
    } finally {
      setBusy(false);
    }
  };

  const openSignedDocument = async (docId: string) => {
    if (!token) return;
    try {
      const res = await apiRequest<{ signedUrl: string }>(`/documents/${docId}`, {
        token,
        organizationId: activeOrganizationId,
      });
      const fullUrl = res.signedUrl.startsWith('http')
        ? res.signedUrl
        : `${API_BASE_URL.replace(/\/api\/v1$/, '')}${res.signedUrl}`;
      window.open(fullUrl, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : dict.auth.authFailed);
    }
  };

  const handleReplyAssistance = async (reqId: string) => {
    const replyText = (replyDrafts[reqId] ?? '').trim();
    if (!replyText || !token) return;
    setBusy(true);
    setError(null);
    setBanner(null);
    try {
      await apiRequest(`/assistance/requests/${reqId}/respond`, {
        method: 'POST',
        token,
        organizationId: activeOrganizationId,
        body: {
          humanized_reply: replyText,
          save_as_guidance: Boolean(saveGuidanceFlags[reqId]),
        },
      });
      setReplyDrafts((prev) => ({ ...prev, [reqId]: '' }));
      setBanner(dict.deptChat.replySentMsg);
      await loadQueue();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : dict.auth.authFailed);
    } finally {
      setBusy(false);
    }
  };

  const handleAddDirectGuidance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGuideQ.trim() || !newGuideA.trim() || !token) return;
    setBusy(true);
    setError(null);
    setBanner(null);
    try {
      await apiRequest('/assistance/guidance', {
        method: 'POST',
        token,
        organizationId: activeOrganizationId,
        body: {
          service_id: 'MOCK_RELIEF_01',
          language,
          question_pattern: newGuideQ.trim(),
          humanized_answer: newGuideA.trim(),
        },
      });
      setNewGuideQ('');
      setNewGuideA('');
      setBanner(dict.deptChat.guidanceAddedMsg);
      await loadQueue();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : dict.auth.authFailed);
    } finally {
      setBusy(false);
    }
  };

  const handleReplyDirectInquiry = async (inqId: string) => {
    const replyText = (inquiryReplyDrafts[inqId] ?? '').trim();
    if (!replyText || !token) return;
    setBusy(true);
    setError(null);
    setBanner(null);
    try {
      const res = await apiRequest<{ inquiry: OfficerInquiryRecord }>(`/officer-inquiries/${inqId}/reply`, {
        method: 'POST',
        token,
        organizationId: activeOrganizationId,
        body: { officer_reply: replyText },
      });
      setOfficerInquiries((prev) => prev.map((item) => (item.id === inqId ? res.inquiry : item)));
      setInquiryReplyDrafts((prev) => ({ ...prev, [inqId]: '' }));
      setBanner(dict.officerInquiry.replySentSuccess);
      await loadQueue();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : dict.auth.authFailed);
    } finally {
      setBusy(false);
    }
  };

  const openChatCount = assistanceRequests.filter((r) => r.status === 'OPEN').length;
  const openInquiriesCount = officerInquiries.filter((i) => i.status === 'OPEN').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <ClipboardCheck className="h-6 w-6 text-teal-700" />
              {dict.officer.title}
            </h1>
            {officerDepartment && (
              <span
                data-testid="officer-department-badge"
                className="px-3 py-1 rounded-full bg-indigo-100 text-indigo-900 border border-indigo-200 text-xs font-bold"
              >
                Department: {officerDepartment}
              </span>
            )}
          </div>
          <p className="text-sm text-slate-600 mt-0.5">{user.display_name}</p>
        </div>

        {/* Mode Switcher: Case Review Queue | Direct Inquiries | Humanized Chat | AI Audit Trails (Read-Only) */}
        <div className="inline-flex flex-wrap rounded-xl bg-slate-200/80 p-1 gap-1">
          <button
            type="button"
            data-testid="officer-tab-cases"
            onClick={() => setActiveTab('cases')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${
              activeTab === 'cases' ? 'bg-white text-teal-800 shadow-xs' : 'text-slate-700'
            }`}
          >
            {dict.deptChat.tabCases} ({queue.length})
          </button>
          <button
            type="button"
            data-testid="officer-tab-inquiries"
            onClick={() => setActiveTab('inquiries')}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition ${
              activeTab === 'inquiries' ? 'bg-white text-teal-800 shadow-xs' : 'text-slate-700'
            }`}
          >
            <Send className="h-4 w-4 text-amber-600" />
            <span>{dict.officerInquiry.officerTabTitle} ({officerInquiries.length})</span>
            {openInquiriesCount > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-amber-600 text-white text-xs">{openInquiriesCount}</span>
            )}
          </button>
          <button
            type="button"
            data-testid="officer-tab-chat"
            onClick={() => setActiveTab('chat')}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition ${
              activeTab === 'chat' ? 'bg-white text-teal-800 shadow-xs' : 'text-slate-700'
            }`}
          >
            <MessageSquareHeart className="h-4 w-4 text-teal-700" />
            {dict.deptChat.tabHumanizedChat}
            {openChatCount > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-rose-600 text-white text-xs">{openChatCount}</span>
            )}
          </button>
          <button
            type="button"
            data-testid="officer-tab-audit-trails"
            onClick={() => setActiveTab('audit-trails')}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition ${
              activeTab === 'audit-trails' ? 'bg-white text-indigo-800 shadow-xs' : 'text-slate-700'
            }`}
          >
            <Brain className="h-4 w-4 text-indigo-700" />
            <span>AI Audit Trails (Read-Only) ({deptAuditLogs.length})</span>
          </button>
        </div>
      </div>

      {banner && <div className="rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 px-4 py-3 text-sm">{banner}</div>}
      {error && <div className="rounded-xl bg-rose-50 border border-rose-200 text-rose-900 px-4 py-3 text-sm">{error}</div>}

      {/* Compact Forgery & False-Alarm Protection Mini-Card + Active Policy Badge */}
      {(docMetrics || activeRule) && (
        <div
          data-testid="officer-forgery-metrics"
          className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs"
        >
          <div className="rounded-xl bg-white border border-slate-200 p-3">
            <div className="text-slate-500">Active Policy Rule</div>
            <div className="text-base font-bold text-indigo-900 mt-0.5">
              {activeRule?.version ?? 'v1.0'} (Max {activeRule?.max_monthly_income_pkr.toLocaleString() ?? '25,000'} PKR)
            </div>
          </div>
          <div className="rounded-xl bg-white border border-slate-200 p-3">
            <div className="text-slate-500">Docs Scanned</div>
            <div className="text-base font-bold text-slate-900 mt-0.5">{docMetrics?.total_scanned ?? 0}</div>
          </div>
          <div className="rounded-xl bg-rose-50/70 border border-rose-200 p-3">
            <div className="text-rose-800">Likely Forged Flagged</div>
            <div className="text-base font-bold text-rose-900 mt-0.5">{docMetrics?.likely_forged_flagged ?? 0}</div>
          </div>
          <div className="rounded-xl bg-amber-50/70 border border-amber-200 p-3">
            <div className="text-amber-900">False Alarms Protected</div>
            <div className="text-base font-bold text-amber-950 mt-0.5">{docMetrics?.possible_false_alarms_protected ?? 0}</div>
          </div>
        </div>
      )}

      {activeTab === 'audit-trails' ? (
        <section
          data-testid="officer-audit-trails-panel"
          className="rounded-2xl bg-white border-2 border-indigo-200 p-5 space-y-4 shadow-xs"
        >
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <Brain className="h-5 w-5 text-indigo-700" />
                <span>Department AI Audit Trails ({deptAuditLogs.length})</span>
              </h2>
              <p className="text-xs text-slate-600 mt-0.5">
                Strictly scoped to <strong>{officerDepartment ?? 'your department'}</strong> — read-only inspection.
              </p>
            </div>
            <span
              data-testid="officer-audit-readonly-badge"
              className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-slate-100 border border-slate-300 text-slate-700 text-xs font-bold"
            >
              <Lock className="h-3.5 w-3.5" />
              <span>Read-Only</span>
            </span>
          </div>

          {deptAuditLogs.length === 0 ? (
            <p className="text-sm text-slate-500 py-4">
              No AI audit trails recorded for {officerDepartment ?? 'this department'} yet.
            </p>
          ) : (
            <div className="space-y-3 max-h-[680px] overflow-y-auto">
              {deptAuditLogs.map((log, idx) => (
                <div
                  key={log.id}
                  data-testid={`officer-audit-row-${idx}`}
                  data-department-id={log.department_id ?? 'GENERAL_INQUIRY'}
                  className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2 text-xs"
                >
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        data-testid="officer-audit-dept-pill"
                        className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-900 font-bold"
                      >
                        {log.department_id ?? 'GENERAL_INQUIRY'}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-teal-100 text-teal-900 font-bold">
                        {log.intent_detected}
                      </span>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 font-semibold">
                        <ShieldCheck className="h-3 w-3" />
                        RBAC: {log.access_control_decision.decision}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-slate-200 text-slate-800 font-semibold">
                        {log.detected_language.toUpperCase()}
                      </span>
                    </div>
                    <span className="text-slate-500">{new Date(log.timestamp).toLocaleString()}</span>
                  </div>

                  <div className="text-slate-900">
                    <strong>Citizen Input:</strong> {log.user_input}
                  </div>
                  <div className="text-teal-950 bg-teal-50 border border-teal-200 rounded-lg p-2.5">
                    <strong>AI Response:</strong> {log.final_agent_response}
                  </div>
                  {log.mcp_tools_invoked.length > 0 && (
                    <div className="font-mono text-[11px] bg-slate-900 text-emerald-300 rounded-lg p-2" dir="ltr">
                      Tools: {log.mcp_tools_invoked.map((t) => t.tool_name).join(', ')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      ) : activeTab === 'inquiries' ? (
        <section
          data-testid="officer-inquiries-panel"
          className="rounded-2xl bg-white border border-slate-200 p-5 space-y-4 shadow-xs"
        >
          <div>
            <h2 className="text-lg font-bold text-slate-900">{dict.officerInquiry.officerInboxTitle}</h2>
            <p className="text-xs text-slate-600 mt-1">{dict.officerInquiry.officerInboxSubtitle}</p>
          </div>

          {officerInquiries.length === 0 ? (
            <p className="text-sm text-slate-500 py-4">{dict.officerInquiry.noInquiries}</p>
          ) : (
            <div className="space-y-4">
              {officerInquiries.map((inq) => (
                <div
                  key={inq.id}
                  data-testid={`inquiry-row-${inq.tracking_reference}`}
                  className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-3 text-sm"
                >
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-bold text-teal-900 bg-teal-50 border border-teal-200 px-2 py-0.5 rounded-md text-xs" dir="ltr">
                        {inq.tracking_reference}
                      </span>
                      <span className="font-bold text-slate-900">{inq.citizen_name}</span>
                      {inq.application_ref && (
                        <span className="text-xs text-slate-600 font-mono" dir="ltr">
                          ({dict.officerInquiry.linkedAppLabel}: {inq.application_ref})
                        </span>
                      )}
                    </div>
                    <span
                      className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${
                        inq.status === 'OPEN' ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-900'
                      }`}
                    >
                      {inq.status}
                    </span>
                  </div>

                  <p className="font-medium text-slate-900 bg-white border border-slate-200 rounded-lg p-3">
                    {inq.question_text}
                  </p>

                  {inq.status === 'ANSWERED' && inq.officer_reply ? (
                    <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-emerald-950 text-sm">
                      <strong>{dict.officerInquiry.officialReplyLabel}:</strong> {inq.officer_reply}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <textarea
                        data-testid={`inquiry-reply-input-${inq.tracking_reference}`}
                        rows={2}
                        placeholder={dict.officerInquiry.replyPlaceholder}
                        value={inquiryReplyDrafts[inq.id] ?? ''}
                        onChange={(e) => setInquiryReplyDrafts((prev) => ({ ...prev, [inq.id]: e.target.value }))}
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                      />
                      <button
                        type="button"
                        data-testid={`inquiry-reply-submit-${inq.tracking_reference}`}
                        disabled={busy || !(inquiryReplyDrafts[inq.id] ?? '').trim()}
                        onClick={() => void handleReplyDirectInquiry(inq.id)}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-teal-700 text-white text-sm font-semibold hover:bg-teal-800 disabled:opacity-50"
                      >
                        <Send className="h-4 w-4" />
                        <span>{dict.officerInquiry.sendOfficialReplyBtn}</span>
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      ) : activeTab === 'chat' ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Live Citizen Questions Escalated from Chatbot */}
          <section className="rounded-2xl bg-white border border-slate-200 p-5 space-y-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <MessageSquareHeart className="h-5 w-5 text-teal-700" />
                {dict.deptChat.inboxTitle}
              </h2>
              <p className="text-xs text-slate-600 mt-1">{dict.deptChat.inboxSubtitle}</p>
            </div>

            {assistanceRequests.length === 0 ? (
              <p className="text-sm text-slate-500 py-4">{dict.deptChat.noOpenRequests}</p>
            ) : (
              <div className="space-y-4">
                {assistanceRequests.map((req) => (
                  <div key={req.id} className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-slate-900">
                        {req.citizen_display_name ?? dict.roles.citizen} ({req.language})
                      </span>
                      <span
                        className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${
                          req.status === 'OPEN'
                            ? 'bg-amber-100 text-amber-900'
                            : 'bg-emerald-100 text-emerald-900'
                        }`}
                      >
                        {req.status === 'OPEN' ? dict.deptChat.openBadge : dict.deptChat.answeredBadge}
                      </span>
                    </div>

                    <p className="font-medium text-slate-900 bg-white border border-slate-200 rounded-lg p-3">
                      {req.citizen_question}
                    </p>

                    {req.chatbot_draft_answer && (
                      <div className="text-xs text-slate-600">
                        <strong>{dict.deptChat.chatbotDraftLabel}:</strong> {req.chatbot_draft_answer.slice(0, 240)}
                      </div>
                    )}

                    {req.status === 'ANSWERED' && req.humanized_reply ? (
                      <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-emerald-950 text-sm">
                        {req.humanized_reply}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <textarea
                          rows={3}
                          placeholder={dict.deptChat.replyPlaceholder}
                          value={replyDrafts[req.id] ?? ''}
                          onChange={(e) => setReplyDrafts((prev) => ({ ...prev, [req.id]: e.target.value }))}
                          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                        />
                        <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={Boolean(saveGuidanceFlags[req.id])}
                            onChange={(e) =>
                              setSaveGuidanceFlags((prev) => ({ ...prev, [req.id]: e.target.checked }))
                            }
                            className="h-4 w-4 rounded accent-teal-700"
                          />
                          <span>{dict.deptChat.saveAsGuidanceLabel}</span>
                        </label>
                        <button
                          type="button"
                          disabled={busy || !(replyDrafts[req.id] ?? '').trim()}
                          onClick={() => void handleReplyAssistance(req.id)}
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-teal-700 text-white text-sm font-semibold hover:bg-teal-800 disabled:opacity-50"
                        >
                          <Send className="h-4 w-4" />
                          {dict.deptChat.sendReplyBtn}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Department Humanized Guidance Library for the Chatbot */}
          <section className="rounded-2xl bg-white border border-slate-200 p-5 space-y-4">
            <h2 className="text-lg font-bold text-slate-900">{dict.deptChat.guidanceTitle} ({guidanceList.length})</h2>
            <form onSubmit={(e) => void handleAddDirectGuidance(e)} className="space-y-3">
              <input
                type="text"
                required
                placeholder={dict.deptChat.guidanceQuestionPlaceholder}
                value={newGuideQ}
                onChange={(e) => setNewGuideQ(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
              <textarea
                rows={3}
                required
                placeholder={dict.deptChat.guidanceAnswerPlaceholder}
                value={newGuideA}
                onChange={(e) => setNewGuideA(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
              <button
                type="submit"
                disabled={busy}
                className="px-4 py-2.5 rounded-xl bg-teal-700 text-white text-sm font-semibold hover:bg-teal-800"
              >
                {dict.deptChat.addGuidanceBtn}
              </button>
            </form>

            <div className="space-y-2 pt-3 border-t border-slate-200 max-h-80 overflow-y-auto">
              {guidanceList.map((g) => (
                <div key={g.id} className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1">
                  <div className="font-bold text-slate-900">{g.question_pattern} ({g.language})</div>
                  <p className="text-slate-700">{g.humanized_answer}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : (
        <>
          {/* Filters */}
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="h-4 w-4 text-slate-400 absolute start-3 top-3" />
              <input
                type="text"
                placeholder={dict.officer.searchPlaceholder}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white ps-9 pe-3 py-2 text-sm"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">{dict.officer.allStatuses}</option>
              {CASE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {statusLabel(s)}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-2">
              <h2 className="text-sm font-bold text-slate-700">{dict.officer.applicationsTitle} ({queue.length})</h2>
              {queue.length === 0 ? (
                <p className="text-sm text-slate-500 py-4">{dict.officer.noMatches}</p>
              ) : (
                queue.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    data-testid="officer-case-item"
                    data-case-id={c.id}
                    onClick={() => void loadDetail(c.id)}
                    className={`w-full text-start p-3 rounded-xl border transition ${
                      selected?.case.id === c.id
                        ? 'border-teal-600 bg-teal-50/70'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-sm text-slate-900">{c.citizen_display_name}</span>
                      <span
                        className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                          c.access_blocked ? 'bg-rose-200 text-rose-950' : 'bg-slate-200 text-slate-800'
                        }`}
                      >
                        {c.access_blocked ? 'CONSENT WITHDRAWN' : statusLabel(c.status)}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 mt-1 flex flex-wrap items-center gap-1.5">
                      <span dir="ltr">{c.mock_identity_reference}</span> • {dict.officer.scoreLabel}: {c.analysis_result?.evidence_score ?? '—'}/100
                      {c.rule_version_used && (
                        <span className="px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-900 font-mono font-bold text-[10px]">
                          {c.rule_version_used}
                        </span>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>

            <div className="lg:col-span-2 rounded-2xl bg-white border border-slate-200 p-6 space-y-5">
              {!selected ? (
                <p className="text-sm text-slate-500">{dict.officer.selectPrompt}</p>
              ) : selected.case.access_blocked ? (
                <div
                  data-testid="officer-consent-withdrawn-banner"
                  className="rounded-2xl bg-rose-50 border-2 border-rose-400 p-6 space-y-3 text-rose-950"
                >
                  <div className="flex items-center gap-2 text-lg font-bold">
                    <ShieldAlert className="h-6 w-6 text-rose-700" />
                    <span>Access Revoked — Citizen Withdrew Consent</span>
                  </div>
                  <p className="text-sm">
                    Reason: <code className="font-mono font-bold">{selected.case.access_blocked_reason ?? 'CONSENT_WITHDRAWN_BY_CITIZEN'}</code>.
                    Personal details, answers, and documents are redacted at the API layer and decision actions are disabled until the citizen explicitly restores consent.
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200">
                    <div>
                      <h2 className="text-xl font-bold text-slate-900">
                        {selected.citizen?.display_name ?? dict.roles.citizen} — {selected.case.scheme_id}
                      </h2>
                      <p className="text-xs text-slate-500 flex flex-wrap items-center gap-2 mt-0.5">
                        <span>{dict.officer.caseIdLabel}: <span dir="ltr">{selected.case.id}</span></span>
                        {selected.case.rule_version_used && (
                          <span className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-900 font-mono font-bold">
                            Rule Snapshot: {selected.case.rule_version_used}
                          </span>
                        )}
                        {selected.case.decision_tier && (
                          <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-950 font-bold">
                            {selected.case.decision_tier}
                          </span>
                        )}
                      </p>
                    </div>
                    <span className="px-3 py-1 rounded-full bg-teal-100 text-teal-900 text-xs font-bold">
                      {statusLabel(selected.case.status)}
                    </span>
                  </div>

                  {/* Module 2 (Challenge 01 & 02): Structured AI Uncertainty Case Notes & Cost Model Breakdown */}
                  {selected.case.case_notes && (
                    <div
                      data-testid="officer-ai-case-notes"
                      className="rounded-xl bg-amber-50 border-2 border-amber-300 p-4 space-y-2 text-xs text-amber-950"
                    >
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <span className="font-bold text-sm flex items-center gap-1.5">
                          <AlertTriangle className="h-4 w-4 text-amber-700" />
                          <span>AI Handoff Case Notes (Confidence: {Math.round(selected.case.case_notes.confidence_score * 100)}%)</span>
                        </span>
                        {selected.case.rule_snapshot_json && (
                          <span className="font-mono font-bold bg-white px-2 py-0.5 rounded border border-amber-200">
                            Cost Ratio: {Math.round(selected.case.rule_snapshot_json.false_approval_cost_pkr / Math.max(1, selected.case.rule_snapshot_json.false_delay_cost_pkr))}x (PKR {selected.case.rule_snapshot_json.false_approval_cost_pkr.toLocaleString()} vs {selected.case.rule_snapshot_json.false_delay_cost_pkr})
                          </span>
                        )}
                      </div>
                      <div className="space-y-1">
                        <div className="font-bold">Why AI Deferred to Human Officer:</div>
                        {selected.case.case_notes.uncertainty_reasons.map((r, i) => (
                          <div key={i}>• {r}</div>
                        ))}
                      </div>
                      {selected.case.case_notes.conflicting_or_missing_fields.length > 0 && (
                        <div>
                          <strong>Conflicting / Missing Fields:</strong>{' '}
                          {selected.case.case_notes.conflicting_or_missing_fields.join(', ')}
                        </div>
                      )}
                      <div className="space-y-0.5">
                        <div className="font-bold">Recommended Human Checks:</div>
                        {selected.case.case_notes.recommended_human_checks.map((chk, i) => (
                          <div key={i}>✓ {chk}</div>
                        ))}
                      </div>
                    </div>
                  )}

                  {selected.case.analysis_result && (
                    <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-3 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-900">
                          {dict.officer.evidenceScoreLabel}: {selected.case.analysis_result.evidence_score}/100
                        </span>
                        <span className="text-xs text-slate-600" dir="ltr">
                          v{selected.case.analysis_result.rule_version}
                        </span>
                      </div>
                      <p className="text-slate-700">{selected.case.analysis_result.explanation}</p>
                      {selected.case.analysis_result.hard_safety_flags.length > 0 && (
                        <div className="text-xs font-semibold text-rose-800 bg-rose-50 border border-rose-200 rounded-lg p-2">
                          {dict.officer.hardSafetyFlags}: {selected.case.analysis_result.hard_safety_flags.join(', ')}
                        </div>
                      )}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                        <div className="p-2 rounded bg-white border border-slate-200">
                          {dict.officer.mockIdMetric}: <strong>{selected.case.analysis_result.score_breakdown.mock_identity_verification}</strong>
                        </div>
                        <div className="p-2 rounded bg-white border border-slate-200">
                          {dict.officer.docsMetric}: <strong>{selected.case.analysis_result.score_breakdown.document_readability}</strong>
                        </div>
                        <div className="p-2 rounded bg-white border border-slate-200">
                          {dict.officer.fieldsMetric}: <strong>{selected.case.analysis_result.score_breakdown.required_field_completeness}</strong>
                        </div>
                        <div className="p-2 rounded bg-white border border-slate-200">
                          {dict.officer.consistencyMetric}: <strong>{selected.case.analysis_result.score_breakdown.cross_field_consistency}</strong>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="space-y-2">
                    <h3 className="text-sm font-bold text-slate-800">{dict.officer.collectedAnswers}</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                      {selected.answers.map((a) => (
                        <div key={a.id} className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                          <div className="text-xs text-slate-500">{a.field_name} ({a.source})</div>
                          <div className="font-semibold text-slate-900">{String(a.field_value)}</div>
                          <div className="text-[11px] text-slate-500">
                            {dict.officer.confirmedByCitizen}: {a.confirmed_by_citizen ? dict.yes : dict.no}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <h3 className="text-sm font-bold text-slate-800">
                      {dict.officer.privateDocuments} ({selected.documents.length})
                    </h3>
                    {selected.documents.map((doc) => (
                      <div key={doc.id} className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-2 text-sm">
                        <div>
                          <div className="font-semibold">{docTypeLabel(doc.document_type)} — {doc.file_name}</div>
                          <div className="text-xs text-slate-500">
                            {dict.officer.statusLabel}: {doc.processing_status} • {dict.officer.conflictsLabel}: {doc.conflicts.length}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void openSignedDocument(doc.id)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold"
                        >
                          <ExternalLink className="h-3.5 w-3.5" /> {dict.officer.signedLinkBtn}
                        </button>
                      </div>
                    ))}
                  </div>

                  {selected.case.decision_reason && (
                    <div
                      data-testid="officer-recorded-decision-box"
                      className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-950 space-y-1"
                    >
                      <div className="font-bold">
                        Recorded Decision ({statusLabel(selected.case.status)}) by{' '}
                        {selected.case.decided_by_officer_name ?? 'Department Officer'}
                      </div>
                      <div>
                        <strong>Decision Reason:</strong> {selected.case.decision_reason}
                      </div>
                    </div>
                  )}

                  <div className="pt-4 border-t border-slate-200 space-y-3">
                    <h3 className="text-sm font-bold text-slate-900">{dict.officer.humanActionsTitle}</h3>
                    <div className="space-y-1">
                      <label className="block text-xs font-bold text-slate-800">
                        Decision Reason (Mandatory for Approve / Reject) *
                      </label>
                      <textarea
                        data-testid="officer-decision-reason-input"
                        rows={2}
                        required
                        placeholder="Explain why you are approving or rejecting (e.g., Income and flood damage verified by field check)"
                        value={decisionReason}
                        onChange={(e) => setDecisionReason(e.target.value)}
                        className="w-full rounded-xl border-2 border-teal-300 px-3 py-2 text-sm focus:outline-none focus:border-teal-600"
                      />
                    </div>
                    <textarea
                      rows={2}
                      placeholder={dict.officer.internalNotesPlaceholder}
                      value={internalNotes}
                      onChange={(e) => setInternalNotes(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                    />
                    <textarea
                      rows={2}
                      placeholder={dict.officer.citizenMessagePlaceholder}
                      value={citizenMessage}
                      onChange={(e) => setCitizenMessage(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                    />
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        data-testid="officer-approve-btn"
                        disabled={busy || decisionReason.trim().length < 3}
                        onClick={() => void handleDecision('APPROVED')}
                        className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-700 text-white text-sm font-semibold hover:bg-emerald-800 disabled:opacity-45"
                      >
                        <CheckCircle2 className="h-4 w-4" /> {dict.officer.approveBtn}
                      </button>
                      <button
                        type="button"
                        data-testid="officer-reject-btn"
                        disabled={busy || decisionReason.trim().length < 3}
                        onClick={() => void handleDecision('REJECTED')}
                        className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-rose-700 text-white text-sm font-semibold hover:bg-rose-800 disabled:opacity-45"
                      >
                        <XCircle className="h-4 w-4" /> {dict.officer.rejectBtn}
                      </button>
                      {selected.case.status === 'APPROVED' && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleMockPayment()}
                          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-indigo-700 text-white text-sm font-semibold hover:bg-indigo-800"
                        >
                          <Wallet className="h-4 w-4" /> {dict.officer.simulatePaymentBtn}
                        </button>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2 pt-2">
                      <input
                        type="text"
                        placeholder={dict.officer.missingItemsPlaceholder}
                        value={missingItemsText}
                        onChange={(e) => setMissingItemsText(e.target.value)}
                        className="flex-1 min-w-[220px] rounded-xl border border-slate-300 px-3 py-2 text-sm"
                      />
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleRequestInfo()}
                        className="px-4 py-2 rounded-xl border border-amber-500 text-amber-900 bg-amber-50 text-sm font-semibold"
                      >
                        {dict.officer.requestInfoBtn}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
