'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  APPLICATION_FIELD_SPECS,
  LANGUAGE_REGISTRY,
  type ApplicationFieldName,
  type AssistanceRequestRecord,
  type CaseRecord,
  type ConsentRecord,
  type DocumentRecord,
  type DocumentType,
  type MockPaymentRecord,
  type OfficerInquiryRecord,
} from '@awaaz/shared';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Edit3,
  FileCheck2,
  FileUp,
  Headphones,
  MessageCircleQuestion,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Volume2,
} from 'lucide-react';
import {
  CitizenOnboardingFlow,
  type OnboardingCompletePayload,
} from '@/components/citizen/CitizenOnboardingFlow';
import { useVoiceAgent } from '@/components/voice/GlobalVoiceSaathiProvider';
import { VoiceControls } from '@/components/voice/VoiceControls';
import { API_BASE_URL, ApiClientError, apiRequest } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/context';
import { formatText, useI18n } from '@/lib/i18n/context';
import { getRoleLandingRoute } from '@/lib/modules/registry';
import {
  clearUnauthorizedLocalCache,
  listLocalDrafts,
  saveLocalDraft,
  type OfflineCaseDraft,
} from '@/lib/offline/db';

const WIZARD_FIELDS: ApplicationFieldName[] = [
  'full_name',
  'mock_identity_reference',
  'district',
  'household_size',
  'monthly_income',
  'employment_status',
  'relief_reason',
];

interface CaseDetailPayload {
  case: CaseRecord;
  answers: Array<{
    field_name: ApplicationFieldName;
    field_value: string | number | boolean;
    source: 'voice' | 'text' | 'document' | 'officer' | 'system';
    confirmed_by_citizen: boolean;
  }>;
  documents: DocumentRecord[];
  reviews: Array<{ id: string; decision: string; citizen_message: string; created_at: string }>;
  mock_payments: MockPaymentRecord[];
  has_active_processing_consent: boolean;
}

export default function CitizenPortalPage() {
  const { user, token, activeOrganizationId, integrations } = useAuth();
  const { language, dict, statusLabel, roleLabel } = useI18n();

  // Simplified 4-step stage for low-literacy / normal users
  const [stage, setStage] = useState<1 | 2 | 3 | 4>(1);
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [activeCaseId, setActiveCaseId] = useState<string | null>(null);
  const [caseDetail, setCaseDetail] = useState<CaseDetailPayload | null>(null);
  const [consents, setConsents] = useState<ConsentRecord[]>([]);
  const [helpers, setHelpers] = useState<Array<{ user_id: string; display_name: string }>>([]);
  const [assistanceRequests, setAssistanceRequests] = useState<AssistanceRequestRecord[]>([]);
  const [officerInquiries, setOfficerInquiries] = useState<OfficerInquiryRecord[]>([]);
  const [officerQuestionInput, setOfficerQuestionInput] = useState('');
  const [currentDraft, setCurrentDraft] = useState<OfflineCaseDraft | null>(null);

  const [stepIdx, setStepIdx] = useState(0);
  const [inputValue, setInputValue] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [selectedHelperId, setSelectedHelperId] = useState('');
  const [showHelperBox, setShowHelperBox] = useState(false);

  const [ragQuestion, setRagQuestion] = useState('');
  const [ragAnswer, setRagAnswer] = useState<{
    answer: string;
    retrieval_mode: string;
    citations: Array<{ title: string; section: string; source_reference: string }>;
  } | null>(null);

  const [busy, setBusy] = useState(false);
  const [bannerMsg, setBannerMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Language-first onboarding & conversational submission states
  const [onboardingOutcome, setOnboardingOutcome] = useState<OnboardingCompletePayload | null>(null);
  const [issueStatement, setIssueStatement] = useState('');
  const [explicitSubmitConfirmed, setExplicitSubmitConfirmed] = useState(false);
  const [submittedReference, setSubmittedReference] = useState<string | null>(null);
  const [speechNotice, setSpeechNotice] = useState<string | null>(null);
  const { registerOnCaseSubmitted } = useVoiceAgent();

  const activeField = WIZARD_FIELDS[stepIdx] ?? 'full_name';
  const fieldSpec = APPLICATION_FIELD_SPECS[activeField];
  const questionCopy = (dict.questions as Record<string, { label: string; hint: string }>)[activeField] ?? {
    label: activeField,
    hint: '',
  };

  const hasActiveProcessingConsent = useMemo(
    () => consents.some((c) => c.consent_type === 'processing' && !c.withdrawn_at),
    [consents],
  );

  const loadCaseDetail = useCallback(
    async (caseId: string) => {
      if (!token || !activeOrganizationId) return;
      try {
        const detail = await apiRequest<CaseDetailPayload>(`/cases/${caseId}`, {
          token,
          organizationId: activeOrganizationId,
        });
        setCaseDetail(detail);
        setActiveCaseId(caseId);
        const ansMap: OfflineCaseDraft['answers'] = {};
        for (const a of detail.answers) {
          ansMap[a.field_name] = {
            field_name: a.field_name,
            field_value: a.field_value,
            source: a.source,
            confirmed_by_citizen: a.confirmed_by_citizen,
          };
        }
        const draft: OfflineCaseDraft = {
          localDraftId: `case-${caseId}`,
          organizationId: activeOrganizationId,
          userId: user?.id ?? '',
          serverCaseId: caseId,
          idempotencyKey: detail.case.idempotency_key,
          preferredLanguage: detail.case.preferred_language,
          currentStep: detail.case.current_step,
          answers: ansMap,
          updatedAt: detail.case.updated_at,
          serverUpdatedAt: detail.case.updated_at,
          syncStatus: 'synced',
          schemaVersion: 1,
          lastError: null,
        };
        setCurrentDraft(draft);
        await saveLocalDraft(draft);
      } catch (err) {
        setErrorMsg(err instanceof ApiClientError ? err.message : dict.auth.authFailed);
      }
    },
    [token, activeOrganizationId, user?.id, dict.auth.authFailed],
  );

  const refreshAll = useCallback(async () => {
    if (!user || !token || !activeOrganizationId || user.active_role !== 'citizen') return;
    const local = await listLocalDrafts(activeOrganizationId, user.id);
    if (!currentDraft && local[0]) {
      setCurrentDraft(local[0]);
    }

    try {
      const [casesRes, consentsRes, helpersRes, assistRes, inqRes] = await Promise.all([
        apiRequest<{ cases: CaseRecord[] }>('/cases', { token, organizationId: activeOrganizationId }),
        apiRequest<{ consents: ConsentRecord[] }>('/consent', { token, organizationId: activeOrganizationId }),
        apiRequest<{ helpers: Array<{ user_id: string; display_name: string }> }>('/consent/available-helpers', {
          token,
          organizationId: activeOrganizationId,
        }),
        apiRequest<{ requests: AssistanceRequestRecord[] }>('/assistance/requests', {
          token,
          organizationId: activeOrganizationId,
        }),
        apiRequest<{ inquiries: OfficerInquiryRecord[] }>('/officer-inquiries', {
          token,
          organizationId: activeOrganizationId,
        }),
      ]);
      setCases(casesRes.cases);
      setConsents(consentsRes.consents);
      setHelpers(helpersRes.helpers);
      setAssistanceRequests(assistRes.requests);
      setOfficerInquiries(inqRes.inquiries);
      if (helpersRes.helpers[0] && !selectedHelperId) {
        setSelectedHelperId(helpersRes.helpers[0].user_id);
      }
      if (!activeCaseId && casesRes.cases[0]) {
        await loadCaseDetail(casesRes.cases[0].id);
      }
    } catch {
      // Offline mode: local drafts remain accessible
    }
  }, [user, token, activeOrganizationId, selectedHelperId, activeCaseId, currentDraft, loadCaseDetail]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    const existing = currentDraft?.answers[activeField];
    setInputValue(existing ? String(existing.field_value) : '');
    setConfirmed(Boolean(existing?.confirmed_by_citizen));
  }, [activeField, currentDraft?.localDraftId, currentDraft?.answers]);

  useEffect(() => {
    registerOnCaseSubmitted(() => {
      void refreshAll();
      setStage(4);
    });
    return () => registerOnCaseSubmitted(null);
  }, [registerOnCaseSubmitted, refreshAll]);

  if (user && user.active_role !== 'citizen') {
    return (
      <div className="max-w-xl mx-auto rounded-2xl bg-white border border-rose-200 p-8 text-center space-y-4">
        <p className="text-slate-700">{dict.citizen.signInPrompt}</p>
        <Link
          href={getRoleLandingRoute(user.active_role)}
          className="inline-block px-5 py-2.5 rounded-xl bg-teal-700 text-white font-semibold"
        >
          {formatText(dict.home.openRoleWorkspace, { role: roleLabel(user.active_role) })}
        </Link>
      </div>
    );
  }

  const ensureDraftStarted = async (): Promise<OfflineCaseDraft | null> => {
    if (currentDraft) return currentDraft;
    if (!activeOrganizationId || !user) return null;

    const idemKey = `draft-${crypto.randomUUID()}`;
    const newDraft: OfflineCaseDraft = {
      localDraftId: idemKey,
      organizationId: activeOrganizationId,
      userId: user.id,
      serverCaseId: null,
      idempotencyKey: idemKey,
      preferredLanguage: language,
      currentStep: 'full_name',
      answers: {},
      updatedAt: new Date().toISOString(),
      serverUpdatedAt: null,
      syncStatus: 'local_only',
      schemaVersion: 1,
      lastError: null,
    };
    await saveLocalDraft(newDraft);
    setCurrentDraft(newDraft);

    if (navigator.onLine && token) {
      try {
        const res = await apiRequest<{ case: CaseRecord }>('/cases', {
          method: 'POST',
          token,
          organizationId: activeOrganizationId,
          body: {
            scheme_id: 'MOCK_RELIEF_01',
            preferred_language: language,
            idempotency_key: idemKey,
          },
        });
        const synced: OfflineCaseDraft = {
          ...newDraft,
          serverCaseId: res.case.id,
          serverUpdatedAt: res.case.updated_at,
          syncStatus: 'synced',
        };
        await saveLocalDraft(synced);
        setCurrentDraft(synced);
        setActiveCaseId(res.case.id);
        await loadCaseDetail(res.case.id);
        return synced;
      } catch {
        return newDraft;
      }
    }
    return newDraft;
  };

  const speakLocalizedText = async (text: string) => {
    setSpeechNotice(null);
    if (integrations?.voice.configured && token) {
      try {
        const res = await fetch(`${API_BASE_URL}/voice/speak`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            ...(activeOrganizationId ? { 'X-Organization-Id': activeOrganizationId } : {}),
          },
          body: JSON.stringify({ text, language }),
        });
        if (res.ok) {
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          await audio.play();
          return;
        }
      } catch {
        // Fall through to browser speech check
      }
    }

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const targetBcp47 = LANGUAGE_REGISTRY[language].provider_language_code.bcp47;
      const prefix = targetBcp47.split('-')[0]?.toLowerCase() ?? language;
      const voices = window.speechSynthesis.getVoices();
      const match = voices.find((v) => v.lang.toLowerCase().startsWith(prefix));
      if (voices.length > 0 && !match) {
        setSpeechNotice(dict.onboarding.voiceNoLangVoiceNotice);
        return;
      }
      window.speechSynthesis.cancel();
      const utt = new SpeechSynthesisUtterance(text);
      utt.lang = targetBcp47;
      if (match) utt.voice = match;
      window.speechSynthesis.speak(utt);
      setSpeechNotice(dict.voiceBrowserTtsNotice);
    } else {
      setSpeechNotice(dict.voiceTtsUnavailable);
    }
  };

  const handleGrantConsentAndStart = async () => {
    setBusy(true);
    setErrorMsg(null);
    setBannerMsg(null);
    try {
      if (!hasActiveProcessingConsent) {
        await apiRequest('/consent', {
          method: 'POST',
          token,
          organizationId: activeOrganizationId,
          body: {
            consent_type: 'processing',
            permissions: ['application_processing', 'ai_extraction', 'document_review'],
          },
        });
      }
      const draft = await ensureDraftStarted();
      if (draft) {
        const prefilledAnswers = { ...draft.answers };
        let changed = false;
        if (user?.display_name && !prefilledAnswers.full_name?.field_value) {
          prefilledAnswers.full_name = {
            field_name: 'full_name',
            field_value: user.display_name,
            source: 'text',
            confirmed_by_citizen: true,
          };
          changed = true;
        }
        if (issueStatement.trim()) {
          prefilledAnswers.relief_reason = {
            field_name: 'relief_reason',
            field_value: issueStatement.trim(),
            source: 'text',
            confirmed_by_citizen: true,
          };
          changed = true;
        }
        if (changed) {
          const updated: OfflineCaseDraft = {
            ...draft,
            preferredLanguage: language,
            answers: prefilledAnswers,
            syncStatus: 'pending_sync',
          };
          await saveLocalDraft(updated);
          setCurrentDraft(updated);
          await syncDraftToServer(updated);
          // Start conversational wizard on the first field not yet filled
          const nextUnfilled = WIZARD_FIELDS.findIndex((f) => !prefilledAnswers[f]?.field_value);
          if (nextUnfilled >= 0) setStepIdx(nextUnfilled);
        }
      }
      await refreshAll();
      setOnboardingOutcome(null);
      setStage(2);
      setBannerMsg(dict.citizen.consentRecordedMsg);
    } catch (err) {
      setErrorMsg(err instanceof ApiClientError ? err.message : dict.auth.authFailed);
    } finally {
      setBusy(false);
    }
  };

  const handleStartFreshForm = async () => {
    setCurrentDraft(null);
    setActiveCaseId(null);
    setCaseDetail(null);
    setStepIdx(0);
    setBusy(true);
    setErrorMsg(null);
    try {
      const idemKey = `draft-${crypto.randomUUID()}`;
      const res = await apiRequest<{ case: CaseRecord }>('/cases', {
        method: 'POST',
        token,
        organizationId: activeOrganizationId,
        body: { scheme_id: 'MOCK_RELIEF_01', preferred_language: language, idempotency_key: idemKey },
      });
      await loadCaseDetail(res.case.id);
      await refreshAll();
      setStage(2);
      setBannerMsg(dict.citizen.appStartedMsg);
    } catch (err) {
      setErrorMsg(err instanceof ApiClientError ? err.message : dict.citizen.savedOfflineMsg);
    } finally {
      setBusy(false);
    }
  };

  const persistCurrentAnswerLocally = async (overrideVal?: string, source: 'text' | 'voice' = 'text') => {
    const draft = currentDraft ?? (await ensureDraftStarted());
    if (!draft) return null;
    const raw = (overrideVal ?? inputValue).trim();
    if (!raw) return draft;

    const parsedValue = fieldSpec.expected_type === 'number' ? Number(raw.replace(/,/g, '')) : raw;
    if (fieldSpec.expected_type === 'number' && !Number.isFinite(parsedValue)) {
      setErrorMsg(dict.citizen.invalidNumberMsg);
      return null;
    }

    const updatedDraft: OfflineCaseDraft = {
      ...draft,
      preferredLanguage: language,
      currentStep: activeField,
      syncStatus: 'pending_sync',
      lastError: null,
      answers: {
        ...draft.answers,
        [activeField]: {
          field_name: activeField,
          field_value: parsedValue,
          source,
          confirmed_by_citizen: fieldSpec.needs_confirmation ? confirmed : true,
        },
      },
    };
    await saveLocalDraft(updatedDraft);
    setCurrentDraft(updatedDraft);
    return updatedDraft;
  };

  const syncDraftToServer = async (draftToSync?: OfflineCaseDraft | null) => {
    const target = draftToSync ?? currentDraft;
    if (!target || !token || !activeOrganizationId) return null;
    setBusy(true);
    setErrorMsg(null);
    try {
      let caseId = target.serverCaseId;
      let serverUpdatedAt = target.serverUpdatedAt;

      if (!caseId) {
        const created = await apiRequest<{ case: CaseRecord }>('/cases', {
          method: 'POST',
          token,
          organizationId: activeOrganizationId,
          body: {
            scheme_id: 'MOCK_RELIEF_01',
            preferred_language: target.preferredLanguage,
            idempotency_key: target.idempotencyKey,
          },
        });
        caseId = created.case.id;
        serverUpdatedAt = created.case.updated_at;
      }

      const answersArray = Object.values(target.answers);
      if (answersArray.length > 0) {
        const patched = await apiRequest<{ case: CaseRecord }>(`/cases/${caseId}/answers`, {
          method: 'PATCH',
          token,
          organizationId: activeOrganizationId,
          body: {
            expected_server_updated_at: serverUpdatedAt ?? undefined,
            current_step: target.currentStep,
            preferred_language: target.preferredLanguage,
            answers: answersArray,
          },
        });
        serverUpdatedAt = patched.case.updated_at;
      }

      const synced: OfflineCaseDraft = {
        ...target,
        serverCaseId: caseId,
        serverUpdatedAt,
        syncStatus: 'synced',
        lastError: null,
      };
      await saveLocalDraft(synced);
      setCurrentDraft(synced);
      setActiveCaseId(caseId);
      await loadCaseDetail(caseId);
      return caseId;
    } catch (err) {
      const isConflict = err instanceof ApiClientError && err.code === 'SYNC_CONFLICT';
      setErrorMsg(isConflict ? dict.citizen.syncConflictMsg : dict.citizen.savedOfflineMsg);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const handleVoiceTranscript = async (transcript: string) => {
    setInputValue(transcript);
    if (integrations?.ai.configured && currentDraft?.serverCaseId && token) {
      try {
        const res = await apiRequest<{ extraction: { value: string | number | boolean } }>(
          `/cases/${currentDraft.serverCaseId}/extract-field`,
          {
            method: 'POST',
            token,
            organizationId: activeOrganizationId,
            body: { active_field: activeField, language, transcript },
          },
        );
        setInputValue(String(res.extraction.value));
        setConfirmed(false);
      } catch {
        // Keep raw transcript
      }
    }
  };

  const handleQuickPaperUpload = async (docType: DocumentType, file: File | null) => {
    if (!file || !token) return;
    setBusy(true);
    setErrorMsg(null);
    setBannerMsg(null);
    try {
      const caseId = activeCaseId ?? (await syncDraftToServer(await ensureDraftStarted()));
      if (!caseId) return;
      const form = new FormData();
      form.append('case_id', caseId);
      form.append('document_type', docType);
      form.append('file', file);
      const uploaded = await apiRequest<{ document: DocumentRecord }>('/documents', {
        method: 'POST',
        formData: form,
        token,
        organizationId: activeOrganizationId,
      });
      await apiRequest(`/documents/${uploaded.document.id}/extract`, {
        method: 'POST',
        token,
        organizationId: activeOrganizationId,
      });
      await loadCaseDetail(caseId);
      setBannerMsg(dict.citizen.docUploadedMsg);
    } catch (err) {
      setErrorMsg(err instanceof ApiClientError ? err.message : dict.auth.authFailed);
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitApplication = async () => {
    if (!token) return;
    if (!explicitSubmitConfirmed) {
      setErrorMsg(dict.easyCitizen.confirmRequiredError);
      return;
    }
    setBusy(true);
    setErrorMsg(null);
    try {
      const saved = await persistCurrentAnswerLocally();
      const caseId = (await syncDraftToServer(saved)) ?? activeCaseId;
      if (!caseId) return;
      const res = await apiRequest<{ case: CaseRecord; reference_number?: string }>(`/cases/${caseId}/submit`, {
        method: 'POST',
        token,
        organizationId: activeOrganizationId,
        body: { explicit_confirmation: true },
      });
      const refNum = res.reference_number ?? `AWZ-${res.case.id.slice(0, 8).toUpperCase()}`;
      setSubmittedReference(refNum);
      setBannerMsg(formatText(dict.citizen.submittedMsg, { status: statusLabel(res.case.status) }));
      await loadCaseDetail(caseId);
      await refreshAll();
      setStage(4);
    } catch (err) {
      setErrorMsg(err instanceof ApiClientError ? err.message : dict.auth.authFailed);
    } finally {
      setBusy(false);
    }
  };

  const askChatbot = async (questionText: string) => {
    const q = questionText.trim();
    if (!q || !token) return;
    setRagQuestion(q);
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await apiRequest<{
        answer: string;
        retrieval_mode: string;
        citations: Array<{ title: string; section: string; source_reference: string }>;
      }>('/rag/query', {
        method: 'POST',
        token,
        organizationId: activeOrganizationId,
        body: { question: q, language, case_id: activeCaseId ?? undefined },
      });
      setRagAnswer(res);
    } catch (err) {
      setErrorMsg(err instanceof ApiClientError ? err.message : dict.auth.authFailed);
    } finally {
      setBusy(false);
    }
  };

  const handleEscalateToDepartment = async () => {
    const q = ragQuestion.trim();
    if (!q || !token) return;
    setBusy(true);
    setErrorMsg(null);
    setBannerMsg(null);
    try {
      await apiRequest('/assistance/requests', {
        method: 'POST',
        token,
        organizationId: activeOrganizationId,
        body: {
          citizen_question: q,
          chatbot_draft_answer: ragAnswer?.answer ?? null,
          language,
          case_id: activeCaseId ?? null,
        },
      });
      setBannerMsg(dict.easyCitizen.escalatedMsg);
      await refreshAll();
    } catch (err) {
      setErrorMsg(err instanceof ApiClientError ? err.message : dict.auth.authFailed);
    } finally {
      setBusy(false);
    }
  };

  const handleGrantHelperConsent = async () => {
    if (!selectedHelperId || !token) return;
    setBusy(true);
    try {
      await apiRequest('/consent', {
        method: 'POST',
        token,
        organizationId: activeOrganizationId,
        body: {
          consent_type: 'helper_delegation',
          helper_id: selectedHelperId,
          case_id: activeCaseId ?? null,
          permissions: ['view_case', 'edit_draft', 'upload_documents'],
        },
      });
      setBannerMsg(dict.citizen.helperGrantedMsg);
      await refreshAll();
    } catch (err) {
      setErrorMsg(err instanceof ApiClientError ? err.message : dict.auth.authFailed);
    } finally {
      setBusy(false);
    }
  };

  const handleWithdrawConsent = async (consentId: string) => {
    if (!token || !activeOrganizationId) return;
    setBusy(true);
    try {
      await apiRequest(`/consent/${consentId}/withdraw`, {
        method: 'POST',
        token,
        organizationId: activeOrganizationId,
      });
      await clearUnauthorizedLocalCache(activeOrganizationId);
      setBannerMsg(dict.citizen.consentWithdrawnMsg);
      await refreshAll();
    } catch (err) {
      setErrorMsg(err instanceof ApiClientError ? err.message : dict.auth.authFailed);
    } finally {
      setBusy(false);
    }
  };

  const hasIdDoc = Boolean(caseDetail?.documents.some((d) => d.document_type === 'mock_identity_document'));
  const hasIncomeDoc = Boolean(caseDetail?.documents.some((d) => d.document_type === 'mock_proof_of_income'));
  const handleSendOfficerInquiry = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = officerQuestionInput.trim();
    if (!q || !token) return;
    setBusy(true);
    setErrorMsg(null);
    setBannerMsg(null);
    try {
      const res = await apiRequest<{ inquiry: OfficerInquiryRecord }>('/officer-inquiries', {
        method: 'POST',
        token,
        organizationId: activeOrganizationId,
        body: {
          question_text: q,
          application_ref: cases[0] ? `AWZ-${cases[0].id.slice(0, 8).toUpperCase()}` : undefined,
          language,
        },
      });
      setOfficerQuestionInput('');
      setBannerMsg(formatText(dict.officerInquiry.inquirySentSuccess, { ref: res.inquiry.tracking_reference }));
      await refreshAll();
    } catch (err) {
      setErrorMsg(err instanceof ApiClientError ? err.message : dict.auth.authFailed);
    } finally {
      setBusy(false);
    }
  };

  const completedFields = WIZARD_FIELDS.filter((f) => Boolean(currentDraft?.answers[f]?.field_value)).length;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {!user ? (
        <CitizenOnboardingFlow
          onComplete={(payload) => {
            setOnboardingOutcome(payload);
            setStage(1);
            setExplicitSubmitConfirmed(false);
            setSubmittedReference(null);
          }}
        />
      ) : (
        <>
          {/* Warm, Simple Civic Blue Header */}
      <div className="rounded-2xl bg-gradient-to-r from-[#0F2D5C] via-[#1D4ED8] to-[#2563EB] text-white p-6 space-y-2 shadow-md">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold">{dict.easyCitizen.welcomeTitle}</h1>
            <p className="text-sky-100 text-sm sm:text-base font-semibold mt-1">{dict.easyCitizen.welcomeSubtitle}</p>
          </div>
          {cases.length > 0 && (
            <button
              type="button"
              onClick={() => void handleStartFreshForm()}
              className="px-4 py-2.5 rounded-xl bg-white text-teal-900 font-bold text-sm hover:bg-teal-50"
            >
              + {dict.easyCitizen.startNewBtn}
            </button>
          )}
        </div>
      </div>

      {/* Phase 4 Self-Service Cards: My Application Status + Direct Department Officer Q&A */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <section
          data-testid="citizen-app-status-panel"
          className="rounded-2xl bg-white border border-slate-200 p-5 space-y-3 shadow-xs"
        >
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <FileCheck2 className="h-5 w-5 text-teal-700" />
              <span>{dict.appStatus.panelTitle} ({cases.length})</span>
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">{dict.appStatus.panelSubtitle}</p>
          </div>
          {cases.length === 0 ? (
            <p className="text-xs text-slate-500">{dict.appStatus.noApplications}</p>
          ) : (
            <div className="space-y-2 max-h-56 overflow-y-auto">
              {cases.map((c) => {
                const ref = `AWZ-${c.id.slice(0, 8).toUpperCase()}`;
                return (
                  <div
                    key={c.id}
                    data-testid={`citizen-app-row-${ref}`}
                    className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-bold text-teal-900" dir="ltr">{ref}</span>
                      <span className="px-2 py-0.5 rounded-full bg-teal-100 text-teal-900 font-bold">
                        {statusLabel(c.status)}
                      </span>
                    </div>
                    <div className="text-slate-600">
                      {dict.appStatus.decisionBandLabel}: <strong>{c.analysis_result?.recommended_next_status ?? c.status}</strong>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section
          data-testid="citizen-officer-inquiry-panel"
          className="rounded-2xl bg-white border border-slate-200 p-5 space-y-3 shadow-xs"
        >
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <MessageCircleQuestion className="h-5 w-5 text-amber-600" />
              <span>{dict.officerInquiry.citizenPanelTitle}</span>
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">{dict.officerInquiry.citizenPanelSubtitle}</p>
          </div>
          <form onSubmit={(e) => void handleSendOfficerInquiry(e)} className="flex gap-2">
            <input
              data-testid="citizen-officer-question-input"
              type="text"
              value={officerQuestionInput}
              onChange={(e) => setOfficerQuestionInput(e.target.value)}
              placeholder={dict.officerInquiry.questionPlaceholder}
              className="flex-1 min-w-0 rounded-xl border border-slate-300 px-3 py-2 text-xs text-slate-900"
            />
            <button
              type="submit"
              data-testid="citizen-officer-question-submit"
              disabled={busy || !officerQuestionInput.trim()}
              className="shrink-0 px-3 py-2 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold disabled:opacity-50"
            >
              {dict.officerInquiry.sendQuestionBtn}
            </button>
          </form>
          {officerInquiries.length === 0 ? (
            <p className="text-xs text-slate-500">{dict.officerInquiry.noInquiries}</p>
          ) : (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {officerInquiries.map((inq) => (
                <div
                  key={inq.id}
                  data-testid={`citizen-inquiry-row-${inq.tracking_reference}`}
                  className="p-3 rounded-xl bg-amber-50/50 border border-amber-200 text-xs space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-bold text-amber-900" dir="ltr">{inq.tracking_reference}</span>
                    <span
                      className={`px-2 py-0.5 rounded-full font-bold ${
                        inq.status === 'ANSWERED' ? 'bg-emerald-100 text-emerald-900' : 'bg-amber-100 text-amber-900'
                      }`}
                    >
                      {inq.status}
                    </span>
                  </div>
                  <p className="text-slate-800">{inq.question_text}</p>
                  {inq.officer_reply ? (
                    <div className="p-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-950">
                      <strong>{dict.officerInquiry.officialReplyLabel}:</strong> {inq.officer_reply}
                    </div>
                  ) : (
                    <div className="text-slate-500 italic">{dict.officerInquiry.awaitingReply}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Big 4-Step Visual Navigation Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { num: 1 as const, label: dict.easyCitizen.step1Title, done: hasActiveProcessingConsent, icon: ShieldCheck },
          { num: 2 as const, label: dict.easyCitizen.step2Title, done: completedFields === WIZARD_FIELDS.length, icon: ClipboardList },
          { num: 3 as const, label: dict.easyCitizen.step3Title, done: hasIdDoc && hasIncomeDoc, icon: FileUp },
          { num: 4 as const, label: dict.easyCitizen.step4Title, done: Boolean(caseDetail?.case.submitted_at), icon: Headphones },
        ].map((item) => {
          const Icon = item.icon;
          const isCurrent = stage === item.num;
          return (
            <button
              key={item.num}
              type="button"
              onClick={() => setStage(item.num)}
              className={`p-4 rounded-2xl border-2 text-start transition flex flex-col gap-2 ${
                isCurrent
                  ? 'border-teal-700 bg-teal-50 text-teal-950 shadow-xs'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center justify-between">
                <Icon className={`h-6 w-6 ${isCurrent ? 'text-teal-700' : 'text-slate-500'}`} />
                {item.done && <CheckCircle2 className="h-5 w-5 text-emerald-600" />}
              </div>
              <span className="font-bold text-sm sm:text-base leading-snug">{item.label}</span>
            </button>
          );
        })}
      </div>

      {bannerMsg && (
        <div className="rounded-2xl bg-emerald-50 border-2 border-emerald-300 text-emerald-950 px-5 py-4 text-base font-medium">
          {bannerMsg}
        </div>
      )}
      {errorMsg && (
        <div className="rounded-2xl bg-rose-50 border-2 border-rose-300 text-rose-950 px-5 py-4 text-base flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 shrink-0 mt-1" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* STEP 1: Account Ready + Issue Prompt + Simple Permission (Consent) */}
      {stage === 1 && (
        <section className="rounded-2xl bg-white border border-slate-200 p-6 sm:p-8 space-y-5 shadow-xs">
          {onboardingOutcome && (
            <div className="rounded-2xl bg-emerald-50 border-2 border-emerald-300 p-5 space-y-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="space-y-1">
                  <h2 className="text-xl font-bold text-emerald-950">
                    {formatText(
                      onboardingOutcome.accountStatus === 'existing_signed_in'
                        ? dict.onboarding.existingSignedInTitle
                        : dict.onboarding.accountCreatedTitle,
                      { name: onboardingOutcome.displayName },
                    )}
                  </h2>
                  <p className="text-base text-emerald-900">{dict.onboarding.accountReadyAskIssue}</p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    void speakLocalizedText(
                      `${formatText(
                        onboardingOutcome.accountStatus === 'existing_signed_in'
                          ? dict.onboarding.existingSignedInTitle
                          : dict.onboarding.accountCreatedTitle,
                        { name: onboardingOutcome.displayName },
                      )} ${dict.onboarding.accountReadyAskIssue}`,
                    )
                  }
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-emerald-300 text-emerald-900 text-sm font-semibold hover:bg-emerald-100"
                >
                  <Volume2 className="h-4 w-4" />
                  <span>{dict.voiceReplayPrompt}</span>
                </button>
              </div>
              {speechNotice && (
                <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  {speechNotice}
                </p>
              )}
            </div>
          )}

          <div className="space-y-3">
            <h2 className="text-2xl font-bold text-slate-900">{dict.onboarding.issuePromptLabel}</h2>
            <p className="text-sm sm:text-base text-slate-600">{dict.onboarding.issuePromptHint}</p>
            <VoiceControls
              promptText={`${dict.onboarding.issuePromptLabel} ${dict.onboarding.issuePromptHint}`}
              language={language}
              onTranscript={(t) => setIssueStatement(t)}
            />
            <textarea
              rows={2}
              value={issueStatement}
              onChange={(e) => setIssueStatement(e.target.value)}
              placeholder={dict.onboarding.issuePromptHint}
              className="w-full rounded-2xl border-2 border-slate-300 px-4 py-3 text-lg focus:outline-none focus:border-teal-600"
            />
          </div>

          <div className="pt-2 border-t border-slate-200 space-y-3">
            <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <ShieldCheck className="h-6 w-6 text-teal-700" />
              {dict.consentHeading}
            </h3>
            <ul className="space-y-2 text-sm sm:text-base text-slate-800">
              <li className="p-3 rounded-xl bg-slate-50">• {dict.consentExplainCollect}</li>
              <li className="p-3 rounded-xl bg-slate-50">• {dict.consentExplainAccess}</li>
              <li className="p-3 rounded-xl bg-slate-50">• {dict.consentExplainWithdraw}</li>
            </ul>
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={() => void handleGrantConsentAndStart()}
            className="w-full py-4 px-6 rounded-2xl bg-emerald-700 text-white text-lg font-bold hover:bg-emerald-800 shadow-sm"
          >
            {onboardingOutcome
              ? dict.onboarding.startHelpRequestBtn
              : hasActiveProcessingConsent
                ? dict.easyCitizen.continueBtn
                : dict.easyCitizen.yesStartBtn}
          </button>

          <div className="text-center">
            <button
              type="button"
              onClick={() => setStage(4)}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-teal-800 hover:underline"
            >
              <Headphones className="h-4 w-4" />
              <span>{dict.easyCitizen.needHumanOption}</span>
            </button>
          </div>
        </section>
      )}

      {/* STEP 2: One Simple Question At A Time */}
      {stage === 2 && (
        <section className="rounded-2xl bg-white border border-slate-200 p-6 sm:p-8 space-y-6 shadow-xs">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-block px-3 py-1 rounded-full bg-teal-100 text-teal-900 font-bold text-sm">
                {formatText(dict.citizen.questionProgress, {
                  current: stepIdx + 1,
                  total: WIZARD_FIELDS.length,
                })}
              </span>
              <span className="text-sm font-semibold text-slate-500">
                {completedFields}/{WIZARD_FIELDS.length}
              </span>
            </div>
            {/* Big visual step dots */}
            <div className="flex gap-2 pt-1">
              {WIZARD_FIELDS.map((f, idx) => (
                <button
                  key={f}
                  type="button"
                  onClick={async () => {
                    await persistCurrentAnswerLocally();
                    setStepIdx(idx);
                  }}
                  className={`flex-1 h-3 rounded-full transition ${
                    idx === stepIdx
                      ? 'bg-teal-700'
                      : currentDraft?.answers[f]?.field_value
                        ? 'bg-emerald-500'
                        : 'bg-slate-200'
                  }`}
                  aria-label={`${idx + 1}`}
                />
              ))}
            </div>
          </div>

          <div>
            <h2 className="text-2xl font-bold text-slate-900">{questionCopy.label}</h2>
            <p className="text-base text-slate-600 mt-1">{questionCopy.hint}</p>
          </div>

          <VoiceControls
            promptText={questionCopy.label}
            language={language}
            onTranscript={(t) => void handleVoiceTranscript(t)}
          />

          <div className="space-y-2">
            <label className="block text-base font-bold text-slate-800">{dict.textFallbackLabel}</label>
            {activeField === 'relief_reason' ? (
              <textarea
                rows={3}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                className="w-full rounded-2xl border-2 border-slate-300 px-4 py-4 text-xl focus:outline-none focus:border-teal-600"
              />
            ) : (
              <input
                type={fieldSpec.expected_type === 'number' ? 'number' : 'text'}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                className="w-full rounded-2xl border-2 border-slate-300 px-4 py-4 text-xl focus:outline-none focus:border-teal-600"
              />
            )}
          </div>

          {fieldSpec.needs_confirmation && (
            <label className="flex items-center gap-4 p-4 rounded-2xl bg-emerald-50 border-2 border-emerald-300 cursor-pointer">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="h-6 w-6 rounded accent-emerald-700"
              />
              <span className="text-base font-bold text-emerald-950">{dict.easyCitizen.simpleConfirm}</span>
            </label>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <button
              type="button"
              disabled={stepIdx === 0}
              onClick={async () => {
                await persistCurrentAnswerLocally();
                setStepIdx((i) => Math.max(0, i - 1));
              }}
              className="px-6 py-3.5 rounded-2xl border-2 border-slate-300 font-bold text-base disabled:opacity-40"
            >
              {dict.wizardPrev}
            </button>

            {stepIdx < WIZARD_FIELDS.length - 1 ? (
              <button
                type="button"
                onClick={async () => {
                  const saved = await persistCurrentAnswerLocally();
                  if (saved) setStepIdx((i) => Math.min(WIZARD_FIELDS.length - 1, i + 1));
                }}
                className="px-8 py-3.5 rounded-2xl bg-teal-700 text-white font-bold text-base hover:bg-teal-800"
              >
                {dict.wizardNext}
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  const saved = await persistCurrentAnswerLocally();
                  if (saved) await syncDraftToServer(saved);
                  setStage(3);
                }}
                className="px-8 py-3.5 rounded-2xl bg-emerald-700 text-white font-bold text-base hover:bg-emerald-800"
              >
                {dict.easyCitizen.continueBtn}
              </button>
            )}
          </div>

          <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs sm:text-sm text-slate-600">
            <span>{dict.easyCitizen.draftSafeNotice}</span>
            <button
              type="button"
              onClick={async () => {
                await persistCurrentAnswerLocally();
                setStage(4);
              }}
              className="inline-flex items-center gap-1.5 font-semibold text-teal-800 hover:underline"
            >
              <Headphones className="h-4 w-4" />
              <span>{dict.easyCitizen.needHumanOption}</span>
            </button>
          </div>
        </section>
      )}

      {/* STEP 3: Supporting Papers + Concise Review Summary + Explicit Confirmation */}
      {stage === 3 && (
        <section className="rounded-2xl bg-white border border-slate-200 p-6 sm:p-8 space-y-6 shadow-xs">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">{dict.documentsTitle}</h2>
            <p className="text-base text-slate-600 mt-1">{dict.easyCitizen.papersHint}</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              { type: 'mock_identity_document' as DocumentType, title: dict.easyCitizen.paperIdTitle, uploaded: hasIdDoc },
              { type: 'mock_proof_of_income' as DocumentType, title: dict.easyCitizen.paperIncomeTitle, uploaded: hasIncomeDoc },
            ].map((card) => (
              <label
                key={card.type}
                className={`p-6 rounded-2xl border-2 border-dashed cursor-pointer flex flex-col items-center justify-center text-center gap-3 transition ${
                  card.uploaded
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-950'
                    : 'border-slate-300 bg-slate-50 hover:border-teal-600'
                }`}
              >
                {card.uploaded ? (
                  <FileCheck2 className="h-10 w-10 text-emerald-600" />
                ) : (
                  <FileUp className="h-10 w-10 text-teal-700" />
                )}
                <span className="text-lg font-bold">{card.title}</span>
                {card.uploaded && (
                  <span className="px-3 py-1 rounded-full bg-emerald-200 text-emerald-950 text-xs font-bold">
                    {dict.easyCitizen.paperUploaded}
                  </span>
                )}
                <input
                  type="file"
                  accept=".png,.jpg,.jpeg,.webp,.pdf,.txt,.json"
                  className="hidden"
                  onChange={(e) => void handleQuickPaperUpload(card.type, e.target.files?.[0] ?? null)}
                />
              </label>
            ))}
          </div>

          {/* Concise Localized Review Summary with Edit & Read-Aloud */}
          <div className="rounded-2xl bg-slate-50 border border-slate-200 p-5 space-y-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <h3 className="text-lg font-bold text-slate-900">{dict.easyCitizen.reviewTitle}</h3>
                <p className="text-sm text-slate-600">{dict.easyCitizen.reviewSubtitle}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  const summaryLines = WIZARD_FIELDS.map((f) => {
                    const q = (dict.questions as Record<string, { label: string }>)[f]?.label ?? f;
                    const val = currentDraft?.answers[f]?.field_value;
                    return `${q} ${val !== undefined && val !== '' ? String(val) : dict.easyCitizen.notProvided}`;
                  });
                  void speakLocalizedText(`${dict.easyCitizen.reviewTitle}. ${summaryLines.join('. ')}`);
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-800 hover:bg-slate-100"
              >
                <Volume2 className="h-4 w-4 text-teal-700" />
                <span>{dict.easyCitizen.readSummaryBtn}</span>
              </button>
            </div>

            {speechNotice && (
              <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                {speechNotice}
              </p>
            )}

            <dl className="divide-y divide-slate-200">
              {WIZARD_FIELDS.map((f, idx) => {
                const qLabel = (dict.questions as Record<string, { label: string }>)[f]?.label ?? f;
                const val = currentDraft?.answers[f]?.field_value;
                return (
                  <div key={f} className="py-2.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <dt className="text-xs font-medium text-slate-500">{qLabel}</dt>
                      <dd className="text-base font-bold text-slate-900 break-words">
                        {val !== undefined && val !== '' ? String(val) : dict.easyCitizen.notProvided}
                      </dd>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setStepIdx(idx);
                        setStage(2);
                      }}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-teal-800 hover:bg-teal-50 shrink-0"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                      <span>{dict.easyCitizen.editFieldBtn}</span>
                    </button>
                  </div>
                );
              })}
            </dl>
          </div>

          {/* Mandatory Explicit Confirmation Before Submission */}
          <label className="flex items-start gap-4 p-4 rounded-2xl bg-emerald-50 border-2 border-emerald-300 cursor-pointer">
            <input
              type="checkbox"
              checked={explicitSubmitConfirmed}
              onChange={(e) => {
                setExplicitSubmitConfirmed(e.target.checked);
                if (e.target.checked) setErrorMsg(null);
              }}
              className="h-6 w-6 mt-0.5 rounded accent-emerald-700 shrink-0"
            />
            <span className="text-base font-bold text-emerald-950">{dict.easyCitizen.explicitConfirmLabel}</span>
          </label>

          <button
            type="button"
            disabled={busy || !hasActiveProcessingConsent || !explicitSubmitConfirmed}
            onClick={() => void handleSubmitApplication()}
            className="w-full py-4 px-6 rounded-2xl bg-emerald-700 text-white text-xl font-bold hover:bg-emerald-800 disabled:opacity-50 shadow-sm"
          >
            {dict.wizardSubmit}
          </button>
        </section>
      )}

      {/* STEP 4: Simple Status + Chatbot + Real Human Department Help */}
      {stage === 4 && (
        <div className="space-y-6">
          {/* Status Card */}
          <section className="rounded-2xl bg-white border border-slate-200 p-6 space-y-4 shadow-xs">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-slate-900">{dict.citizen.statusCardTitle}</h2>
              <button
                type="button"
                onClick={() => void refreshAll()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-300 text-sm font-semibold"
              >
                <RefreshCw className="h-4 w-4" /> {dict.refresh}
              </button>
            </div>

            {caseDetail ? (
              <div className="space-y-4">
                {(() => {
                  const refNum =
                    submittedReference ?? `AWZ-${caseDetail.case.id.slice(0, 8).toUpperCase()}`;
                  const nextStepCopy =
                    caseDetail.case.status === 'NEEDS_MORE_INFO'
                      ? dict.easyCitizen.nextStepNeedsInfo
                      : caseDetail.case.status === 'NEEDS_HUMAN_REVIEW'
                        ? dict.easyCitizen.nextStepHumanReview
                        : dict.easyCitizen.nextStepReady;
                  return (
                    <div className="p-5 rounded-2xl bg-teal-50 border-2 border-teal-200 space-y-3">
                      {caseDetail.case.submitted_at && (
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <span className="inline-flex items-center gap-1.5 text-sm font-bold text-emerald-800">
                            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                            <span>{dict.easyCitizen.submittedBannerTitle}</span>
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              void speakLocalizedText(
                                `${dict.easyCitizen.submittedBannerTitle} ${dict.easyCitizen.referenceNumberLabel}: ${refNum}. ${dict.citizen.currentStatus}: ${statusLabel(caseDetail.case.status)}. ${nextStepCopy}`,
                              )
                            }
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-teal-300 text-teal-900 text-xs sm:text-sm font-semibold hover:bg-teal-100"
                          >
                            <Volume2 className="h-4 w-4" />
                            <span>{dict.easyCitizen.speakReceiptBtn}</span>
                          </button>
                        </div>
                      )}

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-center">
                        <div className="p-3 rounded-xl bg-white border border-teal-200">
                          <div className="text-xs text-slate-500">{dict.easyCitizen.referenceNumberLabel}</div>
                          <div className="text-xl font-bold text-slate-900 mt-1 tracking-wide" dir="ltr">
                            {refNum}
                          </div>
                        </div>
                        <div className="p-3 rounded-xl bg-white border border-teal-200">
                          <div className="text-xs text-slate-500">{dict.citizen.currentStatus}</div>
                          <div className="text-xl font-bold text-teal-950 mt-1">
                            {statusLabel(caseDetail.case.status)}
                          </div>
                        </div>
                      </div>

                      {caseDetail.case.submitted_at && (
                        <p className="text-sm sm:text-base text-teal-950 bg-white/80 rounded-xl p-3 border border-teal-100">
                          {nextStepCopy}
                        </p>
                      )}

                      {speechNotice && (
                        <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                          {speechNotice}
                        </p>
                      )}
                    </div>
                  );
                })()}
                {caseDetail.reviews.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-base font-bold text-slate-900">{dict.citizen.officerMessages}</h3>
                    {caseDetail.reviews.map((r) => (
                      <div key={r.id} className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-base">
                        <strong>{statusLabel(r.decision)}:</strong> {r.citizen_message}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-base text-slate-600">
                {formatText(dict.citizen.noAppsYet, { start: dict.easyCitizen.step1Title })}
              </p>
            )}
          </section>

          {/* Simple Chatbot + Humanized Department Assistance */}
          <section className="rounded-2xl bg-white border border-slate-200 p-6 space-y-4 shadow-xs">
            <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <MessageCircleQuestion className="h-6 w-6 text-teal-700" />
              {dict.easyCitizen.askHelpTitle}
            </h2>

            {/* One-tap quick question buttons for low-literacy users */}
            <div className="flex flex-wrap gap-2">
              {[dict.easyCitizen.quickQ1, dict.easyCitizen.quickQ2, dict.easyCitizen.quickQ3].map((q) => (
                <button
                  key={q}
                  type="button"
                  disabled={busy}
                  onClick={() => void askChatbot(q)}
                  className="px-4 py-2.5 rounded-xl bg-teal-50 border border-teal-200 text-teal-950 text-sm font-semibold hover:bg-teal-100"
                >
                  {q}
                </button>
              ))}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void askChatbot(ragQuestion);
              }}
              className="space-y-3"
            >
              <textarea
                rows={2}
                value={ragQuestion}
                onChange={(e) => setRagQuestion(e.target.value)}
                placeholder={dict.policyAskPlaceholder}
                className="w-full rounded-2xl border-2 border-slate-300 px-4 py-3 text-base"
              />
              <div className="flex flex-wrap gap-3">
                <button
                  type="submit"
                  disabled={busy || !ragQuestion.trim()}
                  className="flex-1 inline-flex items-center justify-center gap-2 py-3.5 px-5 rounded-2xl bg-teal-700 text-white text-base font-bold hover:bg-teal-800 disabled:opacity-50"
                >
                  <Sparkles className="h-5 w-5" />
                  {dict.policyAskBtn}
                </button>
                <button
                  type="button"
                  disabled={busy || !ragQuestion.trim()}
                  onClick={() => void handleEscalateToDepartment()}
                  className="flex-1 inline-flex items-center justify-center gap-2 py-3.5 px-5 rounded-2xl bg-amber-600 text-white text-base font-bold hover:bg-amber-700 disabled:opacity-50"
                >
                  <Headphones className="h-5 w-5" />
                  {dict.easyCitizen.escalateBtn}
                </button>
              </div>
            </form>

            {ragAnswer && (
              <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4 space-y-2 text-base">
                <p className="whitespace-pre-line text-slate-900">{ragAnswer.answer}</p>
              </div>
            )}

            {/* Humanized Replies from Department Staff */}
            {assistanceRequests.length > 0 && (
              <div className="pt-3 border-t border-slate-200 space-y-3">
                <h3 className="text-base font-bold text-slate-900">{dict.easyCitizen.humanRepliesTitle}</h3>
                {assistanceRequests.map((req) => (
                  <div key={req.id} className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2 text-sm">
                    <div className="font-bold text-slate-900">{req.citizen_question}</div>
                    {req.status === 'ANSWERED' && req.humanized_reply ? (
                      <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-950 text-base">
                        <div className="text-xs font-bold text-emerald-800 mb-1">
                          {dict.easyCitizen.departmentReplied}
                        </div>
                        {req.humanized_reply}
                      </div>
                    ) : (
                      <div className="text-amber-800 font-medium">{dict.easyCitizen.waitingHumanReply}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* Optional Collapsible Family / Community Helper Permission Box */}
      <section className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
        <button
          type="button"
          onClick={() => setShowHelperBox((v) => !v)}
          className="w-full px-5 py-4 flex items-center justify-between font-semibold text-sm text-slate-700 hover:bg-slate-50"
        >
          <span>{dict.easyCitizen.familyHelperToggle}</span>
          {showHelperBox ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        {showHelperBox && (
          <div className="px-5 pb-5 space-y-3 border-t border-slate-100 pt-4">
            {helpers.length > 0 && (
              <div className="flex flex-wrap gap-2">
                <select
                  value={selectedHelperId}
                  onChange={(e) => setSelectedHelperId(e.target.value)}
                  className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm"
                >
                  {helpers.map((h) => (
                    <option key={h.user_id} value={h.user_id}>
                      {h.display_name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void handleGrantHelperConsent()}
                  className="px-4 py-2 rounded-xl bg-teal-700 text-white text-sm font-semibold"
                >
                  {dict.citizen.authorizeHelperBtn}
                </button>
              </div>
            )}
            <div className="space-y-2">
              {consents.map((c) => (
                <div key={c.id} className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs flex items-center justify-between gap-2">
                  <div>
                    <div className="font-semibold">{c.consent_type}</div>
                    <div className="text-slate-500">
                      {c.withdrawn_at ? `${dict.withdrawn} ${new Date(c.withdrawn_at).toLocaleDateString()}` : dict.active}
                    </div>
                  </div>
                  {!c.withdrawn_at && (
                    <button
                      type="button"
                      onClick={() => void handleWithdrawConsent(c.id)}
                      className="px-3 py-1.5 rounded-lg bg-rose-100 text-rose-800 font-semibold hover:bg-rose-200"
                    >
                      {dict.citizen.withdrawBtn}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
        </>
      )}
    </div>
  );
}
