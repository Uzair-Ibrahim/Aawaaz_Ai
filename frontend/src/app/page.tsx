'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { LANGUAGE_LIST } from '@awaaz/shared';
import { ArrowRight, Globe, ShieldCheck } from 'lucide-react';
import { VoiceSaathiOverlay } from '@/components/citizen/VoiceSaathiOverlay';
import { KeypadPhoneSimulatorModal } from '@/components/telephony/KeypadPhoneSimulatorModal';
import { useAuth } from '@/lib/auth/context';
import { formatText, useI18n } from '@/lib/i18n/context';
import { getRoleLandingRoute } from '@/lib/modules/registry';

export default function HomePage() {
  const { user } = useAuth();
  const { language, setLanguage, dict, roleLabel } = useI18n();
  const [keypadOpen, setKeypadOpen] = useState(false);

  const isStaff = user?.active_role === 'officer' || user?.active_role === 'admin';
  const showKeypadOnHome = !user || user.active_role === 'citizen';

  // PHASE 3: Staff roles (Officer / Admin) see a crisp, zero-voice portal redirect card — zero TTS/mic/overlay!
  if (isStaff && user) {
    return (
      <div className="max-w-2xl mx-auto py-10">
        <section className="rounded-2xl bg-white border border-slate-200 p-8 shadow-xs text-center space-y-4">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-50 text-teal-700 mx-auto">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">
            {user.display_name} ({roleLabel(user.active_role)})
          </h1>
          <Link
            href={getRoleLandingRoute(user.active_role)}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-teal-700 hover:bg-teal-800 text-white font-semibold transition"
          >
            <span>{formatText(dict.home.openRoleWorkspace, { role: roleLabel(user.active_role) })}</span>
            <ArrowRight className="h-4 w-4" />
          </Link>
        </section>
      </div>
    );
  }

  return (
    <div data-testid="home-unified-page" className="space-y-5">
      {/* Compact 6-Language Pill Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white border border-slate-200 rounded-2xl px-4 py-3 shadow-xs">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-teal-700 shrink-0" />
          <span className="text-sm font-bold text-slate-900">{dict.selectLanguage}</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {LANGUAGE_LIST.map((l) => (
            <button
              key={l.language_code}
              type="button"
              data-testid={`home-lang-pill-${l.language_code}`}
              onClick={() => setLanguage(l.language_code)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition ${
                language === l.language_code
                  ? 'bg-teal-700 text-white border-teal-700 shadow-xs'
                  : 'bg-slate-50 text-slate-700 border-slate-200 hover:border-teal-500'
              }`}
            >
              {l.native_name}
            </button>
          ))}
        </div>
      </div>

      {/* Single Unified Voice Saathi Directly on Home (/) */}
      <VoiceSaathiOverlay onOpenKeypadPhone={showKeypadOnHome ? () => setKeypadOpen(true) : undefined} />

      {/* Keypad Phone Demo Modal: Home screen & Normal Citizen accounts */}
      {showKeypadOnHome && <KeypadPhoneSimulatorModal open={keypadOpen} onClose={() => setKeypadOpen(false)} />}
    </div>
  );
}
