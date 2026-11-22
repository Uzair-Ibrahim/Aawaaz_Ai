import { GoogleGenAI } from '@google/genai';
import { LANGUAGE_REGISTRY, type LanguageCode } from '@awaaz/shared';
import type { AppEnv } from '../../config/env';
import { AppError } from '../../core/security/errors';
import type { AudioResult, TranscriptionResult, VoiceProvider } from './provider';

export function isEmptyOrNoiseTranscript(raw: string | null | undefined): boolean {
  const text = (raw ?? '').trim();
  if (!text) return true;
  if (/^[\s.,!?؟۔\-_~*()[\]{}'":;/\\…]+$/.test(text)) return true;
  if (
    /^[[(]\s*(?:blank_audio|silence|inaudible|music|applause|noise|laughter|cough|sigh|background\s+noise|no\s+speech|unintelligible|static)\s*[\])]\.?$/i.test(
      text,
    )
  ) {
    return true;
  }
  return false;
}

function getAudioExtensionForMime(mimeType: string): string {
  const lower = (mimeType || '').toLowerCase();
  if (lower.includes('mp4') || lower.includes('m4a')) return 'mp4';
  if (lower.includes('ogg')) return 'ogg';
  if (lower.includes('wav')) return 'wav';
  if (lower.includes('mpeg') || lower.includes('mp3')) return 'mp3';
  return 'webm';
}

async function synthesizeZeroQuotaFallbackAudio(
  text: string,
  language: LanguageCode,
  providerLabel: string,
  ttsCache: Map<string, Buffer>,
): Promise<AudioResult> {
  const cacheKey = `${language}:${text.trim()}`;
  const cachedBuf = ttsCache.get(cacheKey);
  if (cachedBuf) {
    const isWav = cachedBuf.subarray(0, 4).toString('ascii') === 'RIFF';
    return {
      audio: cachedBuf,
      mimeType: isWav ? 'audio/wav' : 'audio/mpeg',
      language,
      provider: providerLabel,
      cached: true,
    };
  }
  const tl = language === 'en' ? 'en' : 'ur';
  const cleaned = text.replace(/\s+/g, ' ').trim().slice(0, 190);
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${tl}&q=${encodeURIComponent(cleaned)}`;
  const fallbackRes = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    signal: AbortSignal.timeout(4500),
  });
  if (!fallbackRes.ok) {
    throw new AppError(502, 'TTS_SYNTHESIS_FAILED', `Fallback TTS returned status ${fallbackRes.status}`);
  }
  const mp3Buf = Buffer.from(await fallbackRes.arrayBuffer());
  if (ttsCache.size < 100) {
    ttsCache.set(cacheKey, mp3Buf);
  }
  return {
    audio: mp3Buf,
    mimeType: 'audio/mpeg',
    language,
    provider: `${providerLabel}-fallback`,
    cached: false,
  };
}

/**
 * Optional Gemini multimodal audio transcription adapter (active when VOICE_PROVIDER=gemini
 * or VOICE_PROVIDER=auto with GEMINI_API_KEY set).
 */
function wrapPcm16MonoToWav(pcm: Buffer, sampleRate = 24000): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * 2;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // AudioFormat = 1 (PCM)
  header.writeUInt16LE(1, 22); // NumChannels = 1 (Mono)
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(2, 32); // BlockAlign
  header.writeUInt16LE(16, 34); // BitsPerSample
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export class GeminiAudioVoiceProvider implements VoiceProvider {
  public readonly providerName = 'gemini';
  private readonly model: string;
  private readonly client: GoogleGenAI | null;
  private readonly ttsCache = new Map<string, Buffer>();
  private geminiTtsQuotaExhaustedUntil = 0;

  constructor(env: AppEnv) {
    this.model = env.GEMINI_MODEL;
    this.client = env.GEMINI_API_KEY.trim()
      ? new GoogleGenAI({ apiKey: env.GEMINI_API_KEY.trim() })
      : null;
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  supportsStt(_language: LanguageCode): boolean {
    return this.isConfigured();
  }

  supportsTts(_language: LanguageCode): boolean {
    return this.isConfigured();
  }

  async transcribe(input: {
    audio: Buffer;
    language: LanguageCode;
    mimeType: string;
  }): Promise<TranscriptionResult> {
    if (!this.client) {
      throw new AppError(
        503,
        'VOICE_PROVIDER_UNCONFIGURED',
        'GEMINI_API_KEY is required when VOICE_PROVIDER=gemini.',
      );
    }

    const langMeta = LANGUAGE_REGISTRY[input.language];
    const modelCandidates = Array.from(new Set([this.model, 'gemini-2.5-flash', 'gemini-2.0-flash']));
    let rawText = '';
    let lastErr: unknown = null;
    for (const modelCandidate of modelCandidates) {
      try {
        const response = await this.client.models.generateContent({
          model: modelCandidate,
          contents: [
            {
              text: `Transcribe the spoken audio verbatim in ${langMeta.display_name} (${langMeta.language_code}). Return ONLY the transcript text with no explanation or formatting. If there is only silence or background noise with no speech, return an empty string.`,
            },
            {
              inlineData: {
                mimeType: input.mimeType,
                data: input.audio.toString('base64'),
              },
            },
          ],
        });
        rawText = (response.text ?? '').trim();
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
      }
    }

    if (lastErr) {
      throw new AppError(
        502,
        'VOICE_STT_FAILED',
        `Gemini STT failed: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
      );
    }

    const text = rawText.trim();
    if (isEmptyOrNoiseTranscript(text)) {
      return {
        text: '',
        language: input.language,
        detected_language: input.language,
        provider: this.providerName,
        confidence: null,
        verified_language: langMeta.stt_supported,
        empty_transcription: true,
      };
    }

    return {
      text,
      language: input.language,
      detected_language: input.language,
      provider: this.providerName,
      confidence: null,
      verified_language: langMeta.stt_supported,
    };
  }

  async synthesize(input: { text: string; language: LanguageCode; voice?: string }): Promise<AudioResult> {
    if (!this.client) {
      throw new AppError(
        503,
        'VOICE_PROVIDER_UNCONFIGURED',
        'GEMINI_API_KEY is required for Gemini speech synthesis.',
      );
    }

    const cacheKey = `${input.language}:${input.text.trim()}`;
    const cachedBuf = this.ttsCache.get(cacheKey);
    if (cachedBuf) {
      const isWav = cachedBuf.subarray(0, 4).toString('ascii') === 'RIFF';
      return {
        audio: cachedBuf,
        mimeType: isWav ? 'audio/wav' : 'audio/mpeg',
        language: input.language,
        provider: this.providerName,
        cached: true,
      };
    }

    const langMeta = LANGUAGE_REGISTRY[input.language];
    const spokenPrompt =
      input.language === 'en'
        ? input.text
        : `Speak the following ${langMeta.display_name} (${langMeta.native_name}) sentence aloud naturally in native ${langMeta.display_name} pronunciation and accent (read only the sentence itself):\n${input.text}`;

    try {
      if (Date.now() < this.geminiTtsQuotaExhaustedUntil) {
        throw new Error('GEMINI_TTS_COOLDOWN');
      }

      const response = await Promise.race([
        this.client.models.generateContent({
          model: 'gemini-2.5-flash-preview-tts',
          contents: [{ parts: [{ text: spokenPrompt }] }],
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: input.voice || 'Aoede',
                },
              },
            },
          },
        }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('GEMINI_TTS_TIMEOUT')), 4500)),
      ]);

      const inlinePart = response.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
      const b64 = inlinePart?.inlineData?.data;
      if (!b64) {
        throw new AppError(502, 'TTS_SYNTHESIS_FAILED', 'Gemini TTS returned no audio data.');
      }

      const rawAudio = Buffer.from(b64, 'base64');
      const wavBuffer =
        rawAudio.subarray(0, 4).toString('ascii') === 'RIFF' ? rawAudio : wrapPcm16MonoToWav(rawAudio, 24000);

      if (this.ttsCache.size < 100) {
        this.ttsCache.set(cacheKey, wavBuffer);
      }

      return {
        audio: wavBuffer,
        mimeType: 'audio/wav',
        language: input.language,
        provider: this.providerName,
        cached: false,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/429|RESOURCE_EXHAUSTED|quota|GEMINI_TTS_TIMEOUT/i.test(msg)) {
        this.geminiTtsQuotaExhaustedUntil = Date.now() + 15 * 60 * 1000;
      }
      // Fallback to fast zero-quota neural speech stream with hard 4.5s timeout so voice turns never stall
      const tl = input.language === 'en' ? 'en' : 'ur';
      const cleaned = input.text.replace(/\s+/g, ' ').trim().slice(0, 190);
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${tl}&q=${encodeURIComponent(cleaned)}`;
      const fallbackRes = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        signal: AbortSignal.timeout(4500),
      });
      if (!fallbackRes.ok) {
        throw new AppError(502, 'TTS_SYNTHESIS_FAILED', `Fallback TTS returned status ${fallbackRes.status}`);
      }
      const mp3Buf = Buffer.from(await fallbackRes.arrayBuffer());
      if (this.ttsCache.size < 100) {
        this.ttsCache.set(cacheKey, mp3Buf);
      }
      return {
        audio: mp3Buf,
        mimeType: 'audio/mpeg',
        language: input.language,
        provider: `${this.providerName}-fallback`,
        cached: false,
      };
    }
  }
}

export class GroqWhisperVoiceProvider implements VoiceProvider {
  public readonly providerName = 'groq';
  private readonly apiKey: string;
  private readonly sttModel: string;
  private readonly timeoutMs: number;
  private readonly fallbackGemini: GeminiAudioVoiceProvider | null;
  private readonly ttsCache = new Map<string, Buffer>();

  constructor(env: AppEnv) {
    this.apiKey = env.GROQ_API_KEY.trim();
    this.sttModel = env.GROQ_STT_MODEL;
    this.timeoutMs = env.VOICE_REQUEST_TIMEOUT_MS;
    this.fallbackGemini = env.GEMINI_API_KEY.trim() ? new GeminiAudioVoiceProvider(env) : null;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey || this.fallbackGemini?.isConfigured());
  }

  supportsStt(_language: LanguageCode): boolean {
    return this.isConfigured();
  }

  supportsTts(_language: LanguageCode): boolean {
    return this.isConfigured();
  }

  async transcribe(input: {
    audio: Buffer;
    language: LanguageCode;
    mimeType: string;
    autoDetect?: boolean;
  }): Promise<TranscriptionResult> {
    if (!this.apiKey) {
      if (this.fallbackGemini?.isConfigured()) {
        return await this.fallbackGemini.transcribe(input);
      }
      throw new AppError(503, 'VOICE_PROVIDER_UNCONFIGURED', 'GROQ_API_KEY is required for Groq Whisper STT.');
    }

    const langMeta = LANGUAGE_REGISTRY[input.language];
    const ext = getAudioExtensionForMime(input.mimeType);
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(input.audio)], { type: input.mimeType }), `audio.${ext}`);
    form.append('model', this.sttModel);
    form.append('response_format', 'verbose_json');

    // Lock Whisper STT language strictly when session language is locked so Urdu speech is never mis-transcribed as broken English!
    if (!input.autoDetect && ['en', 'ur', 'pa', 'sd', 'ps'].includes(input.language)) {
      form.append('language', input.language);
      const scriptHint =
        input.language === 'ur'
          ? 'Spoken in Pakistani Urdu (اردو) with occasional everyday English loanwords (CNIC, form, login, status, OTP, district, income).'
          : `Spoken in ${langMeta.display_name} (${langMeta.native_name}).`;
      form.append('prompt', scriptHint);
    } else {
      form.append(
        'prompt',
        'Spoken in Pakistan: Urdu (اردو), Punjabi (پنجابی), Sindhi (سنڌي), Pashto (پښتو), Balochi (بلوچی), or English.',
      );
    }

    try {
      const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: form,
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!res.ok) {
        const errBody = await res.text();
        if (this.fallbackGemini?.isConfigured()) {
          return await this.fallbackGemini.transcribe(input);
        }
        throw new AppError(502, 'VOICE_STT_FAILED', `Groq Whisper STT failed (${res.status}): ${errBody.slice(0, 160)}`);
      }

      const data = (await res.json()) as { text?: string; language?: string };
      const text = (data.text ?? '').trim();
      if (isEmptyOrNoiseTranscript(text)) {
        return {
          text: '',
          language: input.language,
          detected_language: input.language,
          provider: this.providerName,
          confidence: null,
          verified_language: true,
          empty_transcription: true,
        };
      }

      const rawDetected = (data.language ?? '').toLowerCase();
      let detectedLang: LanguageCode = input.language;
      if (rawDetected === 'english' || rawDetected === 'en') detectedLang = 'en';
      else if (rawDetected === 'punjabi' || rawDetected === 'panjabi' || rawDetected === 'pa') detectedLang = 'pa';
      else if (rawDetected === 'sindhi' || rawDetected === 'sd') detectedLang = 'sd';
      else if (rawDetected === 'pashto' || rawDetected === 'pushto' || rawDetected === 'ps') detectedLang = 'ps';
      else if (rawDetected === 'urdu' || rawDetected === 'ur' || rawDetected === 'hindi') detectedLang = 'ur';

      return {
        text,
        language: detectedLang,
        detected_language: detectedLang,
        provider: this.providerName,
        confidence: null,
        verified_language: true,
      };
    } catch (err) {
      if (this.fallbackGemini?.isConfigured() && !(err instanceof AppError && err.code === 'EMPTY_TRANSCRIPTION')) {
        return await this.fallbackGemini.transcribe(input);
      }
      throw err;
    }
  }

  async synthesize(input: { text: string; language: LanguageCode; voice?: string }): Promise<AudioResult> {
    if (this.fallbackGemini?.isConfigured()) {
      return await this.fallbackGemini.synthesize(input);
    }
    if (this.apiKey) {
      return await synthesizeZeroQuotaFallbackAudio(input.text, input.language, this.providerName, this.ttsCache);
    }
    throw new AppError(
      501,
      'TTS_NOT_SUPPORTED',
      'Server-side TTS requires GROQ_API_KEY, GEMINI_API_KEY, or LINGOSCRIBE_API_KEY. Using browser assistive speech synthesis.',
    );
  }
}

export class UnconfiguredVoiceProvider implements VoiceProvider {
  public readonly providerName = 'unconfigured';
  isConfigured(): boolean {
    return false;
  }
  supportsStt(): boolean {
    return false;
  }
  supportsTts(): boolean {
    return false;
  }
  async transcribe(): Promise<TranscriptionResult> {
    throw new AppError(
      503,
      'VOICE_PROVIDER_UNCONFIGURED',
      'No verified speech provider is configured (VOICE_PROVIDER=unconfigured). Your application draft is preserved; please use text input.',
    );
  }
  async synthesize(): Promise<AudioResult> {
    throw new AppError(
      503,
      'VOICE_PROVIDER_UNCONFIGURED',
      'No verified text-to-speech provider is configured. Configure VOICE_PROVIDER or use browser assistive speech fallback.',
    );
  }
}

export function createVoiceProvider(env: AppEnv): VoiceProvider {
  if (env.VOICE_PROVIDER === 'lingoscribe') {
    return new LingoscribeVoiceProvider(env);
  }
  if (env.VOICE_PROVIDER === 'auto') {
    if (env.GROQ_API_KEY.trim()) {
      return new GroqWhisperVoiceProvider(env);
    }
    if (env.GEMINI_API_KEY.trim()) {
      return new GeminiAudioVoiceProvider(env);
    }
    if (env.LINGOSCRIBE_API_KEY.trim() && env.VOICE_PROVIDER_BASE_URL.trim()) {
      return new LingoscribeVoiceProvider(env);
    }
    return new UnconfiguredVoiceProvider();
  }
  if (env.VOICE_PROVIDER === 'groq' || (env.VOICE_PROVIDER !== 'gemini' && env.GROQ_API_KEY.trim())) {
    if (!env.GROQ_API_KEY.trim() && env.GEMINI_API_KEY.trim()) {
      return new GeminiAudioVoiceProvider(env);
    }
    return new GroqWhisperVoiceProvider(env);
  }
  if (env.VOICE_PROVIDER === 'gemini' || env.GEMINI_API_KEY.trim()) {
    return new GeminiAudioVoiceProvider(env);
  }
  return new UnconfiguredVoiceProvider();
}

import { LingoscribeVoiceProvider } from './lingoscribe';
