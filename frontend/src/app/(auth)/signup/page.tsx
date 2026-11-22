'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, ShieldCheck, Sparkles } from 'lucide-react';
import { useVoiceAgent } from '@/components/voice/GlobalVoiceSaathiProvider';
import { useI18n } from '@/lib/i18n/context';

export default function SignupPage() {
  const { dict } = useI18n();
  const { authDraft, editingField, validationErrors, sendSessionTurn } = useVoiceAgent();

  const [fullName, setFullName] = useState(authDraft.full_name);
  const [cnic, setCnic] = useState(authDraft.cnic);
  const [phone, setPhone] = useState(authDraft.phone);
  const [pin, setPin] = useState('');

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
    <div data-testid="signup-page" className="max-w-xl mx-auto py-4 space-y-5">
      <div className="rounded-2xl bg-white border border-slate-200 p-6 shadow-xs space-y-5">
        <div className="space-y-1.5 border-b border-slate-200 pb-4">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-teal-50 border border-teal-200 text-teal-800 text-xs font-bold">
            <Sparkles className="h-3.5 w-3.5" />
            <span>{dict.auth.voiceAutoFillingBadge}</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-teal-700" />
            <span>{dict.auth.signupTitle}</span>
          </h1>
          <p className="text-sm text-slate-600">{dict.auth.signupSubtitle}</p>
        </div>

        <form onSubmit={(e) => void handleManualSubmit(e)} className="space-y-3.5">
          {fields.map((f) => {
            const err = errorForField(f.key);
            const filled = Boolean(f.val);
            const isEditing = editingField === f.key;
            return (
              <div
                key={f.key}
                data-testid={`auth-field-${f.key}`}
                data-filled={filled ? 'true' : 'false'}
                data-invalid={err ? 'true' : 'false'}
                data-editing={isEditing ? 'true' : 'false'}
                className={`p-3.5 rounded-xl border-2 transition ${
                  err
                    ? 'border-rose-500 bg-rose-50'
                    : isEditing
                      ? 'border-amber-500 bg-amber-50 ring-2 ring-amber-300/60'
                      : filled
                        ? 'border-emerald-500 bg-emerald-50/50'
                        : 'border-slate-200 bg-slate-50/70'
                }`}
              >
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <label className="font-bold text-slate-800">{f.label}</label>
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
                  ) : (
                    <span className="text-slate-400">{dict.voiceAgent.statusPending}</span>
                  )}
                </div>
                <input
                  data-testid={`signup-input-${f.key}`}
                  type={f.key === 'pin' ? 'password' : 'text'}
                  dir={f.dir}
                  value={f.inputVal}
                  onChange={(e) => f.setVal(e.target.value)}
                  placeholder={f.placeholder}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
                {err && <p className="text-xs text-rose-700 font-semibold mt-1">{err.message}</p>}
              </div>
            );
          })}

          <button
            type="submit"
            data-testid="signup-submit-btn"
            className="w-full py-3 rounded-xl bg-teal-700 hover:bg-teal-800 text-white font-semibold text-base transition"
          >
            {dict.auth.createAccountTab}
          </button>
        </form>

        <div className="text-center pt-2 border-t border-slate-100">
          <Link href="/login" className="text-sm font-semibold text-teal-700 hover:underline">
            {dict.auth.alreadyHaveAccount}
          </Link>
        </div>
      </div>
    </div>
  );
}
