'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { LANGUAGE_REGISTRY, type LanguageCode } from '@awaaz/shared';
import enDict from '../../../public/locales/en/common.json';
import urDict from '../../../public/locales/ur/common.json';
import sdDict from '../../../public/locales/sd/common.json';
import paDict from '../../../public/locales/pa/common.json';
import psDict from '../../../public/locales/ps/common.json';
import balDict from '../../../public/locales/bal/common.json';

export type LocaleDictionary = typeof enDict;

function deepMergeDictionary(
  base: LocaleDictionary,
  override: Partial<LocaleDictionary>,
): LocaleDictionary {
  return {
    ...base,
    ...override,
    roles: { ...base.roles, ...(override.roles ?? {}) },
    statuses: { ...base.statuses, ...(override.statuses ?? {}) },
    docTypes: { ...base.docTypes, ...(override.docTypes ?? {}) },
    home: { ...base.home, ...(override.home ?? {}) },
    auth: { ...base.auth, ...(override.auth ?? {}) },
    workspace: { ...base.workspace, ...(override.workspace ?? {}) },
    citizen: { ...base.citizen, ...(override.citizen ?? {}) },
    helper: { ...base.helper, ...(override.helper ?? {}) },
    officer: { ...base.officer, ...(override.officer ?? {}) },
    admin: { ...base.admin, ...(override.admin ?? {}) },
    deptChat: { ...base.deptChat, ...(override.deptChat ?? {}) },
    easyCitizen: { ...base.easyCitizen, ...(override.easyCitizen ?? {}) },
    onboarding: { ...base.onboarding, ...(override.onboarding ?? {}) },
    auditor: { ...base.auditor, ...(override.auditor ?? {}) },
    questions: { ...base.questions, ...(override.questions ?? {}) },
    voiceAgent: { ...base.voiceAgent, ...(override.voiceAgent ?? {}) },
    appStatus: { ...base.appStatus, ...(override.appStatus ?? {}) },
    officerInquiry: { ...base.officerInquiry, ...(override.officerInquiry ?? {}) },
  };
}

const STATIC_DICTIONARIES: Record<LanguageCode, LocaleDictionary> = {
  en: enDict,
  ur: deepMergeDictionary(enDict, urDict as Partial<LocaleDictionary>),
  sd: deepMergeDictionary(enDict, sdDict as Partial<LocaleDictionary>),
  pa: deepMergeDictionary(enDict, paDict as Partial<LocaleDictionary>),
  ps: deepMergeDictionary(enDict, psDict as Partial<LocaleDictionary>),
  bal: deepMergeDictionary(enDict, balDict as Partial<LocaleDictionary>),
};

export function formatText(template: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce(
    (acc, [key, val]) => acc.replaceAll(`{${key}}`, String(val)),
    template,
  );
}

interface I18nContextValue {
  language: LanguageCode;
  direction: 'ltr' | 'rtl';
  dict: LocaleDictionary;
  setLanguage: (lang: LanguageCode) => void;
  roleLabel: (role: string) => string;
  statusLabel: (status: string) => string;
  docTypeLabel: (docType: string) => string;
}

const I18nContext = createContext<I18nContextValue>({
  language: 'en',
  direction: 'ltr',
  dict: enDict,
  setLanguage: () => {},
  roleLabel: (r) => r,
  statusLabel: (s) => s,
  docTypeLabel: (d) => d,
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<LanguageCode>('en');

  const direction = LANGUAGE_REGISTRY[language].text_direction;
  const dict = useMemo(() => STATIC_DICTIONARIES[language] ?? enDict, [language]);

  const setLanguage = useCallback((lang: LanguageCode) => {
    setLanguageState(lang);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('awaaz_language', lang);
    }
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = window.localStorage.getItem('awaaz_language') as LanguageCode | null;
      if (saved && saved in LANGUAGE_REGISTRY) {
        setLanguageState(saved);
      }
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = direction;
  }, [language, direction]);

  const roleLabel = useCallback(
    (role: string) => (dict.roles as Record<string, string>)[role] ?? role,
    [dict.roles],
  );
  const statusLabel = useCallback(
    (status: string) => (dict.statuses as Record<string, string>)[status] ?? status,
    [dict.statuses],
  );
  const docTypeLabel = useCallback(
    (docType: string) => (dict.docTypes as Record<string, string>)[docType] ?? docType,
    [dict.docTypes],
  );

  return (
    <I18nContext.Provider
      value={{ language, direction, dict, setLanguage, roleLabel, statusLabel, docTypeLabel }}
    >
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
