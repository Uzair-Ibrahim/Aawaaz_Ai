import { LANGUAGE_REGISTRY, type LanguageCode } from '@awaaz/shared';
import type { AppEnv } from '../../config/env';
import { sha256Hex } from '../../core/security/crypto';
import { AppError } from '../../core/security/errors';
import type { AudioResult, TranscriptionResult, VoiceProvider } from './provider';

/**
 * Lingoscribe Voice Adapter.
 * NOTE (Provider Verification §3.2): Lingoscribe does not publish public unauthenticated
 * REST endpoint schemas; endpoints and keys are provisioned via enterprise/partner onboarding.
 * Therefore this adapter:
 * - Reads endpoint paths strictly from environment variables (never hardcoded guesses).
 * - Reports isConfigured()=false and returns HTTP 503 VOICE_PROVIDER_UNCONFIGURED unless
 *   LINGOSCRIBE_API_KEY and VOICE_PROVIDER_BASE_URL are explicitly provided.
 * - Never fabricates transcripts or audio.
 */
export class LingoscribeVoiceProvider implements VoiceProvider {
  public readonly providerName = 'lingoscribe';
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly sttPath: string;
  private readonly ttsPath: string;
  private readonly timeoutMs: number;
  private readonly ttsCache = new Map<string, { audio: Buffer; mimeType: string }>();

  constructor(env: AppEnv) {
    this.apiKey = env.LINGOSCRIBE_API_KEY.trim();
    this.baseUrl = env.VOICE_PROVIDER_BASE_URL.trim().replace(/\/+$/, '');
    this.sttPath = env.LINGOSCRIBE_STT_PATH;
    this.ttsPath = env.LINGOSCRIBE_TTS_PATH;
    this.timeoutMs = env.VOICE_REQUEST_TIMEOUT_MS;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.baseUrl);
  }

  supportsStt(language: LanguageCode): boolean {
    if (!this.isConfigured()) return false;
    return LANGUAGE_REGISTRY[language].stt_supported;
  }

  supportsTts(language: LanguageCode): boolean {
    if (!this.isConfigured()) return false;
    return LANGUAGE_REGISTRY[language].tts_supported;
  }

  async transcribe(input: {
    audio: Buffer;
    language: LanguageCode;
    mimeType: string;
  }): Promise<TranscriptionResult> {
    if (!this.isConfigured()) {
      throw new AppError(
        503,
        'VOICE_PROVIDER_UNCONFIGURED',
        'Lingoscribe speech-to-text is not configured. Provide verified VOICE_PROVIDER_BASE_URL and LINGOSCRIBE_API_KEY, or use text input fallback.',
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const form = new FormData();
      const providerCode =
        LANGUAGE_REGISTRY[input.language].provider_language_code.lingoscribe ?? input.language;
      form.append('language', providerCode);
      form.append(
        'audio',
        new Blob([new Uint8Array(input.audio)], { type: input.mimeType }),
        'recording.webm',
      );

      const response = await fetch(`${this.baseUrl}${this.sttPath}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: form,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new AppError(
          502,
          'VOICE_PROVIDER_ERROR',
          `Speech provider returned HTTP ${response.status}. Your draft is preserved; please retry or use text input.`,
        );
      }

      const data = (await response.json()) as { text?: string; transcript?: string; confidence?: number };
      const text = (data.text ?? data.transcript ?? '').trim();
      if (!text) {
        throw new AppError(422, 'EMPTY_TRANSCRIPTION', 'Speech provider returned an empty transcript.');
      }

      return {
        text,
        language: input.language,
        provider: this.providerName,
        confidence: typeof data.confidence === 'number' ? data.confidence : null,
        verified_language: LANGUAGE_REGISTRY[input.language].stt_supported,
      };
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(
        503,
        'VOICE_PROVIDER_UNAVAILABLE',
        'Speech provider could not be reached. Your draft is preserved; please continue using text input.',
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async synthesize(input: {
    text: string;
    language: LanguageCode;
    voice?: string;
  }): Promise<AudioResult> {
    if (!this.isConfigured()) {
      throw new AppError(
        503,
        'VOICE_PROVIDER_UNCONFIGURED',
        'Lingoscribe text-to-speech is not configured. Provide verified VOICE_PROVIDER_BASE_URL and LINGOSCRIBE_API_KEY.',
      );
    }

    const cacheKey = sha256Hex(`${input.language}:${input.voice ?? 'default'}:${input.text}`);
    const hit = this.ttsCache.get(cacheKey);
    if (hit) {
      return {
        audio: hit.audio,
        mimeType: hit.mimeType,
        language: input.language,
        provider: this.providerName,
        cached: true,
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const providerCode =
        LANGUAGE_REGISTRY[input.language].provider_language_code.lingoscribe ?? input.language;
      const response = await fetch(`${this.baseUrl}${this.ttsPath}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: input.text,
          language: providerCode,
          ...(input.voice ? { voice: input.voice } : {}),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new AppError(502, 'VOICE_TTS_ERROR', `Speech synthesis failed with HTTP ${response.status}.`);
      }

      const audio = Buffer.from(await response.arrayBuffer());
      const mimeType = response.headers.get('content-type') ?? 'audio/mpeg';
      if (this.ttsCache.size < 100) {
        this.ttsCache.set(cacheKey, { audio, mimeType });
      }
      return {
        audio,
        mimeType,
        language: input.language,
        provider: this.providerName,
        cached: false,
      };
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(503, 'VOICE_PROVIDER_UNAVAILABLE', 'Speech synthesis provider is currently unavailable.');
    } finally {
      clearTimeout(timer);
    }
  }
}
