'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LANGUAGE_LIST, type LanguageCode } from '@awaaz/shared';
import { Building2, Globe, LogOut, Phone, ShieldAlert, Wifi, WifiOff } from 'lucide-react';
import { KeypadPhoneSimulatorModal } from '@/components/telephony/KeypadPhoneSimulatorModal';
import { GlobalVoiceSaathiDock, VoiceAgentProvider } from '@/components/voice/GlobalVoiceSaathiProvider';
import { useAuth } from '@/lib/auth/context';
import { useI18n } from '@/lib/i18n/context';
import { isEffectiveOffline, isSimulatedOffline, NETWORK_MODE_EVENT, setSimulatedOffline } from '@/lib/offline/voice-offline-queue';

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, logout, switchWorkspace } = useAuth();
  const { language, direction, setLanguage, dict, roleLabel } = useI18n();
  const [isOnline, setIsOnline] = useState(true);
  const [keypadModalOpen, setKeypadModalOpen] = useState(false);

  useEffect(() => {
    const syncStatus = () => setIsOnline(!isEffectiveOffline());
    syncStatus();
    window.addEventListener('online', syncStatus);
    window.addEventListener('offline', syncStatus);
    window.addEventListener(NETWORK_MODE_EVENT, syncStatus);
    return () => {
      window.removeEventListener('online', syncStatus);
      window.removeEventListener('offline', syncStatus);
      window.removeEventListener(NETWORK_MODE_EVENT, syncStatus);
    };
  }, []);

  const isCitizenAccount = user?.active_role === 'citizen';
  // Keypad Phone Demo visible on Home screen (/) AND Normal Citizen accounts — hidden for helper/officer/admin!
  const showKeypadDemo = (!user && pathname === '/') || isCitizenAccount;
  const navLinks = [
    { href: '/', label: dict.navHome, show: true },
    { href: '/citizen', label: dict.navCitizen, show: isCitizenAccount },
    { href: '/helper', label: dict.navHelper, show: user?.active_role === 'helper' },
    { href: '/officer', label: dict.navOfficer, show: user?.active_role === 'officer' },
    { href: '/admin', label: dict.navAdmin, show: user?.active_role === 'admin' },
    { href: '/auditor', label: dict.navAuditor, show: user?.active_role === 'admin' },
    { href: '/workspace', label: dict.navWorkspace, show: user?.active_role === 'admin' },
  ].filter((l) => l.show);

  const canManageWorkspaces = user?.active_role === 'admin';

  return (
    <VoiceAgentProvider>
      <div dir={direction} className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
        {/* Prototype Synthetic Data Banner */}
        <div className="bg-amber-100 border-b border-amber-300 px-4 py-2 text-xs sm:text-sm text-amber-950 flex items-center justify-center gap-2 text-center">
          <ShieldAlert className="h-4 w-4 shrink-0" />
          <span>{dict.prototypeBanner}</span>
        </div>

        {/* Offline Banner */}
        {!isOnline && (
          <div className="bg-rose-700 text-white px-4 py-2 text-sm flex items-center justify-center gap-2 text-center">
            <WifiOff className="h-4 w-4 shrink-0" />
            <span>{dict.offlineBanner}</span>
          </div>
        )}

        {/* Header */}
        <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
          <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-4">
              <Link href="/" className="flex items-center gap-2 font-bold text-xl text-teal-800">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-teal-700 text-white text-base">
                  آ
                </span>
                <span data-testid="header-app-title">{dict.appTitle}</span>
              </Link>

              <nav className="hidden md:flex items-center gap-1" aria-label={dict.navHome}>
                {navLinks.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    data-testid={`nav-link-${item.href === '/' ? 'home' : item.href.slice(1)}`}
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition ${
                      pathname === item.href
                        ? 'bg-teal-50 text-teal-800 border border-teal-200'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Keypad Phone Call Demo Button — visible on Home (/) & Normal Citizen accounts ONLY */}
              {showKeypadDemo && (
                <button
                  type="button"
                  data-testid="header-keypad-btn"
                  onClick={() => setKeypadModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold shadow-xs transition"
                >
                  <Phone className="h-3.5 w-3.5" />
                  <span>{dict.keypadPhoneDemo}</span>
                </button>
              )}

              {/* Interactive Online / Offline Queue Mode Toggle (Challenge 07) */}
              <button
                type="button"
                data-testid="network-status-toggle"
                onClick={() => setSimulatedOffline(!isSimulatedOffline())}
                title="Click to simulate Weak / Offline Network mode"
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition cursor-pointer ${
                  isOnline
                    ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200'
                    : 'bg-rose-100 hover:bg-rose-200 text-rose-800 border border-rose-300'
                }`}
              >
                {isOnline ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
                <span>{isOnline ? dict.onlineReady : dict.offlineStatus}</span>
              </button>

              {/* Global Language Selector (Instantly syncs 100% UI + Voice Saathi!) */}
              <label className="inline-flex items-center gap-1.5 text-sm bg-slate-100 px-2.5 py-1.5 rounded-lg">
                <Globe className="h-4 w-4 text-slate-600" />
                <span className="sr-only">{dict.selectLanguage}</span>
                <select
                  data-testid="header-language-select"
                  aria-label={dict.selectLanguage}
                  value={language}
                  onChange={(e) => setLanguage(e.target.value as LanguageCode)}
                  className="bg-transparent font-medium text-slate-800 focus:outline-none"
                >
                  {LANGUAGE_LIST.map((l) => (
                    <option key={l.language_code} value={l.language_code}>
                      {l.native_name} ({l.display_name})
                    </option>
                  ))}
                </select>
              </label>

              {/* Workspace Switcher: Strictly Super Admin only */}
              {user && canManageWorkspaces && (
                <div className="inline-flex items-center gap-1.5 text-sm bg-slate-100 px-2.5 py-1.5 rounded-lg">
                  <Building2 className="h-4 w-4 text-teal-700" />
                  <select
                    aria-label={dict.activeWorkspaceLabel}
                    value={user.active_organization.id}
                    onChange={(e) => void switchWorkspace(e.target.value)}
                    className="bg-transparent font-medium text-slate-800 max-w-[180px] truncate focus:outline-none"
                  >
                    {user.memberships.map((m) => (
                      <option key={m.organization_id} value={m.organization_id}>
                        {m.organization_name} ({roleLabel(m.role)})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Auth Controls */}
              {user ? (
                <div className="flex items-center gap-2">
                  <span
                    data-testid="header-user-name"
                    className="hidden sm:inline-block text-xs px-2.5 py-1 rounded-full bg-teal-700 text-white font-semibold"
                  >
                    {user.display_name} • {roleLabel(user.active_role)}
                  </span>
                  <button
                    type="button"
                    data-testid="header-logout-btn"
                    onClick={() => void logout()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 text-sm font-medium hover:bg-slate-100"
                  >
                    <LogOut className="h-4 w-4" />
                    <span>{dict.navLogout}</span>
                  </button>
                </div>
              ) : (
                <Link
                  href="/login"
                  data-testid="header-login-link"
                  className="px-4 py-2 rounded-lg bg-teal-700 text-white text-sm font-semibold hover:bg-teal-800"
                >
                  {dict.navLogin}
                </Link>
              )}
            </div>
          </div>

          {/* Mobile navigation row */}
          <nav className="md:hidden border-t border-slate-100 px-3 py-2 flex gap-2 overflow-x-auto" aria-label={dict.navHome}>
            {navLinks.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap ${
                  pathname === item.href ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-700'
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </header>

        {/* Global Persistent Voice Saathi Dock (only on /login & /signup for non-staff; hidden on /, /citizen, and all staff routes) */}
        <GlobalVoiceSaathiDock />

        <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-6">{children}</main>

        <footer className="border-t border-slate-200 bg-white py-4 px-4 text-center text-xs text-slate-500">
          {dict.footerText}
        </footer>

        {showKeypadDemo && (
          <KeypadPhoneSimulatorModal open={keypadModalOpen} onClose={() => setKeypadModalOpen(false)} />
        )}
      </div>
    </VoiceAgentProvider>
  );
}
