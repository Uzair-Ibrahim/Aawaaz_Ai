'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { LANGUAGE_LIST, LANGUAGE_REGISTRY } from '@awaaz/shared';
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  CloudOff,
  Hand,
  Headphones,
  Layers,
  Lock,
  MessageSquare,
  Mic,
  Phone,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Square,
  UserCheck,
  Users,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { CitizenConsentModal, DocumentAuthenticityModal } from '@/components/citizen/CitizenRubricDrawers';
import { useVoiceAgent } from '@/components/voice/GlobalVoiceSaathiProvider';
import { apiRequest } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/context';
import { formatText, useI18n } from '@/lib/i18n/context';
import {
  enqueueOfflineReliefClaim,
  isEffectiveOffline,
  listOfflineQueuedClaims,
  NETWORK_MODE_EVENT,
  removeOfflineQueuedClaim,
  savePersistedVoiceDraft,
  type OfflineQueuedReliefClaim,
} from '@/lib/offline/voice-offline-queue';

export function VoiceSaathiOverlay({
  onOpenKeypadPhone,
  onCaseSubmitted,
}: {
  onOpenKeypadPhone?: () => void;
  onCaseSubmitted?: () => void;
}) {
  const { user, token, activeOrganizationId } = useAuth();
  const { dict, setLanguage, statusLabel } = useI18n();
  const va = dict.voiceAgent;
  const [consentModalOpen, setConsentModalOpen] = useState(false);
  const [docModalOpen, setDocModalOpen] = useState(false);
  const [isOfflineMode, setIsOfflineMode] = useState(false);
  const [offlineQueue, setOfflineQueue] = useState<OfflineQueuedReliefClaim[]>([]);
  const [offlineDistrict, setOfflineDistrict] = useState('Multan');
  const [offlineIncome, setOfflineIncome] = useState('14000');
  const [offlineAmount, setOfflineAmount] = useState('4500');
  const [offlineReason, setOfflineReason] = useState('Flood relief emergency support');
  const [offlineSyncBanner, setOfflineSyncBanner] = useState<string | null>(null);
  const [syncingOffline, setSyncingOffline] = useState(false);

  const {
    workflowStage,
    suspendedTasks,
    handsFreeVad,
    setHandsFreeVad,
    autoInterrupt,
    setAutoInterrupt,
    isVoiceDisabledForStaff,
    orbState,
    audioLevel,
    detectedLang,
    lastTranscript,
    manualText,
    setManualText,
    agentReply,
    formState,
    authDraft,
    fieldFillHistory,
    editingField,
    validationErrors,
    recentlyUpdatedFields,
    scamAlert,
    policyAnswer,
    escalationInfo,
    applicationsStatus,
    officerInquiries,
    setActivated,
    sendSessionTurn,
    handleActivateTouch,
    interruptAndListen,
    hardStopVoiceAgent,
    handleResetSession,
    handleImageUpload,
    replayCurrentReply,
    registerOnCaseSubmitted,
  } = useVoiceAgent();

  useEffect(() => {
    registerOnCaseSubmitted(onCaseSubmitted ?? null);
    return () => registerOnCaseSubmitted(null);
  }, [onCaseSubmitted, registerOnCaseSubmitted]);

  useEffect(() => {
    if (!editingField) return;
    const selector = `[data-testid="form-field-${editingField}"], [data-testid="auth-field-${editingField}"]`;
    const el = document.querySelector(selector);
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [editingField]);

  // Challenge 07: Persist non-empty draft automatically in localStorage so refreshes never lose progress
  useEffect(() => {
    if (formState.district || formState.monthly_income !== null || formState.amount !== null || formState.reason) {
      savePersistedVoiceDraft({
        district: formState.district,
        monthly_income: formState.monthly_income,
        amount: formState.amount,
        reason: formState.reason,
        language: detectedLang,
      });
    }
  }, [formState.district, formState.monthly_income, formState.amount, formState.reason, detectedLang]);

  // Challenge 07: Auto-sync queued offline claims the instant connectivity returns
  const syncQueuedOfflineClaims = useCallback(async () => {
    if (!token || !activeOrganizationId || user?.active_role !== 'citizen') return;
    const queued = listOfflineQueuedClaims();
    if (queued.length === 0) return;
    setSyncingOffline(true);
    const syncedRefs: string[] = [];
    for (const item of queued) {
      try {
        const created = await apiRequest<{ case: { id: string } }>('/cases', {
          method: 'POST',
          token,
          organizationId: activeOrganizationId,
          body: {
            scheme_id: 'MOCK_RELIEF_01',
            preferred_language: detectedLang,
            idempotency_key: `offline-sync-${item.id}`,
          },
        });
        await apiRequest('/consent', {
          method: 'POST',
          token,
          organizationId: activeOrganizationId,
          body: {
            consent_type: 'processing',
            case_id: created.case.id,
            permissions: ['application_processing', 'ai_extraction'],
          },
        });
        await apiRequest(`/cases/${created.case.id}/answers`, {
          method: 'PATCH',
          token,
          organizationId: activeOrganizationId,
          body: {
            preferred_language: detectedLang,
            current_step: 'submit',
            answers: [
              { field_name: 'full_name', field_value: user.display_name, source: 'text', confirmed_by_citizen: true },
              { field_name: 'mock_identity_reference', field_value: '42101-1234567-2', source: 'text', confirmed_by_citizen: true },
              { field_name: 'district', field_value: item.district, source: 'text', confirmed_by_citizen: true },
              { field_name: 'household_size', field_value: 5, source: 'text', confirmed_by_citizen: true },
              { field_name: 'monthly_income', field_value: item.monthly_income, source: 'text', confirmed_by_citizen: true },
              { field_name: 'employment_status', field_value: 'daily_wage', source: 'text', confirmed_by_citizen: true },
              {
                field_name: 'relief_reason',
                field_value: `${item.reason} (Requested amount: ${item.amount} PKR, Category: flood_relief)`,
                source: 'text',
                confirmed_by_citizen: true,
              },
            ],
          },
        });
        const sub = await apiRequest<{ reference_number: string }>(`/cases/${created.case.id}/submit`, {
          method: 'POST',
          token,
          organizationId: activeOrganizationId,
          body: { explicit_confirmation: true },
        });
        removeOfflineQueuedClaim(item.id);
        syncedRefs.push(sub.reference_number);
      } catch {
        // Keep in queue for next retry if server unreachable
      }
    }
    setOfflineQueue(listOfflineQueuedClaims());
    setSyncingOffline(false);
    if (syncedRefs.length > 0) {
      setOfflineSyncBanner(`Auto-synced ${syncedRefs.length} queued offline claim(s): ${syncedRefs.join(', ')}`);
      if (onCaseSubmitted) onCaseSubmitted();
    }
  }, [token, activeOrganizationId, user, detectedLang, onCaseSubmitted]);

  useEffect(() => {
    const refreshNet = () => {
      const off = isEffectiveOffline();
      setIsOfflineMode(off);
      setOfflineQueue(listOfflineQueuedClaims());
      if (!off && listOfflineQueuedClaims().length > 0) {
        void syncQueuedOfflineClaims();
      }
    };
    refreshNet();
    window.addEventListener('online', refreshNet);
    window.addEventListener('offline', refreshNet);
    window.addEventListener(NETWORK_MODE_EVENT, refreshNet);
    return () => {
      window.removeEventListener('online', refreshNet);
      window.removeEventListener('offline', refreshNet);
      window.removeEventListener(NETWORK_MODE_EVENT, refreshNet);
    };
  }, [syncQueuedOfflineClaims]);

  // PHASE 3: Strictly hidden & silent for Officer, Admin, and Auditor accounts/routes
  if (isVoiceDisabledForStaff) {
    return null;
  }

  const isCitizenAccount = user?.active_role === 'citizen';
  const showKeypadBtn = (!user || isCitizenAccount) && Boolean(onOpenKeypadPhone);
  const isActive = orbState === 'LISTENING' || orbState === 'THINKING' || orbState === 'SPEAKING';

  const reliefFields = [
    { key: 'name', label: va.fieldName },
    { key: 'cnic', label: va.fieldCnic },
    { key: 'district', label: va.fieldDistrict },
    { key: 'monthly_income', label: va.fieldIncome },
    { key: 'amount', label: va.fieldAmount },
    { key: 'reason', label: va.fieldReason },
    { key: 'consent_confirmed', label: va.fieldConsent },
  ] as const;

  const authSignupFields = [
    { key: 'full_name', label: va.authFieldName },
    { key: 'cnic', label: va.authFieldCnic },
    { key: 'phone', label: va.authFieldPhone },
    { key: 'pin', label: va.authFieldPin },
  ] as const;

  const isHighlighted = (field: string) => recentlyUpdatedFields.includes(field);
  const errorForField = (field: string) => validationErrors.find((e) => e.field === field);
  const currentReliefField = editingField ?? formState.missing_fields[0] ?? null;
  const filledReliefCount = 7 - formState.missing_fields.length;

  return (
    <section
      data-testid="voice-saathi-overlay"
      data-workflow-stage={workflowStage}
      data-voice-state={orbState}
      className="rounded-3xl bg-gradient-to-br from-slate-900 via-teal-950 to-slate-900 text-white p-5 sm:p-7 shadow-xl border border-teal-700/50 space-y-5"
    >
      {/* Clean Minimal Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 flex-wrap min-w-0">
          <h2 className="text-lg sm:text-xl font-bold">{va.title}</h2>
          <span
            data-testid="detected-language-badge"
            className="px-2.5 py-0.5 rounded-full bg-teal-400/20 border border-teal-300/40 text-teal-200 text-xs font-bold"
          >
            {LANGUAGE_REGISTRY[detectedLang]?.native_name} ({detectedLang.toUpperCase()})
          </span>
          {user && (
            <span
              data-testid="authenticated-citizen-badge"
              className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/25 border border-emerald-300/40 text-emerald-200 text-xs font-bold"
            >
              <UserCheck className="h-3.5 w-3.5" />
              <span>{user.display_name}</span>
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Compact Auto Interrupt: ON/OFF toggle */}
          <button
            type="button"
            data-testid="voice-auto-interrupt-toggle"
            aria-pressed={autoInterrupt}
            onClick={() => setAutoInterrupt(!autoInterrupt)}
            className={`px-3 py-1.5 rounded-xl border text-xs font-bold transition ${
              autoInterrupt
                ? 'bg-emerald-900/70 border-emerald-400/60 text-emerald-100'
                : 'bg-slate-800/90 border-slate-700 text-slate-300'
            }`}
          >
            {detectedLang === 'en'
              ? `Auto Interrupt: ${autoInterrupt ? 'ON' : 'OFF'}`
              : `خودکار مداخلت: ${autoInterrupt ? 'آن' : 'آف'}`}
          </button>

          <label className="inline-flex items-center gap-1.5 text-xs bg-slate-800/90 border border-slate-700 px-3 py-1.5 rounded-xl cursor-pointer">
            <input
              type="checkbox"
              checked={handsFreeVad}
              onChange={(e) => setHandsFreeVad(e.target.checked)}
              className="rounded accent-teal-500"
            />
            <span>{va.handsFreeVad}</span>
          </label>

          <button
            type="button"
            onClick={() => handleResetSession()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-600 text-white text-xs font-bold"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>{va.resetBtn}</span>
          </button>

          {/* Citizen My Data & Consent Control (Challenge 06) */}
          {isCitizenAccount && (
            <button
              type="button"
              data-testid="citizen-consent-drawer-btn"
              onClick={() => setConsentModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 border border-indigo-400/50 text-white text-xs font-bold shadow-xs transition"
            >
              <Lock className="h-3.5 w-3.5" />
              <span>{detectedLang === 'en' ? 'My Data & Consent' : 'میرا ڈیٹا اور اجازت'}</span>
            </button>
          )}

          {/* Keypad Phone Demo: visible on Home (/) & Normal Citizen accounts ONLY */}
          {showKeypadBtn && onOpenKeypadPhone && (
            <button
              type="button"
              data-testid="overlay-keypad-btn"
              onClick={onOpenKeypadPhone}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow-sm transition"
            >
              <Phone className="h-4 w-4" />
              <span>{va.keypadBtn}</span>
            </button>
          )}
        </div>
      </div>

      {/* Challenge 07: Real Offline / Weak-Connection Queue & Auto-Sync Bar */}
      {(isOfflineMode || offlineQueue.length > 0 || offlineSyncBanner) && (
        <div
          data-testid="offline-queue-banner"
          className="rounded-2xl bg-amber-500/20 border border-amber-400/60 px-4 py-3 text-xs text-amber-50 space-y-2.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-bold">
              <CloudOff className="h-4 w-4 text-amber-300 shrink-0" />
              <span>
                {isOfflineMode
                  ? detectedLang === 'en'
                    ? 'Offline / Weak-Connection Mode: Save claims locally — they auto-sync when online!'
                    : 'آف لائن موڈ: درخواست مقامی طور پر محفوظ کریں، انٹرنیٹ آتے ہی خودکار جمع ہو جائے گی!'
                  : syncingOffline
                    ? 'Syncing queued offline claims...'
                    : 'Offline Queue Ready'}
              </span>
              <span
                data-testid="offline-queue-count"
                className="px-2 py-0.5 rounded-full bg-amber-400 text-slate-950 font-extrabold"
              >
                Queued: {offlineQueue.length}
              </span>
            </div>
            {!isOfflineMode && offlineQueue.length > 0 && isCitizenAccount && (
              <button
                type="button"
                data-testid="manual-sync-offline-btn"
                onClick={() => void syncQueuedOfflineClaims()}
                className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-emerald-500 text-slate-950 font-bold"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Sync Now</span>
              </button>
            )}
          </div>

          {offlineSyncBanner && (
            <div
              data-testid="offline-sync-success-banner"
              className="px-3 py-2 rounded-xl bg-emerald-500/30 border border-emerald-300 text-emerald-50 font-bold"
            >
              ✓ {offlineSyncBanner}
            </div>
          )}

          {isOfflineMode && (
            <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 pt-1">
              <input
                data-testid="offline-district-input"
                type="text"
                value={offlineDistrict}
                onChange={(e) => setOfflineDistrict(e.target.value)}
                placeholder="District"
                className="rounded-lg bg-slate-900/90 border border-amber-400/50 px-2.5 py-1.5 text-white"
              />
              <input
                data-testid="offline-income-input"
                type="number"
                value={offlineIncome}
                onChange={(e) => setOfflineIncome(e.target.value)}
                placeholder="Monthly Income"
                className="rounded-lg bg-slate-900/90 border border-amber-400/50 px-2.5 py-1.5 text-white"
              />
              <input
                data-testid="offline-amount-input"
                type="number"
                value={offlineAmount}
                onChange={(e) => setOfflineAmount(e.target.value)}
                placeholder="Amount PKR"
                className="rounded-lg bg-slate-900/90 border border-amber-400/50 px-2.5 py-1.5 text-white"
              />
              <input
                data-testid="offline-reason-input"
                type="text"
                value={offlineReason}
                onChange={(e) => setOfflineReason(e.target.value)}
                placeholder="Reason"
                className="rounded-lg bg-slate-900/90 border border-amber-400/50 px-2.5 py-1.5 text-white"
              />
              <button
                type="button"
                data-testid="save-offline-claim-btn"
                onClick={() => {
                  enqueueOfflineReliefClaim({
                    district: offlineDistrict.trim() || 'Multan',
                    monthly_income: Number(offlineIncome) || 14000,
                    amount: Number(offlineAmount) || 4500,
                    reason: offlineReason.trim() || 'Flood relief emergency support',
                    language: detectedLang,
                  });
                  setOfflineQueue(listOfflineQueuedClaims());
                  setOfflineSyncBanner(null);
                }}
                className="px-3 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 font-extrabold"
              >
                Save Offline Claim
              </button>
            </div>
          )}
        </div>
      )}

      {/* Main Split Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Large Smooth Voice Orb + Instant Interrupt / Hard Stop + Text & Camera */}
        <div className="lg:col-span-5 min-w-0 flex flex-col items-center text-center space-y-4 p-5 rounded-2xl bg-slate-950/40 border border-teal-800/40">
          {suspendedTasks.length > 0 && (
            <div
              data-testid="suspended-task-banner"
              className="w-full px-3 py-2 rounded-xl bg-amber-500/20 border border-amber-400/50 text-amber-100 text-xs flex items-center justify-between gap-2"
            >
              <span className="inline-flex items-center gap-1.5 font-bold">
                <Layers className="h-4 w-4 text-amber-300 shrink-0" />
                <span>⏸ {va.suspendedBanner}</span>
              </span>
              <button
                type="button"
                onClick={() => void sendSessionTurn({ transcript: 'Haan wapis form mukammal karo', autoReopenMic: false })}
                className="px-2.5 py-1 rounded-lg bg-amber-400 text-slate-950 font-bold text-[11px]"
              >
                {va.resumeBtn}
              </button>
            </div>
          )}

          {editingField && (
            <div
              data-testid="editing-field-banner"
              className="w-full px-3 py-2 rounded-xl bg-amber-500/25 border border-amber-300 text-amber-100 text-xs font-bold flex items-center justify-center gap-1.5"
            >
              <span>✎ {va.editingFieldBanner}: {editingField}</span>
            </div>
          )}

          {/* LARGE SMOOTH SPEAK-TO-AGENT VOICE ORB */}
          <div className="pt-3 pb-1 flex flex-col items-center gap-5">
            <button
              type="button"
              data-testid="voice-orb-btn"
              onClick={() => void handleActivateTouch()}
              className="relative group focus:outline-none select-none cursor-pointer"
              aria-label={orbState === 'SPEAKING' ? 'Interrupt and Answer' : va.tapToSpeak}
            >
              <span
                aria-hidden="true"
                className={`pointer-events-none absolute -inset-4 rounded-full transition-all duration-300 ${
                  orbState === 'LISTENING'
                    ? 'bg-rose-500/35 animate-ping'
                    : orbState === 'THINKING'
                      ? 'bg-amber-400/30 animate-pulse'
                      : orbState === 'SPEAKING'
                        ? 'bg-emerald-400/35 animate-ping'
                        : 'bg-teal-400/20 group-hover:bg-teal-400/35'
                }`}
                style={orbState === 'LISTENING' ? { transform: `scale(${1 + audioLevel / 180})` } : undefined}
              />
              <div
                className={`relative h-44 w-44 sm:h-48 sm:w-48 rounded-full flex flex-col items-center justify-center gap-2 shadow-2xl border-4 transition-transform duration-200 ease-out active:scale-95 ${
                  orbState === 'LISTENING'
                    ? 'bg-gradient-to-br from-rose-600 to-rose-800 border-rose-300 scale-105'
                    : orbState === 'THINKING'
                      ? 'bg-gradient-to-br from-amber-500 to-amber-700 border-amber-200'
                      : orbState === 'SPEAKING'
                        ? 'bg-gradient-to-br from-emerald-600 to-teal-800 border-emerald-300 hover:scale-105'
                        : 'bg-gradient-to-br from-teal-600 to-emerald-800 border-teal-300 hover:scale-105'
                }`}
              >
                {orbState === 'LISTENING' ? (
                  <Square className="h-12 w-12 text-white" />
                ) : orbState === 'SPEAKING' ? (
                  <Volume2 className="h-12 w-12 text-white animate-bounce" />
                ) : (
                  <Mic className="h-12 w-12 text-white" />
                )}
                <span className="text-sm font-extrabold uppercase tracking-wide px-3">
                  {orbState === 'LISTENING'
                    ? va.listening
                    : orbState === 'THINKING'
                      ? va.reasoning
                      : orbState === 'SPEAKING'
                        ? detectedLang === 'en'
                          ? 'Tap to Interrupt'
                          : 'روک کر بولیں'
                        : va.tapToSpeak}
                </span>
              </div>
            </button>

            {/* Instant Barge-In & Hard Stop Action Row */}
            <div className="relative z-10 flex flex-wrap items-center justify-center gap-2 min-h-[38px]">
              {orbState === 'SPEAKING' && (
                <button
                  type="button"
                  data-testid="voice-interrupt-btn"
                  onClick={() => void interruptAndListen()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-extrabold text-xs sm:text-sm shadow-md transition"
                >
                  <Hand className="h-4 w-4" />
                  <span>{detectedLang === 'en' ? 'Interrupt & Answer' : 'روک کر جواب دیں'}</span>
                </button>
              )}

              {isActive ? (
                <button
                  type="button"
                  data-testid="voice-stop-btn"
                  onClick={() => hardStopVoiceAgent()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-extrabold text-xs sm:text-sm shadow-md border border-rose-300/60 transition"
                >
                  <VolumeX className="h-4 w-4" />
                  <span>{detectedLang === 'en' ? 'Stop' : 'روکیں'}</span>
                </button>
              ) : (
                <span
                  data-testid="voice-standby-badge"
                  className="px-3 py-1 rounded-full bg-slate-800/80 border border-slate-700 text-slate-300 text-xs font-medium"
                >
                  {detectedLang === 'en' ? 'Standby • Tap Orb to Speak' : 'تیار • بولنے کے لیے بٹن دبائیں'}
                </span>
              )}
            </div>
          </div>

          {/* Last User Utterance & Agent Reply */}
          <div className="w-full min-w-0 space-y-2">
            {lastTranscript && (
              <div
                data-testid="voice-last-transcript"
                className="px-3.5 py-2 rounded-xl bg-slate-900/90 border border-slate-700 text-xs text-amber-200 break-words"
              >
                <strong>{va.youSaid}</strong> {lastTranscript}
              </div>
            )}
            <div className="p-3.5 rounded-2xl bg-teal-900/50 border border-teal-600/50 text-sm sm:text-base font-medium text-teal-50 leading-relaxed space-y-2 break-words">
              <p data-testid="voice-agent-reply" className="break-words">{agentReply}</p>
              <button
                type="button"
                data-testid="voice-replay-btn"
                onClick={() => void replayCurrentReply()}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-teal-800/80 hover:bg-teal-700 text-xs font-semibold text-teal-100 border border-teal-500/40"
              >
                <Volume2 className="h-3.5 w-3.5" />
                <span>{va.replayVoice}</span>
              </button>
            </div>
          </div>

          {validationErrors.length > 0 && (
            <div
              data-testid="validation-errors-box"
              className="w-full min-w-0 p-3 rounded-xl bg-rose-950/90 border-2 border-rose-400 text-rose-100 text-xs text-start space-y-1 break-words"
            >
              <div className="font-bold flex items-center gap-1.5 text-rose-200">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{va.validationRejectedTitle}</span>
              </div>
              {validationErrors.map((err, i) => (
                <div key={i}>
                  • <strong>{err.field}:</strong> {err.message}
                </div>
              ))}
            </div>
          )}

          {/* Clean Text Fallback Input */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!manualText.trim() || orbState === 'THINKING') return;
              const toSend = manualText.trim();
              setManualText('');
              setActivated(true);
              void sendSessionTurn({ transcript: toSend, autoReopenMic: false });
            }}
            className="w-full min-w-0 flex gap-2"
          >
            <input
              data-testid="voice-manual-input"
              type="text"
              value={manualText}
              onChange={(e) => setManualText(e.target.value)}
              placeholder={va.inputPlaceholder}
              className="flex-1 min-w-0 rounded-xl bg-slate-900/90 border border-teal-700 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-400 focus:outline-none focus:border-teal-400"
            />
            <button
              data-testid="voice-manual-submit"
              type="submit"
              disabled={!manualText.trim() || orbState === 'THINKING'}
              className="shrink-0 px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 disabled:opacity-40 font-bold text-xs inline-flex items-center gap-1"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>

          {/* Multimodal Camera & Authenticity Buttons */}
          <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
            <button
              type="button"
              data-testid="open-doc-scan-modal-btn"
              onClick={() => setDocModalOpen(true)}
              className="cursor-pointer py-2.5 px-3 rounded-xl bg-teal-700 hover:bg-teal-600 border border-teal-400/40 flex items-center justify-center gap-2 font-bold text-xs"
            >
              <Camera className="h-4 w-4 shrink-0" />
              <span>{va.scanCnicBill}</span>
            </button>
            <label className="cursor-pointer py-2.5 px-3 rounded-xl bg-rose-800/90 hover:bg-rose-700 border border-rose-400/40 flex items-center justify-center gap-2 font-bold text-xs">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{va.scanScamSms}</span>
              <input
                type="file"
                accept=".png,.jpg,.jpeg,.webp,.txt"
                className="hidden"
                onChange={(e) => void handleImageUpload(e.target.files?.[0] ?? null, 'scam_screenshot')}
              />
            </label>
          </div>
        </div>

        {/* Right: Clean, Simple Contextual Workspace (NO MCP trace or technical cognitive logs!) */}
        <div className="lg:col-span-7 min-w-0 rounded-2xl bg-white text-slate-900 p-5 space-y-4 shadow-lg">
          {/* HOME WELCOME / ROLE SELECTION */}
          {(workflowStage === 'HOME_WELCOME' || workflowStage === 'ROLE_IDENTIFICATION' || workflowStage === 'LANGUAGE_SELECT') && !user && (
            <div data-testid="stage-home-welcome" className="space-y-5">
              <div className="border-b border-slate-200 pb-3">
                <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  <Users className="h-5 w-5 text-teal-700" />
                  <span>{detectedLang === 'en' ? 'Who are you?' : 'آپ کون ہیں؟'}</span>
                </h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  data-testid="quick-role-citizen"
                  onClick={() => void sendSessionTurn({ transcript: 'I am a normal citizen', autoReopenMic: false })}
                  className="p-4 rounded-2xl border-2 border-teal-200 bg-teal-50/60 hover:border-teal-600 hover:bg-teal-100 text-start transition"
                >
                  <div className="font-bold text-base text-teal-950">{va.roleQuickCitizen}</div>
                </button>
                <button
                  type="button"
                  data-testid="quick-role-officer"
                  onClick={() => void sendSessionTurn({ transcript: 'I am a department officer', autoReopenMic: false })}
                  className="p-4 rounded-2xl border-2 border-slate-200 hover:border-teal-600 hover:bg-slate-50 text-start transition"
                >
                  <div className="font-bold text-base text-slate-900">{va.roleQuickOfficer}</div>
                </button>
                <button
                  type="button"
                  data-testid="quick-role-admin"
                  onClick={() => void sendSessionTurn({ transcript: 'I am an admin', autoReopenMic: false })}
                  className="p-4 rounded-2xl border-2 border-slate-200 hover:border-teal-600 hover:bg-slate-50 text-start transition"
                >
                  <div className="font-bold text-base text-slate-900">{va.roleQuickAdmin}</div>
                </button>
                <button
                  type="button"
                  data-testid="quick-role-helper"
                  onClick={() => void sendSessionTurn({ transcript: 'I am a community helper', autoReopenMic: false })}
                  className="p-4 rounded-2xl border-2 border-slate-200 hover:border-teal-600 hover:bg-slate-50 text-start transition"
                >
                  <div className="font-bold text-base text-slate-900">{va.roleQuickHelper}</div>
                </button>
              </div>

              <div className="pt-2 border-t border-slate-100">
                <div className="text-xs font-semibold text-slate-500 mb-2">{dict.selectLanguage}</div>
                <div className="flex flex-wrap gap-2">
                  {LANGUAGE_LIST.map((entry) => (
                    <button
                      key={entry.language_code}
                      type="button"
                      data-testid={`voice-lang-card-${entry.language_code}`}
                      onClick={() => {
                        setLanguage(entry.language_code);
                        setActivated(true);
                      }}
                      className={`px-3 py-1.5 rounded-xl border text-xs font-bold transition ${
                        detectedLang === entry.language_code
                          ? 'bg-teal-700 text-white border-teal-700'
                          : 'bg-slate-50 text-slate-800 border-slate-200 hover:border-teal-500'
                      }`}
                    >
                      {entry.native_name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* CITIZEN ACCOUNT CHECK & EXPLICIT CONSENT */}
          {workflowStage === 'CITIZEN_ACCOUNT_CHECK' && !user && (
            <div data-testid="stage-citizen-account-check" className="space-y-4">
              <div className="border-b border-slate-200 pb-3">
                <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-teal-700" />
                  <span>
                    {authDraft.wants_account_question_asked
                      ? detectedLang === 'en'
                        ? 'Create a New Account?'
                        : 'نیا اکاؤنٹ بنائیں؟'
                      : detectedLang === 'en'
                        ? 'Do You Have an Account?'
                        : 'کیا آپ کا اکاؤنٹ بنا ہوا ہے؟'}
                  </span>
                </h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  data-testid="account-check-yes-btn"
                  onClick={() => void sendSessionTurn({ transcript: 'Yes', autoReopenMic: false })}
                  className="p-4 rounded-2xl border-2 border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-950 font-bold text-base transition"
                >
                  {authDraft.wants_account_question_asked
                    ? detectedLang === 'en'
                      ? 'Yes, create new account'
                      : 'ہاں، نیا اکاؤنٹ بنائیں'
                    : detectedLang === 'en'
                      ? 'Yes, sign in'
                      : 'ہاں، اکاؤنٹ موجود ہے'}
                </button>
                <button
                  type="button"
                  data-testid="account-check-no-btn"
                  onClick={() =>
                    void sendSessionTurn({
                      transcript: authDraft.wants_account_question_asked ? 'No, do not create' : 'No, my account is not created',
                      autoReopenMic: false,
                    })
                  }
                  className="p-4 rounded-2xl border-2 border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-900 font-bold text-base transition"
                >
                  {authDraft.wants_account_question_asked
                    ? detectedLang === 'en'
                      ? 'No, return home'
                      : 'نہیں، ہوم پر واپس جائیں'
                    : detectedLang === 'en'
                      ? 'No, I do not have an account'
                      : 'نہیں، میرا اکاؤنٹ نہیں بنا'}
                </button>
              </div>
            </div>
          )}

          {/* STAGE 2: AUTH GATE */}
          {workflowStage === 'AUTH_GATE' && (
            <div data-testid="stage-auth-gate" className="space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2 border-b border-slate-200 pb-3">
                <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-teal-700" />
                  <span>{va.stage2Title}</span>
                </h3>
                <span className="px-2.5 py-1 rounded-full bg-teal-50 text-teal-900 text-xs font-bold border border-teal-200">
                  {authDraft.mode.toUpperCase()}
                </span>
              </div>

              <div className="space-y-2.5">
                {authSignupFields.map((f) => {
                  const val =
                    f.key === 'full_name'
                      ? authDraft.full_name
                      : f.key === 'cnic'
                        ? authDraft.cnic
                        : f.key === 'phone'
                          ? authDraft.phone
                          : authDraft.pin;
                  const err = errorForField(f.key);
                  const filled = Boolean(val);
                  const isEditing = editingField === f.key;
                  return (
                    <div
                      key={f.key}
                      data-testid={`auth-field-${f.key}`}
                      data-filled={filled ? 'true' : 'false'}
                      data-invalid={err ? 'true' : 'false'}
                      data-editing={isEditing ? 'true' : 'false'}
                      className={`p-3 rounded-xl border-2 transition ${
                        err
                          ? 'border-rose-500 bg-rose-50'
                          : isEditing
                            ? 'border-amber-500 bg-amber-50 ring-2 ring-amber-300/60'
                            : filled
                              ? 'border-emerald-500 bg-emerald-50/60'
                              : 'border-slate-200 bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-slate-700">{f.label}</span>
                        {err ? (
                          <span className="text-rose-700 font-bold">✕ {va.statusInvalid}</span>
                        ) : isEditing ? (
                          <span className="px-2 py-0.5 rounded-full bg-amber-200 text-amber-950 font-bold">
                            ✎ {va.statusEditing}
                          </span>
                        ) : filled ? (
                          <span className="text-emerald-700 font-bold inline-flex items-center gap-1">
                            <CheckCircle2 className="h-4 w-4" /> {va.statusValidated}
                          </span>
                        ) : (
                          <span className="text-slate-400">{va.statusPending}</span>
                        )}
                      </div>
                      <div data-testid={`auth-value-${f.key}`} className="font-bold text-slate-900 mt-1 text-sm">
                        {val || <span className="text-slate-400 font-normal text-xs">{va.waitingForVoice}</span>}
                      </div>
                      {err && <div className="text-xs text-rose-700 font-semibold mt-1">{err.message}</div>}
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => void sendSessionTurn({ transcript: 'Naya account banana hai', autoReopenMic: false })}
                  className="px-3 py-1.5 rounded-xl bg-teal-50 hover:bg-teal-700 text-teal-950 hover:text-white text-xs font-bold border border-teal-300"
                >
                  {va.createVoiceAccountBtn}
                </button>
                <button
                  type="button"
                  onClick={() => void sendSessionTurn({ transcript: 'Login citizen_zainab password citizen123', autoReopenMic: false })}
                  className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-800 text-slate-800 hover:text-white text-xs font-bold border border-slate-300"
                >
                  {va.demoLoginBtn}
                </button>
              </div>
            </div>
          )}

          {/* STAGE 3: CITIZEN SERVICE HUB */}
          {workflowStage === 'AGENT_HUB' && (
            <div data-testid="stage-agent-hub" className="space-y-4">
              <div className="border-b border-slate-200 pb-3">
                <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-teal-700" />
                  <span>{va.stage3Title}</span>
                </h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  data-testid="hub-action-relief"
                  onClick={() => void sendSessionTurn({ transcript: 'Mujhe relief ki darkhwast deni hai', autoReopenMic: false })}
                  className="p-4 rounded-2xl border-2 border-teal-200 bg-teal-50/50 hover:bg-teal-100 text-start transition"
                >
                  <div className="font-bold text-teal-950">{va.hubApplyTitle}</div>
                </button>

                <button
                  type="button"
                  data-testid="hub-action-status"
                  onClick={() => void sendSessionTurn({ transcript: 'Meri application ka status batao', autoReopenMic: false })}
                  className="p-4 rounded-2xl border-2 border-emerald-200 bg-emerald-50/50 hover:bg-emerald-100 text-start transition"
                >
                  <div className="font-bold text-emerald-950">{va.hubStatusTitle}</div>
                </button>

                <button
                  type="button"
                  data-testid="hub-action-officer"
                  onClick={() =>
                    void sendSessionTurn({
                      transcript: 'Direct department officer se poocho ke meri application kab approve hogi?',
                      autoReopenMic: false,
                    })
                  }
                  className="p-4 rounded-2xl border-2 border-amber-200 bg-amber-50/50 hover:bg-amber-100 text-start transition"
                >
                  <div className="font-bold text-amber-950">{va.hubOfficerTitle}</div>
                </button>

                <button
                  type="button"
                  data-testid="hub-action-scam"
                  onClick={() =>
                    void sendSessionTurn({
                      transcript: 'Mujhe 8171 se fake OTP aur Rs 500 fee ka message aaya hai, check karo scam hai?',
                      autoReopenMic: false,
                    })
                  }
                  className="p-4 rounded-2xl border-2 border-rose-200 bg-rose-50/50 hover:bg-rose-100 text-start transition"
                >
                  <div className="font-bold text-rose-950">{va.hubScamTitle}</div>
                </button>

                <button
                  type="button"
                  data-testid="hub-action-policy"
                  onClick={() => void sendSessionTurn({ transcript: 'Who is eligible and what is the income limit?', autoReopenMic: false })}
                  className="sm:col-span-2 p-4 rounded-2xl border-2 border-indigo-200 bg-indigo-50/50 hover:bg-indigo-100 text-start transition"
                >
                  <div className="font-bold text-indigo-950">{va.hubPolicyTitle}</div>
                </button>
              </div>
            </div>
          )}

          {/* STAGE 4: LIVE VALIDATED & EDITABLE RELIEF FORM */}
          {workflowStage === 'RELIEF_FORM' && (
            <div data-testid="stage-relief-form" className="space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2 border-b border-slate-200 pb-3">
                <h3 className="text-base sm:text-lg font-bold text-slate-900">{va.reliefFormTitle}</h3>
                <div className="flex items-center gap-2">
                  {fieldFillHistory.length > 0 && (
                    <button
                      type="button"
                      data-testid="voice-rollback-btn"
                      onClick={() => void sendSessionTurn({ transcript: 'Pichli field galat ho gayi, peeche jao', autoReopenMic: false })}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-950 font-bold text-xs border border-amber-300"
                    >
                      <ArrowLeft className="h-3.5 w-3.5" />
                      <span>{va.goBackBtn}</span>
                    </button>
                  )}
                  <span
                    data-testid="core-fields-counter"
                    className={`px-2.5 py-1 rounded-full font-bold text-xs ${
                      filledReliefCount === 7
                        ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                        : 'bg-teal-50 text-teal-800 border border-teal-200'
                    }`}
                  >
                    {formatText(va.fieldsValidated, { count: filledReliefCount })}
                  </span>
                </div>
              </div>

              <div className="space-y-2 text-sm">
                {reliefFields.map((field) => {
                  const rawVal =
                    field.key === 'name'
                      ? formState.name
                      : field.key === 'cnic'
                        ? formState.cnic
                        : field.key === 'district'
                          ? formState.district
                          : field.key === 'monthly_income'
                            ? formState.monthly_income !== null
                              ? `${formState.monthly_income} PKR`
                              : ''
                            : field.key === 'amount'
                              ? formState.amount !== null
                                ? `${formState.amount} PKR`
                                : ''
                              : field.key === 'reason'
                                ? formState.reason
                                : formState.consent_confirmed
                                  ? `✓ ${va.consentConfirmedValue}`
                                  : '';

                  const err = errorForField(field.key);
                  const filled = Boolean(rawVal) && !err;
                  const isEditing = editingField === field.key;
                  const isCurrent = currentReliefField === field.key;
                  const glowing = isHighlighted(field.key);

                  return (
                    <div
                      key={field.key}
                      data-testid={`form-field-${field.key}`}
                      data-filled={filled ? 'true' : 'false'}
                      data-invalid={err ? 'true' : 'false'}
                      data-editing={isEditing ? 'true' : 'false'}
                      className={`p-3 rounded-xl border-2 transition-all ${
                        err
                          ? 'border-rose-500 bg-rose-50 ring-2 ring-rose-300/60'
                          : isEditing
                            ? 'border-amber-500 bg-amber-50 ring-4 ring-amber-300/70'
                            : glowing
                              ? 'border-emerald-500 bg-emerald-50 ring-4 ring-emerald-300/60'
                              : filled
                                ? 'border-emerald-500/80 bg-emerald-50/40'
                                : isCurrent
                                  ? 'border-amber-500 bg-amber-50/70'
                                  : 'border-slate-200 bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-slate-700">{field.label}</span>
                        {err ? (
                          <span className="text-rose-700 font-bold">✕ {va.statusInvalid}</span>
                        ) : isEditing ? (
                          <span className="px-2 py-0.5 rounded-full bg-amber-300 text-amber-950 font-bold text-[11px]">
                            ✎ {va.statusEditing}
                          </span>
                        ) : filled ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700 font-bold">
                            <CheckCircle2 className="h-4 w-4" /> {va.statusFilled}
                          </span>
                        ) : isCurrent ? (
                          <span className="px-2 py-0.5 rounded-full bg-amber-200 text-amber-950 font-bold text-[11px]">
                            🎤 {va.statusAsking}
                          </span>
                        ) : (
                          <span className="text-slate-400">{va.statusPending}</span>
                        )}
                      </div>
                      <div data-testid={`form-value-${field.key}`} className="font-bold text-slate-900 mt-0.5 text-sm">
                        {rawVal || <span className="text-slate-400 font-normal text-xs">{va.waitingForVoice}</span>}
                      </div>
                      {err && <div className="text-xs text-rose-700 font-semibold mt-1">{err.message}</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* APPLICATION STATUS CARD */}
          {applicationsStatus.length > 0 && (
            <div
              data-testid="voice-application-status-card"
              className="p-4 rounded-2xl bg-emerald-50/70 border-2 border-emerald-300 text-slate-900 space-y-2.5"
            >
              <div className="font-bold text-sm flex items-center gap-1.5 text-emerald-950">
                <ClipboardCheck className="h-4 w-4 text-emerald-700" />
                <span>{dict.appStatus.panelTitle} ({applicationsStatus.length})</span>
              </div>
              <div className="space-y-2">
                {applicationsStatus.map((app) => (
                  <div key={app.case_id} className="p-3 rounded-xl bg-white border border-emerald-200 text-xs space-y-1">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="font-mono font-bold text-emerald-900" dir="ltr">
                        {app.reference_number}
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-teal-100 text-teal-900 font-bold">
                        {statusLabel(app.status)}
                      </span>
                    </div>
                    <div className="text-slate-700 flex flex-wrap items-center gap-2">
                      <span>
                        {dict.appStatus.amountLabel}: <strong>{app.requested_amount ?? 15000} PKR</strong>
                      </span>
                      {app.rule_version_used && (
                        <span className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-900 font-mono font-bold">
                          Rule {app.rule_version_used}
                        </span>
                      )}
                      {app.decision_tier && (
                        <span className="px-2 py-0.5 rounded bg-slate-200 text-slate-800 font-bold">
                          {app.decision_tier}
                        </span>
                      )}
                    </div>
                    {app.citizen_simple_reason && (
                      <div
                        data-testid="citizen-simple-reason"
                        className="text-slate-800 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5"
                      >
                        <strong>{detectedLang === 'en' ? 'Why This Decision:' : 'فیصلے کی وجہ:'}</strong>{' '}
                        {app.citizen_simple_reason}
                      </div>
                    )}
                    {app.officer_notes && (
                      <div className="text-teal-900 bg-teal-50 rounded-lg px-2.5 py-1.5">
                        <strong>{dict.appStatus.officerNotesLabel}:</strong> {app.officer_notes}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* DIRECT OFFICER INQUIRY CARD */}
          {officerInquiries.length > 0 && (
            <div
              data-testid="voice-officer-inquiry-card"
              className="p-4 rounded-2xl bg-amber-50/70 border-2 border-amber-300 text-slate-900 space-y-2.5"
            >
              <div className="font-bold text-sm flex items-center gap-1.5 text-amber-950">
                <MessageSquare className="h-4 w-4 text-amber-700" />
                <span>{dict.officerInquiry.citizenPanelTitle}</span>
              </div>
              <div className="space-y-2">
                {officerInquiries.map((inq) => (
                  <div
                    key={inq.id}
                    data-testid={`voice-inquiry-${inq.tracking_reference}`}
                    className="p-3 rounded-xl bg-white border border-amber-200 text-xs space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="font-mono font-bold text-amber-900" dir="ltr">
                        {inq.tracking_reference}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full font-bold ${
                          inq.status === 'ANSWERED'
                            ? 'bg-emerald-100 text-emerald-900'
                            : 'bg-amber-100 text-amber-900'
                        }`}
                      >
                        {inq.status}
                      </span>
                    </div>
                    <p className="text-slate-800 font-medium">{inq.question_text}</p>
                    {inq.officer_reply ? (
                      <div
                        data-testid={`voice-inquiry-reply-${inq.tracking_reference}`}
                        className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-950"
                      >
                        <strong>{dict.officerInquiry.officialReplyLabel}:</strong> {inq.officer_reply}
                      </div>
                    ) : (
                      <div className="text-slate-500 italic">{dict.officerInquiry.awaitingReply}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ESCALATION CARD */}
          {(workflowStage === 'ESCALATION_CONFIRM' || escalationInfo) && escalationInfo && (
            <div
              data-testid="escalation-card"
              className={`p-4 rounded-2xl border-2 space-y-2 ${
                escalationInfo.status === 'OPEN'
                  ? 'bg-emerald-50 border-emerald-400 text-emerald-950'
                  : 'bg-amber-50 border-amber-400 text-amber-950'
              }`}
            >
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="font-bold flex items-center gap-1.5 text-sm">
                  <Headphones className="h-4 w-4" />
                  <span>
                    {escalationInfo.status === 'OPEN'
                      ? formatText(va.escalationForwarded, { admin: escalationInfo.assigned_admin })
                      : formatText(va.escalationDetected, { admin: escalationInfo.assigned_admin })}
                  </span>
                </div>
                {escalationInfo.ticket_reference && (
                  <span
                    data-testid="escalation-ticket-badge"
                    className="px-2.5 py-1 rounded-lg bg-emerald-700 text-white font-mono font-bold text-xs"
                  >
                    {escalationInfo.ticket_reference}
                  </span>
                )}
              </div>
              <p className="text-xs">{escalationInfo.reason_out_of_scope}</p>
              {escalationInfo.status === 'PENDING_CONFIRMATION' && (
                <button
                  type="button"
                  data-testid="confirm-escalation-btn"
                  onClick={() => void sendSessionTurn({ transcript: 'Haan forward kar dein', autoReopenMic: false })}
                  className="px-3.5 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold"
                >
                  {formatText(va.confirmEscalationBtn, { admin: escalationInfo.assigned_admin })}
                </button>
              )}
            </div>
          )}

          {/* SUBMITTED RECEIPT CARD WITH CITIZEN SIMPLE "WHY THIS DECISION?" (Challenge 05) */}
          {formState.reference_number && (
            <div
              data-testid="submitted-receipt-card"
              className="p-4 rounded-2xl bg-emerald-50 border-2 border-emerald-400 text-emerald-950 space-y-2"
            >
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="font-bold text-sm flex items-center gap-1.5">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                  <span>{va.receiptTitle}</span>
                </span>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {formState.rule_version_used && (
                    <span
                      data-testid="receipt-rule-version-badge"
                      className="px-2.5 py-1 rounded-lg bg-indigo-700 text-white font-mono font-bold text-xs"
                    >
                      Rule {formState.rule_version_used}
                    </span>
                  )}
                  {formState.decision_tier && (
                    <span
                      data-testid="receipt-decision-tier-badge"
                      className="px-2.5 py-1 rounded-lg bg-teal-800 text-white font-bold text-xs"
                    >
                      {formState.decision_tier}
                    </span>
                  )}
                  <span
                    data-testid="submitted-reference-badge"
                    className="px-3 py-1 rounded-lg bg-emerald-700 text-white font-mono font-bold text-sm"
                  >
                    {formState.reference_number}
                  </span>
                </div>
              </div>
              <p className="text-xs text-emerald-900">
                {dict.citizen.currentStatus}: <strong>{formState.claim_status ? statusLabel(formState.claim_status) : ''}</strong>
              </p>
              {formState.citizen_simple_reason && (
                <div
                  data-testid="citizen-simple-reason"
                  className="p-2.5 rounded-xl bg-white/90 border border-emerald-200 text-xs text-slate-800 leading-relaxed"
                >
                  <strong className="text-emerald-950">
                    {detectedLang === 'en' ? 'Why This Decision?' : 'اس فیصلے کی وجہ:'}
                  </strong>{' '}
                  {formState.citizen_simple_reason}
                </div>
              )}
            </div>
          )}

          {/* SCAM SHIELD ALERT BANNER */}
          {scamAlert && (
            <div
              data-testid="scam-alert-banner"
              className="p-3.5 rounded-xl bg-rose-50 border-2 border-rose-300 text-rose-950 text-xs space-y-1"
            >
              <div className="font-bold flex items-center gap-1.5 text-sm">
                <ShieldAlert className="h-4 w-4 text-rose-700" />
                <span>{va.scamAlertTitle} {scamAlert.risk_level}</span>
              </div>
              <p>{scamAlert.safe_advice}</p>
            </div>
          )}

          {/* POLICY ANSWER BANNER */}
          {policyAnswer?.answer && (
            <div
              data-testid="policy-answer-banner"
              className="p-3.5 rounded-xl bg-indigo-50 border border-indigo-300 text-indigo-950 text-xs space-y-1"
            >
              <div className="font-bold">{va.policyAnswerTitle}</div>
              <p>{policyAnswer.answer}</p>
            </div>
          )}
        </div>
      </div>

      {/* Challenge 06: Citizen My Data & Consent Modal */}
      {isCitizenAccount && (
        <CitizenConsentModal
          open={consentModalOpen}
          onClose={() => setConsentModalOpen(false)}
          language={detectedLang}
        />
      )}

      {/* Challenge 08: Forged Document vs Honest False-Alarm Authenticity Modal */}
      <DocumentAuthenticityModal
        open={docModalOpen}
        onClose={() => setDocModalOpen(false)}
        language={detectedLang}
        onSendToVoiceAgent={(file) => void handleImageUpload(file, 'mock_identity_document')}
      />
    </section>
  );
}
