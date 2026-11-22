'use client';

import React, { useRef, useState } from 'react';
import { LANGUAGE_REGISTRY, type LanguageCode } from '@awaaz/shared';
import { Mic, PhoneCall, PhoneOff, Square, Terminal, X } from 'lucide-react';
import { API_BASE_URL } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/context';
import { useI18n } from '@/lib/i18n/context';

interface McpCallItem {
  tool_name: string;
  arguments: Record<string, unknown>;
  result: unknown;
  status: 'success' | 'error';
  duration_ms: number;
}

interface TelephonyTurnResponse {
  call_sid: string;
  session_id: string;
  detected_language: LanguageCode;
  transcript: string;
  agent_reply_text: string;
  agent_reply_audio: string | null;
  agent_reply_audio_mime: string | null;
  keypad_menu_hint?: string;
  digits_pressed?: string | null;
  form_state: {
    name: string;
    cnic: string;
    district: string;
    monthly_income: number | null;
    amount: number | null;
    reason: string;
    consent_confirmed: boolean;
    reference_number: string | null;
    claim_status: string | null;
  };
  mcp_tools_called: McpCallItem[];
  twiml: string;
}

const KEYPAD_BUTTONS: Array<{ digit: string; sub: string; hintUr: string }> = [
  { digit: '1', sub: 'CLAIM', hintUr: 'نئی درخواست' },
  { digit: '2', sub: 'STATUS', hintUr: 'اسٹیٹس چیک' },
  { digit: '3', sub: 'SCAM', hintUr: 'فراڈ چیک' },
  { digit: '4', sub: 'GHI', hintUr: '' },
  { digit: '5', sub: 'JKL', hintUr: '' },
  { digit: '6', sub: 'MNO', hintUr: '' },
  { digit: '7', sub: 'PQRS', hintUr: '' },
  { digit: '8', sub: 'TUV', hintUr: '' },
  { digit: '9', sub: 'CONFIRM', hintUr: 'تصدیق و جمع' },
  { digit: '*', sub: 'LANG', hintUr: 'زبان' },
  { digit: '0', sub: 'POLICY', hintUr: 'اہلیت اصول' },
  { digit: '#', sub: 'SUBMIT', hintUr: 'جمع کریں' },
];

function playDtmfTone(digit: string) {
  if (typeof window === 'undefined') return;
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const freqMap: Record<string, number> = {
      '1': 697, '2': 770, '3': 852, '4': 770, '5': 852,
      '6': 941, '7': 852, '8': 941, '9': 1209, '*': 941, '0': 1336, '#': 1477,
    };
    osc.frequency.value = freqMap[digit] ?? 800;
    gain.gain.value = 0.08;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    setTimeout(() => {
      osc.stop();
      void ctx.close();
    }, 110);
  } catch {
    // Ignore audio context restriction
  }
}

export function KeypadPhoneSimulatorModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { token, activeOrganizationId } = useAuth();
  const { language } = useI18n();

  const [inCall, setInCall] = useState(false);
  const [callSid, setCallSid] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [lcdHeading, setLcdHeading] = useState('8171 • AMAANAT IVR');
  const [lcdText, setLcdText] = useState(
    'سبز کال بٹن دبائیں (Press Green Call Button to dial offline keypad helpline)',
  );
  const [lastTranscript, setLastTranscript] = useState('');
  const [refNumber, setRefNumber] = useState<string | null>(null);
  const [mcpLog, setMcpLog] = useState<McpCallItem[]>([]);
  const [lastTwiml, setLastTwiml] = useState<string>('');
  const [showTwiml, setShowTwiml] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  if (!open) return null;

  const speakOverPhone = (text: string, langCode: LanguageCode) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = LANGUAGE_REGISTRY[langCode]?.provider_language_code.bcp47 ?? 'ur-PK';
    utt.rate = 0.98;
    window.speechSynthesis.speak(utt);
  };

  const startCall = async () => {
    const newSid = `call-sim-${Date.now()}`;
    setCallSid(newSid);
    setInCall(true);
    setBusy(true);
    setRefNumber(null);
    setLastTranscript('');
    setLcdHeading('DIALING 8171...');
    try {
      const res = await fetch(`${API_BASE_URL}/telephony/incoming?format=json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(activeOrganizationId ? { 'X-Organization-Id': activeOrganizationId } : {}),
        },
        body: JSON.stringify({
          CallSid: newSid,
          From: '+923001234567',
          language,
          format: 'json',
        }),
      });
      const data = (await res.json()) as TelephonyTurnResponse;
      setLcdHeading(`CONNECTED • ${data.detected_language.toUpperCase()}`);
      const fullPrompt = `${data.agent_reply_text} ${data.keypad_menu_hint ?? ''}`;
      setLcdText(fullPrompt);
      setLastTwiml(data.twiml);
      speakOverPhone(fullPrompt, data.detected_language);
    } catch {
      setLcdHeading('LINE BUSY');
      setLcdText('Could not reach /api/v1/telephony/incoming');
    } finally {
      setBusy(false);
    }
  };

  const endCall = () => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    setRecording(false);
    setInCall(false);
    setLcdHeading('CALL ENDED');
    setLcdText('کال ختم ہو گئی۔ دوبارہ ملانے کے لیے سبز بٹن دبائیں۔');
  };

  const pressDigit = async (digit: string) => {
    playDtmfTone(digit);
    if (!inCall) {
      await startCall();
      return;
    }
    setBusy(true);
    setLcdHeading(`KEY [${digit}] PRESSED...`);
    try {
      const res = await fetch(`${API_BASE_URL}/telephony/gather?format=json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(activeOrganizationId ? { 'X-Organization-Id': activeOrganizationId } : {}),
        },
        body: JSON.stringify({
          CallSid: callSid,
          Digits: digit,
          language,
          format: 'json',
        }),
      });
      const data = (await res.json()) as TelephonyTurnResponse;
      setLcdHeading(`8171 LIVE • ${data.detected_language.toUpperCase()}`);
      setLastTranscript(data.transcript);
      setLcdText(data.agent_reply_text);
      setLastTwiml(data.twiml);
      if (data.form_state?.reference_number) {
        setRefNumber(data.form_state.reference_number);
      }
      if (data.mcp_tools_called?.length) {
        setMcpLog((prev) => [...data.mcp_tools_called, ...prev]);
      }
      speakOverPhone(data.agent_reply_text, data.detected_language);
    } finally {
      setBusy(false);
    }
  };

  const togglePhoneMic = async () => {
    if (!inCall) {
      await startCall();
      return;
    }
    if (recording) {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop();
      }
      setRecording(false);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mimeType });
        setBusy(true);
        setLcdHeading('PROCESSING VOICE...');
        try {
          const form = new FormData();
          form.append('audio', blob, 'call.webm');
          form.append('CallSid', callSid);
          form.append('language', language);
          form.append('format', 'json');
          const res = await fetch(`${API_BASE_URL}/telephony/gather?format=json`, {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
              ...(activeOrganizationId ? { 'X-Organization-Id': activeOrganizationId } : {}),
            },
            body: form,
          });
          const data = (await res.json()) as TelephonyTurnResponse;
          setLcdHeading(`8171 LIVE • ${data.detected_language.toUpperCase()}`);
          setLastTranscript(data.transcript);
          setLcdText(data.agent_reply_text);
          setLastTwiml(data.twiml);
          if (data.form_state?.reference_number) {
            setRefNumber(data.form_state.reference_number);
          }
          if (data.mcp_tools_called?.length) {
            setMcpLog((prev) => [...data.mcp_tools_called, ...prev]);
          }
          speakOverPhone(data.agent_reply_text, data.detected_language);
        } finally {
          setBusy(false);
        }
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
      setLcdHeading('SPEAK INTO PHONE...');
    } catch {
      setLcdHeading('MIC BLOCKED — USE KEYS');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-slate-900 border-4 border-slate-700 rounded-[2.5rem] w-full max-w-sm p-5 text-white shadow-2xl space-y-4 relative">
        {/* Close button */}
        <button
          type="button"
          onClick={() => {
            endCall();
            onClose();
          }}
          className="absolute top-4 end-4 p-1.5 rounded-full bg-slate-800 text-slate-300 hover:text-white"
          aria-label="Close keypad phone simulator"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Ear speaker grille */}
        <div className="flex flex-col items-center gap-1 pt-1">
          <div className="w-16 h-1.5 rounded-full bg-slate-700" />
          <span className="text-[11px] uppercase tracking-widest text-teal-400 font-bold">
            Nokia / Basic Keypad Offline IVR
          </span>
        </div>

        {/* Backlit Monochrome LCD Screen */}
        <div className="rounded-2xl bg-emerald-950 border-2 border-emerald-600/70 p-3.5 text-emerald-100 font-mono space-y-2 min-h-[150px] flex flex-col justify-between shadow-inner">
          <div className="flex items-center justify-between text-[11px] border-b border-emerald-800 pb-1 text-emerald-300">
            <span className="font-bold">{lcdHeading}</span>
            <span>{inCall ? '🟢 ON CALL' : '⚪ IDLE'}</span>
          </div>

          <div className="space-y-1.5 text-xs leading-relaxed overflow-y-auto max-h-28">
            {lastTranscript && (
              <div className="text-amber-300 text-[11px]">
                <strong>You:</strong> {lastTranscript}
              </div>
            )}
            <div className="text-emerald-100">{busy ? '⏳ Processing via MCP...' : lcdText}</div>
          </div>

          {refNumber && (
            <div className="rounded-lg bg-emerald-900/90 border border-emerald-400 px-2.5 py-1 text-center text-xs font-bold text-white">
              SMS Receipt: {refNumber}
            </div>
          )}
        </div>

        {/* Call / Mic / End Action Row */}
        <div className="grid grid-cols-3 gap-2.5">
          <button
            type="button"
            disabled={busy || inCall}
            onClick={() => void startCall()}
            className="py-2.5 rounded-2xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 font-bold text-xs flex flex-col items-center justify-center gap-1 shadow-md"
          >
            <PhoneCall className="h-4 w-4" />
            <span>Call 8171</span>
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={() => void togglePhoneMic()}
            className={`py-2.5 rounded-2xl font-bold text-xs flex flex-col items-center justify-center gap-1 shadow-md ${
              recording ? 'bg-amber-500 text-slate-950 animate-pulse' : 'bg-teal-700 hover:bg-teal-600 text-white'
            }`}
          >
            {recording ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            <span>{recording ? 'Send Voice' : 'Speak'}</span>
          </button>

          <button
            type="button"
            disabled={!inCall}
            onClick={endCall}
            className="py-2.5 rounded-2xl bg-rose-600 hover:bg-rose-500 disabled:opacity-40 font-bold text-xs flex flex-col items-center justify-center gap-1 shadow-md"
          >
            <PhoneOff className="h-4 w-4" />
            <span>End Call</span>
          </button>
        </div>

        {/* 12-Key Tactile DTMF Keypad */}
        <div className="grid grid-cols-3 gap-2">
          {KEYPAD_BUTTONS.map((btn) => (
            <button
              key={btn.digit}
              type="button"
              disabled={busy}
              onClick={() => void pressDigit(btn.digit)}
              className="py-2.5 px-2 rounded-2xl bg-slate-800 hover:bg-slate-700 active:scale-95 border border-slate-700 flex flex-col items-center justify-center transition"
            >
              <span className="text-lg font-bold text-white leading-none">{btn.digit}</span>
              <span className="text-[10px] font-semibold text-teal-300 mt-0.5">{btn.sub}</span>
              {btn.hintUr && <span className="text-[10px] text-slate-400">{btn.hintUr}</span>}
            </button>
          ))}
        </div>

        {/* Live TwiML & MCP Tool Trace Footer for Judges */}
        <div className="pt-2 border-t border-slate-800 space-y-2 text-[11px]">
          <div className="flex items-center justify-between text-slate-400">
            <span className="inline-flex items-center gap-1 font-semibold text-teal-400">
              <Terminal className="h-3.5 w-3.5" />
              MCP Tools ({mcpLog.length})
            </span>
            {lastTwiml && (
              <button
                type="button"
                onClick={() => setShowTwiml((v) => !v)}
                className="text-xs text-amber-400 hover:underline"
              >
                {showTwiml ? 'Hide TwiML XML' : 'View TwiML XML'}
              </button>
            )}
          </div>

          {mcpLog.length > 0 && (
            <div className="max-h-20 overflow-y-auto space-y-1">
              {mcpLog.slice(0, 3).map((item, idx) => (
                <div key={idx} className="px-2 py-1 rounded bg-slate-800 text-slate-200 flex items-center justify-between">
                  <span className="font-mono text-emerald-400">{item.tool_name}()</span>
                  <span className="text-slate-400">{item.duration_ms}ms</span>
                </div>
              ))}
            </div>
          )}

          {showTwiml && lastTwiml && (
            <pre className="p-2 rounded-lg bg-slate-950 text-emerald-300 text-[10px] overflow-x-auto max-h-28" dir="ltr">
              {lastTwiml}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
