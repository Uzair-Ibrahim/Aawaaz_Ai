'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { AiRunRecord, AuditLogEntry, ConsentRecord, RuleVersionRecord } from '@awaaz/shared';
import { FileSearch, RefreshCw } from 'lucide-react';
import { ApiClientError, apiRequest } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/context';
import { formatText, useI18n } from '@/lib/i18n/context';
import { getRoleLandingRoute } from '@/lib/modules/registry';

export default function AuditTrailPage() {
  const { user, token, activeOrganizationId } = useAuth();
  const { dict, roleLabel } = useI18n();
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [aiRuns, setAiRuns] = useState<AiRunRecord[]>([]);
  const [ruleVersions, setRuleVersions] = useState<RuleVersionRecord[]>([]);
  const [consents, setConsents] = useState<ConsentRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadAudit = useCallback(async () => {
    if (!token || !activeOrganizationId) return;
    if (user?.active_role !== 'admin') return;
    setError(null);
    try {
      const auditRes = await apiRequest<{
        audit_logs: AuditLogEntry[];
        ai_runs: AiRunRecord[];
        rule_versions: RuleVersionRecord[];
        consents?: ConsentRecord[];
      }>('/audit', { token, organizationId: activeOrganizationId });
      setAuditLogs(auditRes.audit_logs);
      setAiRuns(auditRes.ai_runs);
      setRuleVersions(auditRes.rule_versions);
      setConsents(auditRes.consents ?? []);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : dict.auth.authFailed);
    }
  }, [token, activeOrganizationId, user?.active_role, dict.auth.authFailed]);

  useEffect(() => {
    void loadAudit();
  }, [loadAudit]);

  if (!user) {
    return (
      <div className="rounded-xl bg-white border border-slate-200 p-8 text-center space-y-3">
        <p className="text-slate-700">{dict.auditor.roleRequired}</p>
        <Link href="/login" className="inline-block px-5 py-2.5 rounded-xl bg-teal-700 text-white font-semibold">
          {dict.admin.signInAsAdmin}
        </Link>
      </div>
    );
  }

  if (user.active_role !== 'admin') {
    return (
      <div className="rounded-xl bg-white border border-rose-200 p-8 text-center space-y-3">
        <p className="text-slate-700">{dict.auditor.roleRequired}</p>
        <Link
          href={getRoleLandingRoute(user.active_role)}
          className="inline-block px-5 py-2.5 rounded-xl bg-teal-700 text-white font-semibold"
        >
          {formatText(dict.home.openRoleWorkspace, { role: roleLabel(user.active_role) })}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <FileSearch className="h-6 w-6 text-teal-700" />
            {dict.auditor.title}
          </h1>
          <p className="text-sm text-slate-600">
            {formatText(dict.auditor.subtitle, { org: user.active_organization.name })}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadAudit()}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-300 bg-white text-sm font-semibold"
        >
          <RefreshCw className="h-4 w-4" /> {dict.refresh}
        </button>
      </div>

      {error && <div className="rounded-xl bg-rose-50 border border-rose-200 text-rose-900 px-4 py-3 text-sm">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="rounded-2xl bg-white border border-slate-200 p-5 space-y-3">
          <h2 className="text-lg font-bold">{dict.auditor.auditLogsTitle} ({auditLogs.length})</h2>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {auditLogs.map((log) => (
              <div key={log.id} className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                <div className="flex items-center justify-between font-bold text-slate-900">
                  <span dir="ltr">{log.action}</span>
                  <span className="text-slate-400 font-normal">{new Date(log.created_at).toLocaleString()}</span>
                </div>
                <div className="text-slate-600 mt-0.5">
                  {dict.auditor.resourceLabel}: <span dir="ltr">{log.resource_type} {log.resource_id ? `(${log.resource_id.slice(0, 8)})` : ''}</span>
                </div>
                <pre className="mt-1 text-[11px] text-slate-500 overflow-x-auto" dir="ltr">
                  {JSON.stringify(log.metadata)}
                </pre>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl bg-white border border-slate-200 p-5 space-y-3">
          <h2 className="text-lg font-bold">{dict.auditor.aiTracesTitle} ({aiRuns.length})</h2>
          {aiRuns.length === 0 ? (
            <p className="text-sm text-slate-500">{dict.auditor.noAiRuns}</p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {aiRuns.map((run) => (
                <div key={run.id} className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                  <div className="font-bold text-slate-900" dir="ltr">
                    {run.operation} — {run.model_provider}/{run.model_name}
                  </div>
                  <div className="text-slate-600 mt-0.5">
                    {dict.auditor.refLabel}: <span dir="ltr">{run.input_reference}</span>
                  </div>
                  {run.explanation && <div className="text-slate-700 mt-1">{run.explanation}</div>}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl bg-white border border-slate-200 p-5 space-y-3">
          <h2 className="text-lg font-bold">{dict.auditor.consentHistoryTitle} ({consents.length})</h2>
          {consents.length === 0 ? (
            <p className="text-sm text-slate-500">{dict.auditor.noConsents}</p>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {consents.map((c) => (
                <div key={c.id} className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                  <div className="font-bold">
                    {c.consent_type} — {c.withdrawn_at ? dict.withdrawn : dict.active}
                  </div>
                  <div className="text-slate-500">
                    {dict.auditor.grantedLabel}: {new Date(c.granted_at).toLocaleString()}
                    {c.withdrawn_at ? ` • ${dict.auditor.withdrawnLabel}: ${new Date(c.withdrawn_at).toLocaleString()}` : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl bg-white border border-slate-200 p-5 space-y-3">
          <h2 className="text-lg font-bold">{dict.auditor.rulePubHistoryTitle} ({ruleVersions.length})</h2>
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {ruleVersions.map((rv) => (
              <div key={rv.id} className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                <div className="font-bold" dir="ltr">{rv.scheme_id} — v{rv.version_number}</div>
                <div className="text-slate-500">{dict.auditor.publishedLabel}: {new Date(rv.published_at).toLocaleString()}</div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
