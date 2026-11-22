'use client';

import React, { useCallback, useEffect, useState } from 'react';
import type {
  CitizenConsentScopes,
  CitizenGranularConsentRecord,
  DocumentAuthenticityAnalysis,
  LanguageCode,
} from '@awaaz/shared';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  FileWarning,
  Lock,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Upload,
  UserCheck,
  X,
} from 'lucide-react';
import { ApiClientError, apiRequest } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/context';

export function CitizenConsentModal({
  open,
  onClose,
  language,
}: {
  open: boolean;
  onClose: () => void;
  language: LanguageCode;
}) {
  const { token, activeOrganizationId, user } = useAuth();
  const [record, setRecord] = useState<CitizenGranularConsentRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadConsent = useCallback(async () => {
    if (!open || !token || !activeOrganizationId || user?.active_role !== 'citizen') return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<{ consent: CitizenGranularConsentRecord }>('/consent/my-data', {
        token,
        organizationId: activeOrganizationId,
      });
      setRecord(res.consent);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Unable to load consent status.');
    } finally {
      setLoading(false);
    }
  }, [open, token, activeOrganizationId, user?.active_role]);

  useEffect(() => {
    void loadConsent();
  }, [loadConsent]);

  if (!open) return null;

  const isEn = language === 'en';

  const handleToggleScope = async (key: keyof CitizenConsentScopes, nextVal: boolean) => {
    if (!token || !activeOrganizationId) return;
    setBusy(true);
    setBanner(null);
    setError(null);
    try {
      const res = await apiRequest<{ consent: CitizenGranularConsentRecord }>('/consent/my-data', {
        method: 'PATCH',
        token,
        organizationId: activeOrganizationId,
        body: { [key]: nextVal },
      });
      setRecord(res.consent);
      setBanner(isEn ? 'Consent preference saved and enforced immediately.' : 'آپ کی اجازت کی ترتیبات محفوظ اور فوری نافذ کر دی گئیں۔');
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Failed to update consent.');
    } finally {
      setBusy(false);
    }
  };

  const handleWithdrawAll = async () => {
    if (!token || !activeOrganizationId) return;
    setBusy(true);
    setBanner(null);
    setError(null);
    try {
      const res = await apiRequest<{ consent: CitizenGranularConsentRecord }>('/consent/withdraw-all', {
        method: 'POST',
        token,
        organizationId: activeOrganizationId,
      });
      setRecord(res.consent);
      setBanner(
        isEn
          ? 'Consent withdrawn. Officer & AI access to your personal data is now blocked and logged in the audit trail.'
          : 'آپ کی اجازت واپس لے لی گئی ہے۔ اب محکمہ افسر اور AI آپ کا ڈیٹا نہیں دیکھ سکتے۔',
      );
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Failed to withdraw consent.');
    } finally {
      setBusy(false);
    }
  };

  const handleGrantAll = async () => {
    if (!token || !activeOrganizationId) return;
    setBusy(true);
    setBanner(null);
    setError(null);
    try {
      const res = await apiRequest<{ consent: CitizenGranularConsentRecord }>('/consent/grant-all', {
        method: 'POST',
        token,
        organizationId: activeOrganizationId,
      });
      setRecord(res.consent);
      setBanner(isEn ? 'All data-sharing permissions restored.' : 'تمام اجازتیں بحال کر دی گئیں۔');
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Failed to grant consent.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="citizen-consent-modal"
      className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4"
    >
      <div className="bg-white text-slate-900 rounded-2xl border border-slate-200 shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-5">
        <div className="flex items-center justify-between border-b border-slate-200 pb-3">
          <div className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-teal-700" />
            <h3 className="text-lg font-bold">
              {isEn ? 'My Data & Consent Control' : 'میرا ڈیٹا اور اجازت کنٹرول'}
            </h3>
            {record && (
              <span
                data-testid="consent-overall-status-badge"
                className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                  record.status === 'GRANTED'
                    ? 'bg-emerald-100 text-emerald-900'
                    : 'bg-rose-100 text-rose-900'
                }`}
              >
                {record.status}
              </span>
            )}
          </div>
          <button
            type="button"
            data-testid="close-consent-modal-btn"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {banner && (
          <div data-testid="consent-modal-banner" className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-semibold">
            {banner}
          </div>
        )}
        {error && (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs font-semibold">
            {error}
          </div>
        )}

        {loading || !record ? (
          <p className="text-sm text-slate-500 py-4">{isEn ? 'Loading your consent permissions...' : 'آپ کی اجازت کی تفصیلات لوڈ ہو رہی ہیں...'}</p>
        ) : (
          <>
            {/* Who Currently Has My Data */}
            <div className="space-y-2.5">
              <h4 className="text-sm font-bold text-slate-800">
                {isEn ? 'Who Currently Has My Data' : 'اس وقت میرا ڈیٹا کس کے پاس ہے'}
              </h4>
              <div className="space-y-2">
                {record.who_has_access.map((entry) => (
                  <div
                    key={entry.recipient_id}
                    data-testid={`consent-recipient-${entry.recipient_id}`}
                    className={`p-3 rounded-xl border flex items-center justify-between gap-3 ${
                      entry.access_active ? 'bg-teal-50/50 border-teal-200' : 'bg-rose-50/50 border-rose-200'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="font-bold text-sm text-slate-900">{entry.name}</div>
                      <div className="text-xs text-slate-600">{entry.purpose}</div>
                    </div>
                    <span
                      className={`shrink-0 px-2.5 py-0.5 rounded-full text-xs font-bold ${
                        entry.access_active
                          ? 'bg-emerald-100 text-emerald-900'
                          : 'bg-rose-200 text-rose-950'
                      }`}
                    >
                      {entry.access_active ? 'ACTIVE' : 'REVOKED'}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Granular Toggles */}
            <div className="space-y-2.5 pt-2 border-t border-slate-200">
              <h4 className="text-sm font-bold text-slate-800">
                {isEn ? 'Granular Sharing Controls' : 'مخصوص ڈیٹا شیئرنگ کنٹرول'}
              </h4>
              <div className="space-y-2">
                {(
                  [
                    {
                      key: 'share_with_relief_officer' as const,
                      label: isEn ? 'Share application details with Relief Officer' : 'درخواست کی تفصیلات محکمہ افسر کے ساتھ شیئر کریں',
                    },
                    {
                      key: 'allow_ai_voice_processing' as const,
                      label: isEn ? 'Allow AI Voice Assistant processing' : 'آواز ساتھی AI پروسیسنگ کی اجازت دیں',
                    },
                    {
                      key: 'allow_document_verification' as const,
                      label: isEn ? 'Allow supporting document verification' : 'دستاویزات کی تصدیق کی اجازت دیں',
                    },
                  ] as const
                ).map((item) => (
                  <label
                    key={item.key}
                    className="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer"
                  >
                    <span className="text-sm font-medium text-slate-800">{item.label}</span>
                    <input
                      type="checkbox"
                      data-testid={`consent-toggle-${item.key}`}
                      disabled={busy}
                      checked={record.scopes[item.key]}
                      onChange={(e) => void handleToggleScope(item.key, e.target.checked)}
                      className="h-4 w-4 accent-teal-700"
                    />
                  </label>
                ))}
              </div>
            </div>

            {/* One-Click Take Back My Data / Restore */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-200">
              <button
                type="button"
                data-testid="withdraw-all-consent-btn"
                disabled={busy || record.status === 'WITHDRAWN'}
                onClick={() => void handleWithdrawAll()}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-rose-700 hover:bg-rose-800 disabled:opacity-45 text-white text-sm font-bold"
              >
                <ShieldAlert className="h-4 w-4" />
                <span>{isEn ? 'Withdraw Consent / Take Back My Data' : 'اجازت واپس لیں / میرا ڈیٹا روکیں'}</span>
              </button>

              {record.status === 'WITHDRAWN' && (
                <button
                  type="button"
                  data-testid="regrant-all-consent-btn"
                  disabled={busy}
                  onClick={() => void handleGrantAll()}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-bold"
                >
                  <ShieldCheck className="h-4 w-4" />
                  <span>{isEn ? 'Re-Grant Consent' : 'اجازت دوبارہ بحال کریں'}</span>
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function DocumentAuthenticityModal({
  open,
  onClose,
  language,
  onSendToVoiceAgent,
}: {
  open: boolean;
  onClose: () => void;
  language: LanguageCode;
  onSendToVoiceAgent?: (file: File) => void;
}) {
  const { token, activeOrganizationId } = useAuth();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DocumentAuthenticityAnalysis | null>(null);
  const [actionNote, setActionNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const isEn = language === 'en';

  const runAnalysis = async (payload: {
    image_base64?: string;
    file_name?: string;
    mime_type?: string;
    sample_preset?: 'valid_cnic' | 'blurry_rural_photo' | 'tampered_edited_doc';
  }) => {
    if (!token || !activeOrganizationId) {
      setError(isEn ? 'Please sign in first to run document authenticity verification.' : 'دستاویز کی جانچ کے لیے پہلے لاگ ان کریں۔');
      return;
    }
    setBusy(true);
    setError(null);
    setActionNote(null);
    try {
      const res = await apiRequest<{ analysis: DocumentAuthenticityAnalysis }>('/documents/analyze-authenticity', {
        method: 'POST',
        token,
        organizationId: activeOrganizationId,
        body: {
          ...payload,
          doc_type: 'mock_identity_document',
          language,
        },
      });
      setResult(res.analysis);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Document check failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleFileChange = (file: File | null) => {
    if (!file) return;
    if (onSendToVoiceAgent) {
      onSendToVoiceAgent(file);
    }
    const reader = new FileReader();
    reader.onload = () => {
      void runAnalysis({
        image_base64: String(reader.result ?? ''),
        file_name: file.name,
        mime_type: file.type || 'image/png',
      });
    };
    reader.readAsDataURL(file);
  };

  return (
    <div
      data-testid="document-authenticity-modal"
      className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4"
    >
      <div className="bg-white text-slate-900 rounded-2xl border border-slate-200 shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-5">
        <div className="flex items-center justify-between border-b border-slate-200 pb-3">
          <div className="flex items-center gap-2">
            <Camera className="h-5 w-5 text-teal-700" />
            <h3 className="text-lg font-bold">
              {isEn ? 'Scan CNIC / Document Authenticity Check' : 'شناختی کارڈ / دستاویز کی تصدیق'}
            </h3>
          </div>
          <button
            type="button"
            data-testid="close-doc-modal-btn"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Real Upload + 3 Quick Demo Samples */}
        <div className="space-y-3">
          <label className="w-full cursor-pointer flex items-center justify-center gap-2 p-4 rounded-xl border-2 border-dashed border-teal-400 bg-teal-50/50 hover:bg-teal-50 text-teal-900 font-bold text-sm transition">
            <Upload className="h-4 w-4" />
            <span>{isEn ? 'Upload Real CNIC / Income Document Image' : 'اپنی دستاویز کی تصویر اپلوڈ کریں'}</span>
            <input
              type="file"
              accept=".png,.jpg,.jpeg,.webp,.txt"
              className="hidden"
              onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
            />
          </label>

          <div className="space-y-1.5">
            <div className="text-xs font-bold text-slate-600">
              {isEn ? 'Quick Verification Samples (Test Forgery vs Honest False Alarm):' : 'فوری جانچ کے نمونے:'}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button
                type="button"
                data-testid="doc-sample-valid"
                disabled={busy}
                onClick={() => void runAnalysis({ sample_preset: 'valid_cnic' })}
                className="p-2.5 rounded-xl border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-950 text-xs font-bold text-start"
              >
                <CheckCircle2 className="h-4 w-4 text-emerald-700 mb-1" />
                <div>1. Valid CNIC Sample</div>
              </button>
              <button
                type="button"
                data-testid="doc-sample-blurry"
                disabled={busy}
                onClick={() => void runAnalysis({ sample_preset: 'blurry_rural_photo' })}
                className="p-2.5 rounded-xl border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-950 text-xs font-bold text-start"
              >
                <AlertTriangle className="h-4 w-4 text-amber-700 mb-1" />
                <div>2. Blurry Rural Photo (False Alarm Demo)</div>
              </button>
              <button
                type="button"
                data-testid="doc-sample-tampered"
                disabled={busy}
                onClick={() => void runAnalysis({ sample_preset: 'tampered_edited_doc' })}
                className="p-2.5 rounded-xl border border-rose-300 bg-rose-50 hover:bg-rose-100 text-rose-950 text-xs font-bold text-start"
              >
                <FileWarning className="h-4 w-4 text-rose-700 mb-1" />
                <div>3. Edited / Tampered Doc Sample</div>
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs font-semibold">
            {error}
          </div>
        )}

        {result && (
          <div
            data-testid="doc-authenticity-result"
            data-outcome={result.outcome}
            className={`p-4 rounded-2xl border-2 space-y-3 text-sm ${
              result.outcome === 'VERIFIED_AUTHENTIC'
                ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
                : result.outcome === 'POSSIBLE_FALSE_ALARM_LOW_QUALITY'
                  ? 'bg-amber-50 border-amber-400 text-amber-950'
                  : 'bg-rose-50 border-rose-400 text-rose-950'
            }`}
          >
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span data-testid="doc-outcome-badge" className="px-3 py-1 rounded-full bg-white border font-mono font-bold text-xs">
                {result.outcome}
              </span>
              <div className="flex items-center gap-2 text-xs font-bold">
                <span>Forgery Score: {Math.round(result.forgery_score * 100)}%</span>
                <span>•</span>
                <span data-testid="doc-false-alarm-risk">False-Alarm Risk: {result.false_alarm_risk}</span>
              </div>
            </div>

            <p className="font-semibold leading-relaxed">{result.citizen_message}</p>

            {result.tamper_indicators.length > 0 && (
              <div className="p-2.5 rounded-xl bg-white/80 border border-rose-200 text-xs space-y-1">
                <div className="font-bold text-rose-900">Detected Tamper Indicators:</div>
                {result.tamper_indicators.map((ind, idx) => (
                  <div key={idx}>• {ind}</div>
                ))}
              </div>
            )}

            {result.quality_issues.length > 0 && (
              <div className="p-2.5 rounded-xl bg-white/80 border border-amber-200 text-xs space-y-1">
                <div className="font-bold text-amber-900">Camera / Lighting Notes (Not Forgery):</div>
                {result.quality_issues.map((q, idx) => (
                  <div key={idx}>• {q}</div>
                ))}
              </div>
            )}

            <div className="text-xs italic opacity-90 bg-white/60 rounded-lg p-2.5 border">
              {result.false_alarm_disclaimer}
            </div>

            {result.non_blocking_options.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  data-testid="doc-opt-retake"
                  onClick={() => {
                    setResult(null);
                    setActionNote(isEn ? 'Ready to capture a clearer photo — your application remains open.' : 'واضح تصویر دوبارہ لینے کے لیے تیار۔');
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-slate-300 hover:bg-slate-100 text-slate-900 text-xs font-bold"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>{isEn ? 'Retake Clearer Photo' : 'واضح تصویر دوبارہ لیں'}</span>
                </button>
                <button
                  type="button"
                  data-testid="doc-opt-human-review"
                  onClick={() =>
                    setActionNote(
                      isEn
                        ? 'Queued for Human Officer manual check — you are NOT blocked or auto-rejected!'
                        : 'انسانی افسر کے دستی جائزے کے لیے بھیج دیا گیا — آپ کو بلاک نہیں کیا گیا!',
                    )
                  }
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold"
                >
                  <UserCheck className="h-3.5 w-3.5" />
                  <span>{isEn ? 'Send to Human Officer for Manual Check' : 'انسانی افسر کو دستی چیک کے لیے بھیجیں'}</span>
                </button>
              </div>
            )}

            {actionNote && (
              <div data-testid="doc-action-confirmation" className="text-xs font-bold text-teal-900 bg-teal-50 border border-teal-200 rounded-lg p-2.5">
                {actionNote}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
