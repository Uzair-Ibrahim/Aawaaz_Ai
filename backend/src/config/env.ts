import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  APP_URL: z.string().url().default('http://localhost:3000'),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),

  DATA_STORE_MODE: z.enum(['supabase', 'memory']).default('memory'),
  STORAGE_BACKEND: z.enum(['supabase', 'memory']).optional().default('memory'),
  AUTH_MODE: z.enum(['supabase', 'dev_local']).default('dev_local'),
  DEV_AUTH_SECRET: z.string().default('awaaz-local-dev-only-hmac-secret-change-me'),

  SUPABASE_URL: z.string().optional().default(''),
  SUPABASE_PUBLISHABLE_KEY: z.string().optional().default(''),
  SUPABASE_ANON_KEY: z.string().optional().default(''),
  SUPABASE_SECRET_KEY: z.string().optional().default(''),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional().default(''),
  SUPABASE_JWKS_URL: z.string().optional().default(''),
  DATABASE_URL: z.string().optional().default(''),
  SUPABASE_POOLER_URL: z.string().optional().default(''),
  SUPABASE_STORAGE_BUCKET: z.string().default('awaaz-private-documents'),

  GEMINI_API_KEY: z.string().optional().default(''),
  GEMINI_MODEL: z.string().default('gemini-3.8-flash'),
  GEMINI_EMBEDDING_MODEL: z.string().default('gemini-embedding-001'),
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(20000),

  GROQ_API_KEY: z.string().optional().default(''),
  GROQ_CHAT_MODEL: z.string().default('openai/gpt-oss-120b'),
  GROQ_STT_MODEL: z.string().default('whisper-large-v3-turbo'),

  GITHUB_TOKEN: z.string().optional().default(''),
  GITHUB_MODEL: z.string().default('gpt-4o-mini'),

  VOICE_PROVIDER: z.enum(['unconfigured', 'auto', 'groq', 'lingoscribe', 'gemini']).default('unconfigured'),
  VOICE_PROVIDER_BASE_URL: z.string().optional().default(''),
  LINGOSCRIBE_API_KEY: z.string().optional().default(''),
  LINGOSCRIBE_STT_PATH: z.string().default('/v1/transcribe'),
  LINGOSCRIBE_TTS_PATH: z.string().default('/v1/synthesize'),
  VOICE_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(20000),

  OTP_PROVIDER: z.enum(['unconfigured', 'supabase_sms']).default('unconfigured'),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().min(10).default(300),
  AI_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().min(5).default(120),
  MAX_UPLOAD_SIZE_MB: z.coerce.number().min(1).max(20).default(5),
  MAX_AUDIO_SIZE_MB: z.coerce.number().min(1).max(15).default(4),
});

export type AppEnv = z.infer<typeof envSchema>;

export function isUnmaskedSecretKey(raw: string | undefined | null): boolean {
  const val = (raw ?? '').trim();
  if (val.length < 18) return false;
  if (/PASTE|PLACEHOLDER|MASKED|YOUR_|REPLACE|\*{3,}|<.*>/i.test(val)) return false;
  return true;
}

export function getEffectiveSupabasePublishableKey(env: AppEnv): string {
  return (env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || '').trim();
}

export function getEffectiveSupabaseSecretKey(env: AppEnv): string {
  const candidate = (env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  return isUnmaskedSecretKey(candidate) ? candidate : '';
}

export function loadEnv(overrides?: Record<string, string | undefined>): AppEnv {
  const parsed = envSchema.safeParse({
    ...process.env,
    ...overrides,
  });

  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  const config = parsed.data;
  const effectivePublishable = getEffectiveSupabasePublishableKey(config);
  const effectiveSecret = getEffectiveSupabaseSecretKey(config);

  // Normalize aliases so existing modules referencing SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY work seamlessly
  if (!config.SUPABASE_ANON_KEY && effectivePublishable) {
    config.SUPABASE_ANON_KEY = effectivePublishable;
  }
  if (!config.SUPABASE_SERVICE_ROLE_KEY && effectiveSecret) {
    config.SUPABASE_SERVICE_ROLE_KEY = effectiveSecret;
  }

  // Hard production safety guardrails
  if (config.NODE_ENV === 'production') {
    if (config.DATA_STORE_MODE !== 'supabase') {
      throw new Error('Production requires DATA_STORE_MODE=supabase. In-memory store is forbidden in production.');
    }
    if (config.AUTH_MODE !== 'supabase') {
      throw new Error('Production requires AUTH_MODE=supabase. Local dev auth is forbidden in production.');
    }
    if (!config.SUPABASE_URL || !effectivePublishable || !effectiveSecret) {
      throw new Error('Production requires SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY/ANON_KEY, and unmasked SUPABASE_SECRET_KEY/SERVICE_ROLE_KEY.');
    }
  }

  if (config.DATA_STORE_MODE === 'supabase' && (!config.SUPABASE_URL || !effectiveSecret)) {
    throw new Error('DATA_STORE_MODE=supabase requires SUPABASE_URL and an unmasked SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY.');
  }

  if (config.AUTH_MODE === 'supabase' && (!config.SUPABASE_URL || !effectivePublishable)) {
    throw new Error('AUTH_MODE=supabase requires SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY or SUPABASE_ANON_KEY.');
  }

  return config;
}

export interface IntegrationStatus {
  dataStoreMode: 'supabase' | 'memory';
  authMode: 'supabase' | 'dev_local';
  supabase: {
    configured: boolean;
    url: string;
    jwksUrl: string;
    storageBackend: 'supabase' | 'memory';
    hasPublishableKey: boolean;
    hasUnmaskedSecretKey: boolean;
    hasDatabaseUrl: boolean;
    missingKeys: string[];
  };
  ai: {
    provider: 'gemini' | 'groq' | 'github' | 'multi';
    configured: boolean;
    model: string;
    embeddingModel: string;
    reason?: string;
  };
  voice: {
    provider: 'unconfigured' | 'groq' | 'lingoscribe' | 'gemini';
    configured: boolean;
    reason?: string;
  };
  otp: {
    provider: 'unconfigured' | 'supabase_sms';
    configured: boolean;
    devLocalPreviewEnabled: boolean;
    reason?: string;
  };
}

export function getIntegrationStatus(env: AppEnv): IntegrationStatus {
  const hasGemini = Boolean(env.GEMINI_API_KEY.trim());
  const hasGroq = Boolean(env.GROQ_API_KEY.trim());
  const hasGithub = Boolean(env.GITHUB_TOKEN.trim());
  const aiConfigured = hasGemini || hasGroq || hasGithub;

  const activeAiProvider: 'gemini' | 'groq' | 'github' | 'multi' =
    [hasGemini, hasGroq, hasGithub].filter(Boolean).length > 1
      ? 'multi'
      : hasGemini
        ? 'gemini'
        : hasGroq
          ? 'groq'
          : hasGithub
            ? 'github'
            : 'gemini';
  const activeAiModel = hasGemini
    ? env.GEMINI_MODEL
    : hasGroq
      ? env.GROQ_CHAT_MODEL
      : hasGithub
        ? env.GITHUB_MODEL
        : env.GEMINI_MODEL;

  let voiceProvider: 'unconfigured' | 'groq' | 'lingoscribe' | 'gemini' =
    env.VOICE_PROVIDER === 'auto' ? 'unconfigured' : env.VOICE_PROVIDER;
  let voiceConfigured = false;
  let voiceReason: string | undefined;

  if (env.VOICE_PROVIDER === 'lingoscribe') {
    voiceConfigured = Boolean(env.LINGOSCRIBE_API_KEY.trim() && env.VOICE_PROVIDER_BASE_URL.trim());
    if (!voiceConfigured) {
      voiceReason = 'Lingoscribe requires LINGOSCRIBE_API_KEY and verified VOICE_PROVIDER_BASE_URL.';
    }
  } else if (env.VOICE_PROVIDER === 'groq' || (env.VOICE_PROVIDER !== 'gemini' && hasGroq)) {
    voiceProvider = 'groq';
    voiceConfigured = hasGroq;
    if (!voiceConfigured) {
      voiceReason = 'Groq Whisper STT requires GROQ_API_KEY.';
    }
  } else if (env.VOICE_PROVIDER === 'gemini' || hasGemini) {
    voiceProvider = 'gemini';
    voiceConfigured = hasGemini;
    if (!voiceConfigured) {
      voiceReason = 'Gemini audio adapter requires GEMINI_API_KEY.';
    }
  } else {
    voiceProvider = 'unconfigured';
    voiceReason = 'No speech provider key configured (set GROQ_API_KEY, GEMINI_API_KEY, or LINGOSCRIBE_API_KEY). Text input fallback is active.';
  }

  const effectivePublishable = getEffectiveSupabasePublishableKey(env);
  const effectiveSecret = getEffectiveSupabaseSecretKey(env);
  const hasSupabaseUrl = Boolean(env.SUPABASE_URL.trim());
  const hasDatabaseUrl = Boolean((env.SUPABASE_POOLER_URL || env.DATABASE_URL || '').trim());
  const missingKeys: string[] = [];
  if (!hasSupabaseUrl) missingKeys.push('SUPABASE_URL');
  if (!effectivePublishable) missingKeys.push('SUPABASE_PUBLISHABLE_KEY');
  if (!effectiveSecret) missingKeys.push('SUPABASE_SECRET_KEY (unmasked)');

  const otpConfigured =
    env.OTP_PROVIDER === 'supabase_sms' && Boolean(hasSupabaseUrl && effectivePublishable);
  const devLocalPreviewEnabled = env.AUTH_MODE === 'dev_local' && env.NODE_ENV !== 'production';
  const otpReason = otpConfigured
    ? undefined
    : 'Live SMS OTP provider is unconfigured (requires OTP_PROVIDER=supabase_sms with Supabase Phone Auth/SMS provider credentials). Isolated local dev OTP verification is active.';

  return {
    dataStoreMode: env.DATA_STORE_MODE,
    authMode: env.AUTH_MODE,
    supabase: {
      configured: hasSupabaseUrl && Boolean(effectivePublishable),
      url: env.SUPABASE_URL.trim(),
      jwksUrl:
        env.SUPABASE_JWKS_URL.trim() ||
        (hasSupabaseUrl ? `${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json` : ''),
      storageBackend: env.STORAGE_BACKEND ?? env.DATA_STORE_MODE,
      hasPublishableKey: Boolean(effectivePublishable),
      hasUnmaskedSecretKey: Boolean(effectiveSecret),
      hasDatabaseUrl,
      missingKeys,
    },
    ai: {
      provider: activeAiProvider,
      configured: aiConfigured,
      model: activeAiModel,
      embeddingModel: env.GEMINI_EMBEDDING_MODEL,
      ...(aiConfigured ? {} : { reason: 'Set GEMINI_API_KEY, GROQ_API_KEY, or GITHUB_TOKEN to enable AI.' }),
    },
    voice: {
      provider: voiceProvider,
      configured: voiceConfigured,
      ...(voiceReason ? { reason: voiceReason } : {}),
    },
    otp: {
      provider: env.OTP_PROVIDER,
      configured: otpConfigured,
      devLocalPreviewEnabled,
      ...(otpReason ? { reason: otpReason } : {}),
    },
  };
}
