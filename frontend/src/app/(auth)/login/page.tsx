'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { useVoiceAgent } from '@/components/voice/GlobalVoiceSaathiProvider';
import { ApiClientError } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/context';
import { useI18n } from '@/lib/i18n/context';
import { getRoleLandingRoute } from '@/lib/modules/registry';

export default function LoginPage() {
  const router = useRouter();
  const { login, register, integrations } = useAuth();
  const { language, dict, roleLabel } = useI18n();
  const { authDraft, hardStopVoiceAgent } = useVoiceAgent();

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Live auto-fill from Voice Saathi spoken credentials!
  useEffect(() => {
    if (authDraft.identifier) setEmail(authDraft.identifier);
    if (authDraft.pin) setPassword(authDraft.pin);
  }, [authDraft.identifier, authDraft.pin]);

  const demoAccounts = [
    { label: `Admin Ayesha (${roleLabel('admin')})`, email: 'admin_ayesha', password: 'admin123' },
    { label: `Officer Hamza (Relief Assistance)`, email: 'officer_hamza', password: 'officer123' },
    { label: `Officer Sana (Scam & Cyber Safety)`, email: 'officer_sana', password: 'officer123' },
    { label: `Helper Salma (${roleLabel('helper')})`, email: 'helper_salma', password: 'helper123' },
    { label: `Auditor Bilal (${roleLabel('admin')})`, email: 'auditor_bilal', password: 'auditor123' },
    { label: `Citizen Zainab (${roleLabel('citizen')})`, email: 'citizen_zainab', password: 'citizen123' },
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const user =
        mode === 'login'
          ? await login(email, password)
          : await register({
              email,
              password,
              display_name: displayName,
              preferred_language: language,
            });
      // Immediately silence Voice Saathi for staff roles (officer / admin / auditor) before redirect!
      if (user.active_role === 'officer' || user.active_role === 'admin') {
        hardStopVoiceAgent();
      }
      router.push(getRoleLandingRoute(user.active_role));
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError(dict.auth.authFailed);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div data-testid="login-page" className="max-w-lg mx-auto py-4 space-y-6">
      <div className="rounded-2xl bg-white border border-slate-200 p-6 shadow-xs space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-teal-50 border border-teal-200 text-teal-800 text-xs font-bold">
            <Sparkles className="h-3.5 w-3.5" />
            <span>{dict.auth.voiceAutoFillingBadge}</span>
          </div>
          {authDraft.target_role && (
            <span className="px-2.5 py-1 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-800 text-xs font-bold">
              {roleLabel(authDraft.target_role)}
            </span>
          )}
        </div>

        <div className="flex rounded-xl bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => setMode('login')}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition ${
              mode === 'login' ? 'bg-white text-teal-800 shadow-xs' : 'text-slate-600'
            }`}
          >
            {dict.auth.signInTab}
          </button>
          <button
            type="button"
            onClick={() => setMode('register')}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition ${
              mode === 'register' ? 'bg-white text-teal-800 shadow-xs' : 'text-slate-600'
            }`}
          >
            {dict.auth.createAccountTab}
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          {mode === 'register' && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {dict.auth.displayNameLabel}
              </label>
              <input
                type="text"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={dict.auth.displayNamePlaceholder}
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              {dict.auth.emailOrUsernameLabel}
            </label>
            <input
              data-testid="login-email-input"
              type={mode === 'register' ? 'email' : 'text'}
              dir="ltr"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={dict.auth.emailOrUsernamePlaceholder}
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">{dict.auth.passwordLabel}</label>
            <input
              data-testid="login-password-input"
              type="password"
              dir="ltr"
              required
              minLength={4}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={dict.auth.passwordPlaceholder}
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>

          {error && (
            <div className="rounded-xl bg-rose-50 border border-rose-200 text-rose-800 px-3.5 py-2.5 text-sm">
              {error}
            </div>
          )}

          <button
            data-testid="login-submit-btn"
            type="submit"
            disabled={submitting}
            className="w-full py-3 rounded-xl bg-teal-700 text-white font-semibold text-base hover:bg-teal-800 disabled:opacity-60"
          >
            {submitting ? dict.loading : mode === 'login' ? dict.auth.signInTab : dict.auth.createAccountTab}
          </button>
        </form>

        <div className="text-center pt-2 border-t border-slate-100">
          <Link href="/signup" className="text-sm font-semibold text-teal-700 hover:underline">
            {dict.auth.noAccountYet}
          </Link>
        </div>
      </div>

      {/* Clearly isolated Local Development Demo Accounts — only shown in dev_local mode */}
      {integrations?.authMode === 'dev_local' && (
        <div className="rounded-2xl bg-amber-50 border border-amber-300 p-5 space-y-3">
          <div>
            <h2 className="text-sm font-bold text-amber-950">{dict.auth.devModeTitle}</h2>
            <p className="text-xs text-amber-900 mt-1">
              {dict.auth.devModeHint} <code dir="ltr">admin123</code> / <code dir="ltr">officer123</code> / <code dir="ltr">citizen123</code>
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {demoAccounts.map((acc) => (
              <button
                key={acc.email}
                type="button"
                onClick={() => {
                  setMode('login');
                  setEmail(acc.email);
                  setPassword(acc.password);
                }}
                className="text-start px-3 py-2 rounded-lg bg-white border border-amber-200 hover:bg-amber-100 text-xs"
              >
                <div className="font-semibold text-slate-900">{acc.label}</div>
                <div className="text-slate-600 truncate" dir="ltr">{acc.email}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
