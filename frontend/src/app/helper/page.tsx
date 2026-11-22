'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { CaseRecord, CitizenRecord } from '@awaaz/shared';
import { HandHeart, RefreshCw } from 'lucide-react';
import { ApiClientError, apiRequest } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/context';
import { formatText, useI18n } from '@/lib/i18n/context';
import { getRoleLandingRoute } from '@/lib/modules/registry';

export default function HelperPortalPage() {
  const { user, token, activeOrganizationId } = useAuth();
  const { dict, statusLabel, roleLabel } = useI18n();
  const [citizens, setCitizens] = useState<CitizenRecord[]>([]);
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadHelperData = useCallback(async () => {
    if (!token || !activeOrganizationId || user?.active_role !== 'helper') return;
    setErrorMsg(null);
    try {
      const [citRes, casesRes] = await Promise.all([
        apiRequest<{ citizens: CitizenRecord[] }>('/helper/citizens', {
          token,
          organizationId: activeOrganizationId,
        }),
        apiRequest<{ cases: CaseRecord[] }>('/cases', {
          token,
          organizationId: activeOrganizationId,
        }),
      ]);
      setCitizens(citRes.citizens);
      setCases(casesRes.cases);
    } catch (err) {
      setErrorMsg(err instanceof ApiClientError ? err.message : dict.auth.authFailed);
    }
  }, [token, activeOrganizationId, user?.active_role, dict.auth.authFailed]);

  useEffect(() => {
    void loadHelperData();
  }, [loadHelperData]);

  if (!user) {
    return (
      <div className="rounded-xl bg-white border border-slate-200 p-8 text-center space-y-3">
        <p className="text-slate-700">{dict.helper.roleRequired}</p>
        <Link href="/login" className="inline-block px-5 py-2.5 rounded-xl bg-teal-700 text-white font-semibold">
          {dict.helper.signInAsHelper}
        </Link>
      </div>
    );
  }

  if (user.active_role !== 'helper') {
    return (
      <div className="rounded-xl bg-white border border-rose-200 p-8 text-center space-y-3">
        <p className="text-slate-700">{dict.helper.roleRequired}</p>
        <Link
          href={getRoleLandingRoute(user.active_role)}
          className="inline-block px-5 py-2.5 rounded-xl bg-teal-700 text-white font-semibold"
        >
          {formatText(dict.home.openRoleWorkspace, { role: roleLabel(user.active_role) })}
        </Link>
      </div>
    );
  }

  const createApplicationForCitizen = async (citizenId: string) => {
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await apiRequest<{ case: CaseRecord }>('/cases', {
        method: 'POST',
        token,
        organizationId: activeOrganizationId,
        body: {
          scheme_id: 'MOCK_RELIEF_01',
          preferred_language: 'ur',
          idempotency_key: `helper-${crypto.randomUUID()}`,
          citizen_id: citizenId,
        },
      });
      setStatusMsg(formatText(dict.helper.createdAssistedMsg, { id: res.case.id.slice(0, 8) }));
      await loadHelperData();
    } catch (err) {
      setErrorMsg(err instanceof ApiClientError ? err.message : dict.auth.authFailed);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <HandHeart className="h-6 w-6 text-teal-700" />
            {dict.helper.title}
          </h1>
          <p className="text-sm text-slate-600">
            {formatText(dict.helper.subtitle, { org: user.active_organization.name })}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadHelperData()}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-300 bg-white text-sm font-semibold"
        >
          <RefreshCw className="h-4 w-4" /> {dict.refresh}
        </button>
      </div>

      {statusMsg && <div className="rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 px-4 py-3 text-sm">{statusMsg}</div>}
      {errorMsg && <div className="rounded-xl bg-rose-50 border border-rose-200 text-rose-900 px-4 py-3 text-sm">{errorMsg}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="rounded-2xl bg-white border border-slate-200 p-5 space-y-3">
          <h2 className="text-lg font-bold">{dict.helper.authorizedCitizens} ({citizens.length})</h2>
          {citizens.length === 0 ? (
            <p className="text-sm text-slate-500">{dict.helper.noCitizens}</p>
          ) : (
            <div className="space-y-3">
              {citizens.map((cit) => (
                <div key={cit.id} className="p-3.5 rounded-xl border border-slate-200 flex items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold text-slate-900">{cit.display_name}</div>
                    <div className="text-xs text-slate-500">
                      {dict.helper.mockRefLabel}: <span dir="ltr">{cit.mock_identity_reference}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void createApplicationForCitizen(cit.id)}
                    className="px-3 py-1.5 rounded-lg bg-teal-700 text-white text-xs font-semibold hover:bg-teal-800"
                  >
                    {dict.helper.newAssistedDraft}
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl bg-white border border-slate-200 p-5 space-y-3">
          <h2 className="text-lg font-bold">{dict.helper.authorizedApps} ({cases.length})</h2>
          {cases.length === 0 ? (
            <p className="text-sm text-slate-500">{dict.helper.noApps}</p>
          ) : (
            <div className="space-y-2">
              {cases.map((c) => (
                <div key={c.id} className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-slate-900" dir="ltr">{c.scheme_id} • {c.id.slice(0, 8)}</span>
                    <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-teal-100 text-teal-900">
                      {statusLabel(c.status)}
                    </span>
                  </div>
                  <div className="text-xs text-slate-600 mt-1">
                    {dict.helper.languageLabel}: {c.preferred_language} • {dict.helper.updatedLabel}: {new Date(c.updated_at).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
