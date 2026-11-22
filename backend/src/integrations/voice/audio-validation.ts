import { AppError } from '../../core/security/errors';

export const ALLOWED_AUDIO_MIME_TYPES = new Set([
  'audio/webm',
  'audio/ogg',
  'audio/wav',
  'audio/mpeg',
  'audio/mp4',
  'audio/x-m4a',
]);

export function validateAudioUpload(input: {
  buffer: Buffer;
  mimeType: string;
  maxSizeBytes: number;
  durationSeconds?: number;
}): void {
  const normalizedMime = input.mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!ALLOWED_AUDIO_MIME_TYPES.has(normalizedMime)) {
    throw new AppError(
      400,
      'UNSUPPORTED_AUDIO_FORMAT',
      `Audio format '${input.mimeType}' is not supported. Allowed: webm, ogg, wav, mp3, mp4/m4a.`,
    );
  }
  if (input.buffer.length === 0) {
    throw new AppError(400, 'EMPTY_AUDIO', 'Audio recording is empty.');
  }
  if (input.buffer.length > input.maxSizeBytes) {
    throw new AppError(
      413,
      'AUDIO_TOO_LARGE',
      `Audio file exceeds maximum allowed size (${Math.round(input.maxSizeBytes / (1024 * 1024))} MB).`,
    );
  }
  if (input.durationSeconds !== undefined && input.durationSeconds > 60) {
    throw new AppError(400, 'AUDIO_TOO_LONG', 'Push-to-talk recordings must be 60 seconds or shorter.');
  }
}
