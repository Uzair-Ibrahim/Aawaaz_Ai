'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Camera, CheckCircle2, ShieldCheck, Sparkles } from 'lucide-react';
import { DocumentAuthenticityModal } from '@/components/citizen/CitizenRubricDrawers';
import { AwaazLogo } from '@/components/shared/AwaazLogo';
import { useVoiceAgent } from '@/components/voice/GlobalVoiceSaathiProvider';
import { useI18n } from '@/lib/i18n/context';

export default function SignupPage() {
  const { language, dict } = useI18n();
  const { authDraft, editingField, currentlyAskedField, validationErrors, sendSessionTurn } = useVoiceAgent();

  const [fullName, setFullName] = useState(authDraft.full_name);
  const [cnic, setCnic] = useState(authDraft.cnic);
  const [phone, setPhone] = useState(authDraft.phone);
  const [pin, setPin] = useState('');
  const [scanModalOpen, setScanModalOpen] = useState(false);
  const [scannedInfo, setScannedInfo] = useState<{ full_name?: string; cnic?: string } | null>(null);

  // Live auto-fill mirror from Voice Saathi!
  useEffect(() => {
    if (authDraft.full_name) setFullName(authDraft.full_name);
    if (authDraft.cnic) setCnic(authDraft.cnic);
    if (authDraft.phone) setPhone(authDraft.phone);
  }, [authDraft.full_name, authDraft.cnic, authDraft.phone]);

  // Auto-scroll highlighted editing field into view on voice rollback / correction
  useEffect(() => {
    if (!editingField) return;
    const el = document.querySelector(`[data-testid="auth-field-${editingField}"]`);
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [editingField]);

  const errorForField = (field: string) => validationErrors.find((e) => e.field === field);

  const fields = [
    {
      key: 'full_name' as const,
      label: dict.voiceAgent.authFieldName,
      val: authDraft.full_name,
      inputVal: fullName,
      setVal: setFullName,
      placeholder: dict.auth.displayNamePlaceholder,
      dir: undefined,
    },
    {
      key: 'cnic' as const,
      label: dict.voiceAgent.authFieldCnic,
      val: authDraft.cnic,
      inputVal: cnic,
      setVal: setCnic,
      placeholder: '42101-7654321-2',
      dir: 'ltr' as const,
    },
    {
      key: 'phone' as const,
      label: dict.voiceAgent.authFieldPhone,
      val: authDraft.phone,
      inputVal: phone,
      setVal: setPhone,
      placeholder: '03009876543',
      dir: 'ltr' as const,
    },
    {
      key: 'pin' as const,
      label: dict.voiceAgent.authFieldPin,
      val: authDraft.pin,
      inputVal: pin,
      setVal: setPin,
      placeholder: '4567',
      dir: 'ltr' as const,
    },
  ];

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parts: string[] = [];
    if (fullName.trim()) parts.push(`Mera naam ${fullName.trim()} hai`);
    if (cnic.trim()) parts.push(`CNIC ${cnic.trim()}`);
    if (phone.trim()) parts.push(`phone ${phone.trim()}`);
    if (pin.trim()) parts.push(`PIN ${pin.trim()}`);
    if (parts.length > 0) {
      await sendSessionTurn({ transcript: parts.join(', '), stageHint: 'AUTH_GATE', autoReopenMic: false });
    }
  };

  return (
    <div data-testid="signup-page" className="w-full space-y-4">
      <div className="rounded-2xl bg-white border-2 border-blue-200/80 p-5 sm:p-6 shadow-sm space-y-5">
        <div className="flex flex-col items-center text-center gap-2 pb-3 border-b border-blue-100">
          <AwaazLogo size="lg" showWordmark title={dict.appTitle} subtitle={dict.appTagline} />
        </div>
        <div className="space-y-1.5 border-b border-blue-100 pb-4">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 border border-blue-300 text-blue-950 text-xs font-extrabold">
            <Sparkles className="h-3.5 w-3.5 text-blue-700" />
            <span>{dict.auth.voiceAutoFillingBadge}</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-950 flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-blue-700" />
            <span>{dict.auth.signupTitle}</span>
          </h1>
          <p className="text-sm font-bold text-slate-700">{dict.auth.signupSubtitle}</p>
        </div>

        <form onSubmit={(e) => void handleManualSubmit(e)} className="space-y-3.5">
          {/* Scan CNIC / Bill right on Signup to auto-extract Full Name & CNIC Number */}
          <div className="space-y-2">
            <button
              type="button"
              data-testid="signup-scan-cnic-btn"
              onClick={() => setScanModalOpen(true)}
              className="w-full py-2.5 px-4 rounded-xl bg-blue-50 hover:bg-blue-100 border-2 border-blue-400 text-blue-950 font-extrabold text-sm flex items-center justify-center gap-2 transition cursor-pointer"
            >
              <Camera className="h-4 w-4 text-blue-700" />
              <span>{dict.voiceAgent.scanCnicBill} — {language === 'en' ? 'Auto-Fill Name & CNIC' : 'نام اور شناختی کارڈ خودکار بھریں'}</span>
            </button>
            {scannedInfo && (scannedInfo.full_name || scannedInfo.cnic) && (
              <div
                data-testid="signup-extracted-banner"
                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-950 text-xs font-bold"
              >
                <CheckCircle2 className="h-4 w-4 text-emerald-700 shrink-0" />
                <span>
                  {language === 'en' ? 'Extracted:' : 'حاصل شدہ:'}{' '}
                  {scannedInfo.full_name ? `${scannedInfo.full_name}` : ''}
                  {scannedInfo.full_name && scannedInfo.cnic ? ' • ' : ''}
                  {scannedInfo.cnic ? <span dir="ltr" className="font-mono">{scannedInfo.cnic}</span> : ''}
                </span>
              </div>
            )}
          </div>

          {fields.map((f) => {
            const err = errorForField(f.key);
            const filled = Boolean(f.val);
            const isEditing = editingField === f.key;
            const isActiveTarget = !filled && currentlyAskedField === f.key;
            return (
              <div
                key={f.key}
                data-testid={`auth-field-${f.key}`}
                data-filled={filled ? 'true' : 'false'}
                data-invalid={err ? 'true' : 'false'}
                data-editing={isEditing ? 'true' : 'false'}
                data-active-slot={isActiveTarget ? 'true' : 'false'}
                className={`p-3.5 rounded-xl border-2 transition ${
                  err
                    ? 'border-rose-500 bg-rose-50'
                    : isEditing
                      ? 'border-amber-500 bg-amber-50 ring-2 ring-amber-300/60'
                      : filled
                        ? 'border-emerald-500 bg-emerald-50/50'
                        : isActiveTarget
                          ? 'border-blue-600 bg-blue-50/75 ring-2 ring-blue-300/60'
                          : 'border-slate-200 bg-slate-50/70'
                }`}
              >
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <label className="font-extrabold text-slate-900">{f.label}</label>
                  {err ? (
                    <span className="text-rose-700 font-bold">✕ {dict.voiceAgent.statusInvalid}</span>
                  ) : isEditing ? (
                    <span className="px-2 py-0.5 rounded-full bg-amber-200 text-amber-950 font-bold">
                      ✎ {dict.voiceAgent.statusEditing}
                    </span>
                  ) : filled ? (
                    <span className="text-emerald-700 font-bold inline-flex items-center gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5" /> {dict.voiceAgent.statusValidated}
                    </span>
                  ) : isActiveTarget ? (
                    <span className="px-2 py-0.5 rounded-full bg-blue-700 text-white font-extrabold">
                      ● {language === 'en' ? 'Asking Now' : 'ابھی درکار'}
                    </span>
                  ) : (
                    <span className="text-slate-500 font-bold">{dict.voiceAgent.statusPending}</span>
                  )}
                </div>
                <input
                  data-testid={`signup-input-${f.key}`}
                  type={f.key === 'pin' ? 'password' : 'text'}
                  dir={f.dir}
                  value={f.inputVal}
                  onChange={(e) => f.setVal(e.target.value)}
                  placeholder={f.placeholder}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                {err && <p className="text-xs text-rose-700 font-semibold mt-1">{err.message}</p>}
              </div>
            );
          })}

          <button
            type="submit"
            data-testid="signup-submit-btn"
            className="w-full py-3 rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-extrabold text-base shadow-sm transition cursor-pointer"
          >
            {dict.auth.createAccountTab}
          </button>
        </form>

        <div className="text-center pt-2 border-t border-blue-100">
          <Link href="/login" className="text-sm font-extrabold text-blue-700 hover:underline">
            {dict.auth.alreadyHaveAccount}
          </Link>
        </div>
      </div>

      <DocumentAuthenticityModal
        open={scanModalOpen}
        onClose={() => setScanModalOpen(false)}
        language={language}
        onFieldsExtracted={(fields) => {
          setScannedInfo({ full_name: fields.full_name, cnic: fields.cnic });
          if (fields.full_name) setFullName(fields.full_name);
          if (fields.cnic) setCnic(fields.cnic);
        }}
      />
    </div>
  );
}
