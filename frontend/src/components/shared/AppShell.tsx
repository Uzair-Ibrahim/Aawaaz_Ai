'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LANGUAGE_LIST, type LanguageCode } from '@awaaz/shared';
import { Building2, Globe, HelpCircle, LogOut, Phone, ShieldAlert, Wifi, WifiOff } from 'lucide-react';
import { VoiceSaathiOverlay } from '@/components/citizen/VoiceSaathiOverlay';
import { AwaazLogo } from '@/components/shared/AwaazLogo';
import { KeypadPhoneSimulatorModal } from '@/components/telephony/KeypadPhoneSimulatorModal';
import { AWAAZ_TUTORIAL_STORAGE_KEY, AwaazQuickTutorial } from '@/components/tutorial/AwaazQuickTutorial';
import { VoiceAgentProvider } from '@/components/voice/GlobalVoiceSaathiProvider';
import { useAuth } from '@/lib/auth/context';
import { useI18n } from '@/lib/i18n/context';
import { isEffectiveOffline, isSimulatedOffline, NETWORK_MODE_EVENT, setSimulatedOffline } from '@/lib/offline/voice-offline-queue';

const GUIDE_BTN_LABEL: Record<LanguageCode, string> = {
  en: 'Guide',
  ur: 'رہنمائی',
  sd: 'رهنمائي',
  pa: 'رہنمائی',
  ps: 'لارښود',
  bal: 'رہشونی',
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, logout, switchWorkspace } = useAuth();
  const { language, direction, setLanguage, dict, roleLabel } = useI18n();
  const [isOnline, setIsOnline] = useState(true);
  const [keypadModalOpen, setKeypadModalOpen] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);

  const isStaff = user?.active_role === 'officer' || user?.active_role === 'admin';
  const isStaffRoute =
    pathname.startsWith('/officer') ||
    pathname.startsWith('/admin') ||
    pathname.startsWith('/auditor') ||
    pathname.startsWith('/workspace');
  const isStaffOrAuthRoute =
    isStaffRoute ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/signup');

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

  // Auto-open Pre-Start Interactive Button Tutorial ONCE on first visit to `/` (never blocks staff/auth routes)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (pathname !== '/' || isStaff || isStaffOrAuthRoute) {
      return;
    }
    const alreadySeen = window.localStorage.getItem(AWAAZ_TUTORIAL_STORAGE_KEY) === '1';
    if (!alreadySeen) {
      setTutorialOpen(true);
    }
  }, [pathname, isStaff, isStaffOrAuthRoute]);

  const isCitizenAccount = user?.active_role === 'citizen';
  // Keypad Phone Demo visible on Home screen (/) AND Normal Citizen accounts — hidden for helper/officer/admin!
  const showKeypadDemo = (!user && pathname === '/') || isCitizenAccount;
  const showPersistentVoiceShell = !isStaff && !isStaffRoute;

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

  const isRightSlotPage =
    pathname === '/login' || pathname === '/signup' || pathname === '/helper';

  return (
    <VoiceAgentProvider>
      <div
        data-testid="app-shell-root"
        dir={direction}
        className="min-h-screen flex flex-col awaaz-geometric-bg text-slate-950"
      >
        {/* Prototype Synthetic Data Banner */}
        <div className="bg-amber-100/95 border-b border-amber-300 px-4 py-2 text-xs sm:text-sm font-bold text-amber-950 flex items-center justify-center gap-2 text-center">
          <ShieldAlert className="h-4 w-4 shrink-0 text-amber-800" />
          <span>{dict.prototypeBanner}</span>
        </div>

        {/* Offline Banner */}
        {!isOnline && (
          <div className="bg-rose-700 text-white px-4 py-2 text-sm font-bold flex items-center justify-center gap-2 text-center">
            <WifiOff className="h-4 w-4 shrink-0" />
            <span>{dict.offlineBanner}</span>
          </div>
        )}

        {/* Premium VVVIP Civic Blue Glass Header */}
        <header className="bg-white/95 backdrop-blur-md border-b border-blue-200/80 shadow-xs sticky top-0 z-30">
          <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-4">
              <Link
                href="/"
                className="flex items-center gap-2.5 group focus:outline-none"
              >
                <AwaazLogo size="md" />
                <span className="flex flex-col leading-tight">
                  <span
                    data-testid="header-app-title"
                    className="text-xl font-extrabold tracking-tight text-slate-950 group-hover:text-blue-800 transition"
                  >
                    {dict.appTitle}
                  </span>
                  <span className="hidden sm:inline text-[11px] font-bold text-blue-800 tracking-wide">
                    {dict.appTagline}
                  </span>
                </span>
              </Link>

              <nav className="hidden md:flex items-center gap-1.5" aria-label={dict.navHome}>
                {navLinks.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    data-testid={`nav-link-${item.href === '/' ? 'home' : item.href.slice(1)}`}
                    className={`px-3.5 py-2 rounded-xl text-sm font-bold transition ${
                      pathname === item.href
                        ? 'bg-blue-50 text-blue-900 border-2 border-blue-500/50 shadow-2xs'
                        : 'text-slate-800 hover:bg-blue-50/60 border-2 border-transparent'
                    }`}
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Compact 1-Click Quick-Start Tutorial Guide Button */}
              {!isStaff && (
                <button
                  type="button"
                  data-testid="header-tutorial-btn"
                  onClick={() => setTutorialOpen(true)}
                  title={`${GUIDE_BTN_LABEL[language] ?? 'Guide'} (?)`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-50 hover:bg-blue-100 border-2 border-blue-300 text-blue-950 text-xs sm:text-sm font-extrabold shadow-2xs transition cursor-pointer"
                >
                  <HelpCircle className="h-4 w-4 text-blue-700" />
                  <span>{GUIDE_BTN_LABEL[language] ?? 'Guide'} (?)</span>
                </button>
              )}

              {/* Keypad Phone Call Demo Button — visible on Home (/) & Normal Citizen accounts ONLY */}
              {showKeypadDemo && (
                <button
                  type="button"
                  data-testid="header-keypad-btn"
                  onClick={() => setKeypadModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs sm:text-sm font-extrabold shadow-xs transition cursor-pointer"
                >
                  <Phone className="h-4 w-4" />
                  <span>{dict.keypadPhoneDemo}</span>
                </button>
              )}

              {/* Interactive Online / Offline Queue Mode Toggle (Challenge 07) */}
              <button
                type="button"
                data-testid="network-status-toggle"
                onClick={() => setSimulatedOffline(!isSimulatedOffline())}
                title="Click to simulate Weak / Offline Network mode"
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-extrabold transition cursor-pointer ${
                  isOnline
                    ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border-2 border-emerald-300'
                    : 'bg-rose-100 hover:bg-rose-200 text-rose-900 border-2 border-rose-400'
                }`}
              >
                {isOnline ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
                <span>{isOnline ? dict.onlineReady : dict.offlineStatus}</span>
              </button>

              {/* Global Language Selector (Instantly syncs 100% UI + Voice Saathi!) */}
              <label className="inline-flex items-center gap-1.5 text-sm bg-blue-50/70 hover:bg-blue-100/70 border border-blue-200 px-3 py-1.5 rounded-xl transition">
                <Globe className="h-4 w-4 text-blue-800 shrink-0" />
                <span className="sr-only">{dict.selectLanguage}</span>
                <select
                  data-testid="header-language-select"
                  aria-label={dict.selectLanguage}
                  value={language}
                  onChange={(e) => setLanguage(e.target.value as LanguageCode)}
                  className="bg-transparent font-bold text-slate-950 focus:outline-none cursor-pointer"
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
                <div className="inline-flex items-center gap-1.5 text-sm bg-blue-50 border border-blue-200 px-3 py-1.5 rounded-xl">
                  <Building2 className="h-4 w-4 text-blue-800" />
                  <select
                    aria-label={dict.activeWorkspaceLabel}
                    value={user.active_organization.id}
                    onChange={(e) => void switchWorkspace(e.target.value)}
                    className="bg-transparent font-bold text-slate-950 max-w-[180px] truncate focus:outline-none"
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
                    className="hidden sm:inline-block text-xs px-3 py-1.5 rounded-full bg-blue-800 text-white font-extrabold shadow-2xs"
                  >
                    {user.display_name} • {roleLabel(user.active_role)}
                  </span>
                  <button
                    type="button"
                    data-testid="header-logout-btn"
                    onClick={() => void logout()}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border-2 border-blue-200 bg-white text-slate-900 text-sm font-bold hover:bg-blue-50 transition cursor-pointer"
                  >
                    <LogOut className="h-4 w-4" />
                    <span>{dict.navLogout}</span>
                  </button>
                </div>
              ) : (
                <Link
                  href="/login"
                  data-testid="header-login-link"
                  className="px-4 py-2 rounded-xl bg-blue-700 hover:bg-blue-800 text-white text-sm font-extrabold shadow-xs transition"
                >
                  {dict.navLogin}
                </Link>
              )}
            </div>
          </div>

          {/* Mobile navigation row */}
          <nav className="md:hidden border-t border-blue-100 px-3 py-2 flex gap-2 overflow-x-auto" aria-label={dict.navHome}>
            {navLinks.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`px-3.5 py-1.5 rounded-xl text-sm font-bold whitespace-nowrap ${
                  pathname === item.href ? 'bg-blue-700 text-white' : 'bg-blue-50 text-slate-900'
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </header>

        <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-6">
          {showPersistentVoiceShell ? (
            <div className="space-y-5">
              {/* Slot 0: Compact 6-Language Pill Bar on Home (/) */}
              {pathname === '/' ? (
                <div
                  data-testid="home-unified-page"
                  className="flex flex-wrap items-center justify-between gap-3 bg-white/95 backdrop-blur-xs border-2 border-blue-200/90 rounded-2xl px-4 py-3.5 shadow-sm hover:shadow-md transition"
                >
                  <div className="flex items-center gap-2">
                    <Globe className="h-5 w-5 text-blue-700 shrink-0" />
                    <span className="text-sm sm:text-base font-extrabold text-slate-950">{dict.selectLanguage}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {LANGUAGE_LIST.map((l) => (
                      <button
                        key={l.language_code}
                        type="button"
                        data-testid={`home-lang-pill-${l.language_code}`}
                        onClick={() => setLanguage(l.language_code)}
                        className={`px-3.5 py-1.5 rounded-xl text-xs sm:text-sm font-extrabold border-2 transition cursor-pointer ${
                          language === l.language_code
                            ? 'bg-blue-700 text-white border-blue-700 shadow-sm'
                            : 'bg-blue-50/50 text-slate-900 border-blue-200 hover:border-blue-600 hover:bg-blue-100/60'
                        }`}
                      >
                        {l.native_name}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Slot 1: SINGLE PERSISTENT VOICE SAATHI (NEVER unmounts across / -> /signup -> /login -> /citizen -> /helper!) */}
              <VoiceSaathiOverlay
                onOpenKeypadPhone={showKeypadDemo ? () => setKeypadModalOpen(true) : undefined}
                rightSlot={isRightSlotPage ? children : undefined}
              />

              {/* Slot 2: Lower Citizen Portal Dashboard (history/details) when on /citizen */}
              {pathname === '/citizen' ? children : null}
            </div>
          ) : (
            children
          )}
        </main>

        <footer className="border-t border-blue-200/80 bg-white/90 backdrop-blur-xs py-4 px-4 text-center text-xs sm:text-sm font-bold text-slate-700">
          {dict.footerText}
        </footer>

        {showKeypadDemo && (
          <KeypadPhoneSimulatorModal open={keypadModalOpen} onClose={() => setKeypadModalOpen(false)} />
        )}

        {/* Interactive 6-Language Pre-Start Button Tutorial (never blocks staff portals) */}
        {!isStaff && (
          <AwaazQuickTutorial open={tutorialOpen} onClose={() => setTutorialOpen(false)} />
        )}
      </div>
    </VoiceAgentProvider>
  );
}
