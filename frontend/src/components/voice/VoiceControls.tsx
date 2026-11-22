'use client';

import React, { useRef, useState } from 'react';
import { LANGUAGE_REGISTRY, type LanguageCode } from '@awaaz/shared';
import { AlertCircle, Mic, Square, Volume2 } from 'lucide-react';
import { API_BASE_URL, ApiClientError, apiRequest } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/context';
import { formatText, useI18n } from '@/lib/i18n/context';

interface VoiceControlsProps {
  promptText: string;
  language: LanguageCode;
  onTranscript: (transcript: string) => void;
}

export function VoiceControls({ promptText, language, onTranscript }: VoiceControlsProps) {
  const { token, activeOrganizationId, integrations } = useAuth();
  const { dict } = useI18n();
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [voiceMessage, setVoiceMessage] = useState<string | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number>(0);

  const voiceConfigured = Boolean(integrations?.voice.configured);

  const startRecording = async () => {
    setVoiceError(null);
    setVoiceMessage(null);

    // If no server speech provider is configured locally, keep draft safe and show a clear localized message
    if (!voiceConfigured) {
      setVoiceError(dict.voiceUnconfiguredBanner);
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setVoiceError(dict.voiceMicUnsupported);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      startedAtRef.current = Date.now();

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const durationSec = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
        const blob = new Blob(chunksRef.current, { type: mimeType });
        await uploadForTranscription(blob, mimeType, durationSec);
      };

      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch {
      setVoiceError(dict.voiceMicDenied);
    }
  };

  const stopRecording = () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    setRecording(false);
  };

  const uploadForTranscription = async (blob: Blob, mimeType: string, durationSec: number) => {
    setBusy(true);
    setVoiceError(null);
    try {
      const form = new FormData();
      form.append('audio', blob, 'recording.webm');
      form.append('language', language);
      form.append('duration_seconds', String(durationSec));

      const data = await apiRequest<{
        transcription: { text: string; provider: string; verified_language: boolean };
      }>('/voice/transcribe', {
        method: 'POST',
        formData: form,
        token,
        organizationId: activeOrganizationId,
      });

      onTranscript(data.transcription.text);
      setVoiceMessage(formatText(dict.voiceTranscribedOk, { provider: data.transcription.provider }));
    } catch (err) {
      if (err instanceof ApiClientError && err.code === 'VOICE_PROVIDER_UNCONFIGURED') {
        setVoiceError(dict.voiceUnconfiguredBanner);
      } else if (err instanceof ApiClientError) {
        setVoiceError(`${dict.voiceFailedFallback} (${err.message})`);
      } else {
        setVoiceError(dict.voiceFailedFallback);
      }
    } finally {
      setBusy(false);
    }
  };

  const speakPrompt = async () => {
    setVoiceError(null);
    setVoiceMessage(null);

    if (voiceConfigured) {
      try {
        const res = await fetch(`${API_BASE_URL}/voice/speak`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(activeOrganizationId ? { 'X-Organization-Id': activeOrganizationId } : {}),
          },
          body: JSON.stringify({ text: promptText, language }),
        });
        if (res.ok) {
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          await audio.play();
          return;
        }
      } catch {
        // Fall through to honest browser fallback notice
      }
    }

    // Clearly labeled browser-native assistive speech fallback (NOT claimed as server TTS)
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const targetBcp47 = LANGUAGE_REGISTRY[language].provider_language_code.bcp47;
      const targetPrefix = targetBcp47.split('-')[0]?.toLowerCase() ?? language;
      const voices = window.speechSynthesis.getVoices();
      const matchingVoice = voices.find((v) => v.lang.toLowerCase().startsWith(targetPrefix));

      if (voices.length > 0 && !matchingVoice) {
        setVoiceError(dict.onboarding.voiceNoLangVoiceNotice);
        return;
      }

      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(promptText);
      utterance.lang = targetBcp47;
      if (matchingVoice) utterance.voice = matchingVoice;
      window.speechSynthesis.speak(utterance);
      setVoiceMessage(dict.voiceBrowserTtsNotice);
    } else {
      setVoiceError(dict.voiceTtsUnavailable);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={recording ? stopRecording : () => void startRecording()}
          disabled={busy}
          className={`inline-flex items-center gap-2 px-5 py-3 rounded-xl font-semibold text-base shadow-sm transition ${
            recording
              ? 'bg-rose-600 text-white hover:bg-rose-700'
              : voiceConfigured
                ? 'bg-teal-700 text-white hover:bg-teal-800'
                : 'bg-slate-600 text-white hover:bg-slate-700'
          } disabled:opacity-60`}
        >
          {recording ? <Square className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          <span>{recording ? dict.voiceRecordStop : busy ? dict.voiceProcessing : dict.voiceRecordStart}</span>
        </button>

        <button
          type="button"
          onClick={() => void speakPrompt()}
          className="inline-flex items-center gap-2 px-4 py-3 rounded-xl border border-slate-300 bg-white font-medium text-slate-800 hover:bg-slate-100"
        >
          <Volume2 className="h-5 w-5 text-teal-700" />
          <span>{dict.voiceReplayPrompt}</span>
        </button>

        <span className="text-xs text-slate-600">
          {dict.voiceProviderStatusLabel}:{' '}
          <strong>
            {voiceConfigured ? integrations?.voice.provider : dict.voiceUnconfiguredBadge}
          </strong>
        </span>
      </div>

      {!voiceConfigured && !voiceError && (
        <div className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{dict.voiceUnconfiguredBanner}</span>
        </div>
      )}

      {voiceMessage && (
        <p className="text-xs text-teal-800 bg-teal-50 border border-teal-200 rounded-lg px-3 py-2">{voiceMessage}</p>
      )}
      {voiceError && (
        <div className="text-xs text-amber-900 bg-amber-50 border border-amber-300 rounded-lg px-3 py-2 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{voiceError}</span>
        </div>
      )}
    </div>
  );
}
