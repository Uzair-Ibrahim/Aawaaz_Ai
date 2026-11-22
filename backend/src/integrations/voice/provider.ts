import type { LanguageCode } from '@awaaz/shared';

export interface TranscriptionResult {
  text: string;
  language: LanguageCode;
  detected_language?: LanguageCode;
  provider: string;
  confidence: number | null;
  verified_language: boolean;
  empty_transcription?: boolean;
}

export interface AudioResult {
  audio: Buffer;
  mimeType: string;
  language: LanguageCode;
  provider: string;
  cached: boolean;
}

export interface VoiceProvider {
  readonly providerName: string;
  isConfigured(): boolean;
  supportsStt(language: LanguageCode): boolean;
  supportsTts(language: LanguageCode): boolean;
  transcribe(input: {
    audio: Buffer;
    language: LanguageCode;
    mimeType: string;
    autoDetect?: boolean;
  }): Promise<TranscriptionResult>;
  synthesize(input: {
    text: string;
    language: LanguageCode;
    voice?: string;
  }): Promise<AudioResult>;
}
