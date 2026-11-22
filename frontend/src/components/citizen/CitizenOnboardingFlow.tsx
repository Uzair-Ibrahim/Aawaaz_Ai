'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { LANGUAGE_LIST, type AuthSessionUser, type LanguageCode } from '@awaaz/shared';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Globe,
  Headphones,
  KeyRound,
  Phone,
  ShieldCheck,
  Sparkles,
  User,
} from 'lucide-react';
import { VoiceControls } from '@/components/voice/VoiceControls';
import { ApiClientError, apiRequest } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/context';
import { formatText, useI18n } from '@/lib/i18n/context';

export interface OnboardingCompletePayload {
  accountStatus: 'created' | 'existing_signed_in' | 'linked';
  displayName: string;
}

interface CitizenOnboardingFlowProps {
  onComplete: (payload: OnboardingCompletePayload) => void;
}

type OnboardingStep = 'language' | 'name' | 'phone' | 'otp';

const DRAFT_STORAGE_KEY = 'awaaz_citizen_onboarding_draft';

interface SavedOnboardingDraft {
  step: OnboardingStep;
  displayName: string;
  phoneNumber: string;
  challengeId: string | null;
  maskedPhone: string | null;
  devOtpPreview: string | null;
}

const SCRIPT_FONT_CLASS: Record<LanguageCode, string> = {
  en: 'font-sans',
  ur: 'script-nastaliq',
  pa: 'script-nastaliq',
  sd: 'script-naskh',
  ps: 'script-naskh',
  bal: 'script-naskh',
};

export function CitizenOnboardingFlow({ onComplete }: CitizenOnboardingFlowProps) {
  const { setAuthenticatedSession } = useAuth();
  const { language, direction, setLanguage, dict } = useI18n();

  const [step, setStep] = useState<OnboardingStep>('language');
  const [displayName, setDisplayName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [maskedPhone, setMaskedPhone] = useState<string | null>(null);
  const [devOtpPreview, setDevOtpPreview] = useState<string | null>(null);
  const [showHumanHint, setShowHumanHint] = useState(false);

  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Restore any interrupted onboarding progress safely (never stores OTP input)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.sessionStorage.getItem(DRAFT_STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as Partial<SavedOnboardingDraft>;
      if (saved.displayName) setDisplayName(saved.displayName);
      if (saved.phoneNumber) setPhoneNumber(saved.phoneNumber);
      if (saved.challengeId) setChallengeId(saved.challengeId);
      if (saved.maskedPhone) setMaskedPhone(saved.maskedPhone);
      if (saved.devOtpPreview) setDevOtpPreview(saved.devOtpPreview);
      if (saved.step && ['language', 'name', 'phone', 'otp'].includes(saved.step)) {
        setStep(saved.step);
      }
    } catch {
      // Ignore corrupt session draft
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const payload: SavedOnboardingDraft = {
      step,
      displayName,
      phoneNumber,
      challengeId,
      maskedPhone,
      devOtpPreview,
    };
    window.sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(payload));
  }, [step, displayName, phoneNumber, challengeId, maskedPhone, devOtpPreview]);

  const handleSelectLanguage = (code: LanguageCode) => {
    setLanguage(code);
    setErrorMsg(null);
    // Resume the farthest step if user only came back to switch language
    if (challengeId) {
      setStep('otp');
    } else if (phoneNumber.trim()) {
      setStep('phone');
    } else {
      setStep('name');
    }
  };

  const handleNameNext = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (displayName.trim().length < 2) {
      setErrorMsg(dict.onboarding.invalidNameError);
      return;
    }
    setStep('phone');
  };

  const handleRequestOtp = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setErrorMsg(null);
    const trimmedPhone = phoneNumber.trim();
    if (trimmedPhone.length < 7) {
      setErrorMsg(dict.onboarding.invalidPhoneError);
      return;
    }
    setBusy(true);
    try {
      const res = await apiRequest<{
        challenge_id: string;
        masked_phone: string;
        expires_in_seconds: number;
        delivery_mode: 'sms' | 'dev_local_preview';
        dev_otp_preview?: string;
      }>('/auth/phone/request-otp', {
        method: 'POST',
        body: {
          phone_number: trimmedPhone,
          preferred_language: language,
        },
      });
      setChallengeId(res.challenge_id);
      setMaskedPhone(res.masked_phone);
      setDevOtpPreview(res.dev_otp_preview ?? null);
      setOtpCode('');
      setStep('otp');
    } catch (err) {
      setErrorMsg(err instanceof ApiClientError ? err.message : dict.onboarding.invalidPhoneError);
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!challengeId || otpCode.trim().length < 6) {
      setErrorMsg(dict.onboarding.invalidOtpError);
      return;
    }
    setBusy(true);
    try {
      const res = await apiRequest<{
        access_token: string;
        user: AuthSessionUser;
        account_status: 'created' | 'existing_signed_in' | 'linked';
      }>('/auth/phone/verify-otp', {
        method: 'POST',
        body: {
          challenge_id: challengeId,
          phone_number: phoneNumber.trim(),
          otp_code: otpCode.trim(),
          display_name: displayName.trim().length >= 2 ? displayName.trim() : undefined,
          preferred_language: language,
        },
      });

      if (typeof window !== 'undefined') {
        window.sessionStorage.removeItem(DRAFT_STORAGE_KEY);
      }
      setAuthenticatedSession(res.access_token, res.user);
      onComplete({
        accountStatus: res.account_status,
        displayName: res.user.display_name,
      });
    } catch (err) {
      setErrorMsg(err instanceof ApiClientError ? err.message : dict.onboarding.invalidOtpError);
    } finally {
      setBusy(false);
    }
  };

  // STEP 0: Language-First Selector (always shown before onboarding starts)
  if (step === 'language') {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="rounded-2xl bg-teal-800 text-white p-6 sm:p-8 text-center space-y-3 shadow-xs">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15 mx-auto">
            <Globe className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold">{dict.onboarding.chooseLanguageTitle}</h1>
          <p className="text-teal-50 text-base">{dict.onboarding.chooseLanguageSubtitle}</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {LANGUAGE_LIST.map((entry) => {
            const isSelected = entry.language_code === language;
            return (
              <button
                key={entry.language_code}
                type="button"
                lang={entry.language_code}
                dir={entry.text_direction}
                onClick={() => handleSelectLanguage(entry.language_code)}
                className={`p-6 rounded-2xl border-2 text-start transition shadow-xs flex flex-col gap-1.5 ${
                  SCRIPT_FONT_CLASS[entry.language_code]
                } ${
                  isSelected
                    ? 'border-teal-700 bg-teal-50 text-teal-950'
                    : 'border-slate-200 bg-white text-slate-900 hover:border-teal-500 hover:bg-teal-50/40'
                }`}
              >
                <span className="text-2xl font-bold leading-relaxed">{entry.native_name}</span>
                <span className="text-xs text-slate-500" dir="ltr">
                  {entry.display_name} ({entry.text_direction.toUpperCase()})
                </span>
              </button>
            );
          })}
        </div>

        <div className="text-center pt-2">
          <Link href="/login" className="text-sm font-semibold text-teal-800 hover:underline">
            {dict.onboarding.haveEmailAccount}
          </Link>
        </div>
      </div>
    );
  }

  const BackIcon = direction === 'rtl' ? ArrowRight : ArrowLeft;
  const NextIcon = direction === 'rtl' ? ArrowLeft : ArrowRight;

  const activePromptText =
    step === 'name'
      ? `${dict.onboarding.greetingBanner} ${dict.onboarding.askNameTitle} ${dict.onboarding.askNameWhy}`
      : step === 'phone'
        ? `${dict.onboarding.askPhoneTitle} ${dict.onboarding.askPhoneWhy}`
        : `${dict.onboarding.askOtpTitle} ${formatText(dict.onboarding.askOtpSubtitle, { phone: maskedPhone ?? phoneNumber })}`;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Assistant Header */}
      <div className="rounded-2xl bg-teal-800 text-white p-6 space-y-3 shadow-xs">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2.5">
            <Sparkles className="h-6 w-6 text-amber-300 shrink-0" />
            <h1 className="text-xl sm:text-2xl font-bold">{dict.onboarding.assistantTitle}</h1>
          </div>
          <button
            type="button"
            onClick={() => setStep('language')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/15 hover:bg-white/25 text-white text-xs sm:text-sm font-semibold"
          >
            <Globe className="h-4 w-4" />
            <span>{dict.onboarding.changeLanguageBtn}</span>
          </button>
        </div>
        <p className="text-teal-50 text-base leading-relaxed">{dict.onboarding.greetingBanner}</p>
      </div>

      {/* Error Alert */}
      {errorMsg && (
        <div className="rounded-2xl bg-rose-50 border-2 border-rose-300 text-rose-950 px-5 py-4 text-base flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 shrink-0 mt-1" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Conversational Step Card */}
      <section className="rounded-2xl bg-white border border-slate-200 p-6 sm:p-8 space-y-6 shadow-xs">
        {/* Progress Indicator */}
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-teal-100 text-teal-900 font-bold text-sm">
            {step === 'name' && <User className="h-4 w-4" />}
            {step === 'phone' && <Phone className="h-4 w-4" />}
            {step === 'otp' && <KeyRound className="h-4 w-4" />}
            <span>
              {step === 'name'
                ? dict.onboarding.stepNameProgress
                : step === 'phone'
                  ? dict.onboarding.stepPhoneProgress
                  : dict.onboarding.stepOtpProgress}
            </span>
          </span>
          <div className="flex gap-1.5">
            {(['name', 'phone', 'otp'] as const).map((s) => (
              <span
                key={s}
                className={`h-2.5 w-8 rounded-full ${
                  step === s
                    ? 'bg-teal-700'
                    : (s === 'name' && step !== 'name') || (s === 'phone' && step === 'otp')
                      ? 'bg-emerald-500'
                      : 'bg-slate-200'
                }`}
              />
            ))}
          </div>
        </div>

        {/* Step 1: Ask Name */}
        {step === 'name' && (
          <form onSubmit={handleNameNext} className="space-y-5">
            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-slate-900">{dict.onboarding.askNameTitle}</h2>
              <p className="text-sm sm:text-base text-slate-700 bg-slate-50 border border-slate-200 rounded-xl p-3.5">
                {dict.onboarding.askNameWhy}
              </p>
            </div>

            <VoiceControls
              promptText={activePromptText}
              language={language}
              onTranscript={(t) => setDisplayName(t.trim())}
            />

            <div className="space-y-2">
              <label className="block text-base font-bold text-slate-800">{dict.textFallbackLabel}</label>
              <input
                type="text"
                required
                minLength={2}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={dict.onboarding.askNamePlaceholder}
                className="w-full rounded-2xl border-2 border-slate-300 px-4 py-4 text-xl focus:outline-none focus:border-teal-600"
              />
            </div>

            <div className="flex items-center justify-between gap-3 pt-2">
              <button
                type="button"
                onClick={() => setStep('language')}
                className="inline-flex items-center gap-2 px-5 py-3.5 rounded-2xl border-2 border-slate-300 font-bold text-base hover:bg-slate-50"
              >
                <BackIcon className="h-4 w-4" />
                <span>{dict.onboarding.backBtn}</span>
              </button>
              <button
                type="submit"
                className="inline-flex items-center gap-2 px-7 py-3.5 rounded-2xl bg-teal-700 text-white font-bold text-base hover:bg-teal-800"
              >
                <span>{dict.onboarding.continueBtn}</span>
                <NextIcon className="h-4 w-4" />
              </button>
            </div>
          </form>
        )}

        {/* Step 2: Ask Phone Number */}
        {step === 'phone' && (
          <form onSubmit={(e) => void handleRequestOtp(e)} className="space-y-5">
            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-slate-900">{dict.onboarding.askPhoneTitle}</h2>
              <p className="text-sm sm:text-base text-slate-700 bg-slate-50 border border-slate-200 rounded-xl p-3.5">
                {dict.onboarding.askPhoneWhy}
              </p>
            </div>

            <VoiceControls
              promptText={activePromptText}
              language={language}
              onTranscript={(t) => setPhoneNumber(t.replace(/\s+/g, ''))}
            />

            <div className="space-y-2">
              <label className="block text-base font-bold text-slate-800">{dict.textFallbackLabel}</label>
              <input
                type="tel"
                dir="ltr"
                required
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder={dict.onboarding.askPhonePlaceholder}
                className="w-full rounded-2xl border-2 border-slate-300 px-4 py-4 text-xl focus:outline-none focus:border-teal-600"
              />
            </div>

            <div className="flex items-center justify-between gap-3 pt-2">
              <button
                type="button"
                onClick={() => setStep('name')}
                className="inline-flex items-center gap-2 px-5 py-3.5 rounded-2xl border-2 border-slate-300 font-bold text-base hover:bg-slate-50"
              >
                <BackIcon className="h-4 w-4" />
                <span>{dict.onboarding.backBtn}</span>
              </button>
              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center gap-2 px-7 py-3.5 rounded-2xl bg-teal-700 text-white font-bold text-base hover:bg-teal-800 disabled:opacity-50"
              >
                <ShieldCheck className="h-5 w-5" />
                <span>{busy ? dict.loading : dict.onboarding.sendCodeBtn}</span>
              </button>
            </div>
          </form>
        )}

        {/* Step 3: Verify OTP Ownership */}
        {step === 'otp' && (
          <form onSubmit={(e) => void handleVerifyOtp(e)} className="space-y-5">
            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-slate-900">{dict.onboarding.askOtpTitle}</h2>
              <p className="text-base text-slate-700">
                {formatText(dict.onboarding.askOtpSubtitle, { phone: maskedPhone ?? phoneNumber })}
              </p>
            </div>

            {devOtpPreview && (
              <div className="rounded-xl bg-amber-50 border-2 border-amber-300 text-amber-950 p-4 text-sm font-medium">
                {formatText(dict.onboarding.devOtpBanner, { code: devOtpPreview })}
              </div>
            )}

            <VoiceControls
              promptText={activePromptText}
              language={language}
              onTranscript={(t) => setOtpCode(t.replace(/\D/g, '').slice(0, 6))}
            />

            <div className="space-y-2">
              <label className="block text-base font-bold text-slate-800">{dict.textFallbackLabel}</label>
              <input
                type="text"
                inputMode="numeric"
                dir="ltr"
                required
                minLength={6}
                maxLength={6}
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value)}
                placeholder={dict.onboarding.askOtpPlaceholder}
                className="w-full rounded-2xl border-2 border-slate-300 px-4 py-4 text-2xl tracking-widest text-center focus:outline-none focus:border-teal-600"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setStep('phone')}
                  className="inline-flex items-center gap-2 px-4 py-3 rounded-2xl border-2 border-slate-300 font-bold text-sm hover:bg-slate-50"
                >
                  <BackIcon className="h-4 w-4" />
                  <span>{dict.onboarding.backBtn}</span>
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleRequestOtp()}
                  className="px-4 py-3 rounded-2xl border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {dict.onboarding.resendCodeBtn}
                </button>
              </div>
              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center gap-2 px-7 py-3.5 rounded-2xl bg-emerald-700 text-white font-bold text-base hover:bg-emerald-800 disabled:opacity-50"
              >
                <ShieldCheck className="h-5 w-5" />
                <span>{busy ? dict.loading : dict.onboarding.verifyCodeBtn}</span>
              </button>
            </div>
          </form>
        )}

        {/* Human / Helper alternative & Email Sign-In */}
        <div className="pt-4 border-t border-slate-200 flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <button
              type="button"
              onClick={() => setShowHumanHint((v) => !v)}
              className="inline-flex items-center gap-1.5 text-teal-800 font-semibold hover:underline"
            >
              <Headphones className="h-4 w-4" />
              <span>{dict.onboarding.needHumanHelpBtn}</span>
            </button>
            <Link href="/login" className="text-slate-600 hover:underline font-medium">
              {dict.onboarding.haveEmailAccount}
            </Link>
          </div>
          {showHumanHint && (
            <p className="text-xs sm:text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl p-3">
              {dict.onboarding.humanHelpHint}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
