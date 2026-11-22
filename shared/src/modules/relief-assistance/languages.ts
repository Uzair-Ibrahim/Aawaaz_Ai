import type { LanguageCode } from '../../saas/types';

export interface LanguageRegistryEntry {
  language_code: LanguageCode;
  display_name: string;
  native_name: string;
  text_direction: 'ltr' | 'rtl';
  stt_supported: boolean;
  tts_supported: boolean;
  provider_language_code: {
    lingoscribe: string | null;
    gemini: string;
    bcp47: string;
  };
  verification_status: 'unverified_pending_provider' | 'verified';
  notes: string;
}

/**
 * Provider-independent language registry.
 * IMPORTANT: stt_supported and tts_supported default to false until an actual
 * speech provider integration has been verified for that language.
 */
export const LANGUAGE_REGISTRY: Record<LanguageCode, LanguageRegistryEntry> = {
  en: {
    language_code: 'en',
    display_name: 'English',
    native_name: 'English',
    text_direction: 'ltr',
    stt_supported: false,
    tts_supported: false,
    provider_language_code: {
      lingoscribe: null,
      gemini: 'en',
      bcp47: 'en-US',
    },
    verification_status: 'unverified_pending_provider',
    notes: 'Requires verified speech provider configuration; full text input fallback always available.',
  },
  ur: {
    language_code: 'ur',
    display_name: 'Urdu',
    native_name: 'اردو',
    text_direction: 'rtl',
    stt_supported: false,
    tts_supported: false,
    provider_language_code: {
      lingoscribe: null,
      gemini: 'ur',
      bcp47: 'ur-PK',
    },
    verification_status: 'unverified_pending_provider',
    notes: 'RTL interface enabled. Speech requires verified provider configuration.',
  },
  pa: {
    language_code: 'pa',
    display_name: 'Punjabi',
    native_name: 'پنجابی',
    text_direction: 'rtl',
    stt_supported: false,
    tts_supported: false,
    provider_language_code: {
      lingoscribe: null,
      gemini: 'pa',
      bcp47: 'pa-PK',
    },
    verification_status: 'unverified_pending_provider',
    notes: 'Shahmukhi RTL interface enabled. Regional dialect speech pending verified provider.',
  },
  sd: {
    language_code: 'sd',
    display_name: 'Sindhi',
    native_name: 'سنڌي',
    text_direction: 'rtl',
    stt_supported: false,
    tts_supported: false,
    provider_language_code: {
      lingoscribe: null,
      gemini: 'sd',
      bcp47: 'sd-PK',
    },
    verification_status: 'unverified_pending_provider',
    notes: 'RTL interface enabled. Speech pending verified provider.',
  },
  bal: {
    language_code: 'bal',
    display_name: 'Balochi',
    native_name: 'بلوچی',
    text_direction: 'rtl',
    stt_supported: false,
    tts_supported: false,
    provider_language_code: {
      lingoscribe: null,
      gemini: 'bal',
      bcp47: 'bal-PK',
    },
    verification_status: 'unverified_pending_provider',
    notes: 'RTL interface enabled. Low-resource dialect speech pending verified provider.',
  },
  ps: {
    language_code: 'ps',
    display_name: 'Pashto',
    native_name: 'پښتو',
    text_direction: 'rtl',
    stt_supported: false,
    tts_supported: false,
    provider_language_code: {
      lingoscribe: null,
      gemini: 'ps',
      bcp47: 'ps-PK',
    },
    verification_status: 'unverified_pending_provider',
    notes: 'RTL interface enabled. Regional dialect speech pending verified provider.',
  },
};

export const LANGUAGE_LIST: LanguageRegistryEntry[] = Object.values(LANGUAGE_REGISTRY);
