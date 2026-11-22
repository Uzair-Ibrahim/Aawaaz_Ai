import type { LanguageCode, LanguageGuardStatus } from '@awaaz/shared';
import type { AIProvider } from '../../../integrations/ai/provider';

/**
 * PHASE 1: HARD LANGUAGE LOCK & ANTI-FLIP ENGINE
 *
 * Guarantees rock-solid language stickiness across Pakistani multilingual + English loanword
 * code-switching ("Main aam user hoon, account login karna hai", "district Multan aur monthly income 15 hazaar hai",
 * "Mera status check karo aur scam OTP policy batao").
 *
 * Language ONLY changes in 2 cases:
 *  1. Explicit UI language click OR explicit voice switch command ("Please switch to English", "Ab dobara Urdu mein baat karein")
 *  2. Pure sustained full-sentence switch (>= 4 non-loanword words in another language with >= 0.92 confidence AND zero markers of locked language)
 */

export const PAKISTANI_ENGLISH_LOANWORDS = new Set([
  'form',
  'cnic',
  'id',
  'card',
  'account',
  'login',
  'logout',
  'signup',
  'register',
  'status',
  'district',
  'city',
  'officer',
  'department',
  'dept',
  'admin',
  'administrator',
  'helper',
  'community',
  'scam',
  'fake',
  'fraud',
  'otp',
  'pin',
  'password',
  'passcode',
  'username',
  'user',
  'normal',
  'citizen',
  'submit',
  'edit',
  'update',
  'change',
  'back',
  'field',
  'fields',
  'fill',
  'income',
  'monthly',
  'salary',
  'amount',
  'relief',
  'claim',
  'application',
  'apply',
  'reason',
  'number',
  'phone',
  'mobile',
  'email',
  'yes',
  'no',
  'ok',
  'okay',
  'check',
  'policy',
  'rules',
  'bank',
  'transfer',
  'approve',
  'approved',
  'rejected',
  'pending',
  'message',
  'sms',
  'fee',
  'fees',
  'pkr',
  'rs',
  'basically',
  'actually',
  'please',
  'sorry',
  'thanks',
  'thank',
  'direct',
  'reply',
  'ticket',
  'help',
  'voice',
  'nadra',
  'bisp',
  'ehsaas',
  'jazzcash',
  'easypaisa',
  'citizen_zainab',
  'officer_hamza',
  'admin_ayesha',
  'helper_salma',
  'auditor_bilal',
  'citizen123',
  'officer123',
  'admin123',
  'helper123',
  'auditor123',
]);

export const ROMAN_URDU_MARKERS = new Set([
  'mera',
  'meri',
  'mere',
  'mujhe',
  'mujh',
  'main',
  'mein',
  'me',
  'naam',
  'hai',
  'he',
  'hain',
  'hoon',
  'hun',
  'ho',
  'kar',
  'kr',
  'karo',
  'krna',
  'karna',
  'karni',
  'karein',
  'karin',
  'karke',
  'dein',
  'den',
  'do',
  'dijiye',
  'nahi',
  'nahin',
  'nhi',
  'haan',
  'han',
  'hanji',
  'ji',
  'jee',
  'bhai',
  'yaar',
  'yr',
  'yar',
  'aap',
  'ap',
  'aapka',
  'apna',
  'apni',
  'kya',
  'kia',
  'wapis',
  'wapas',
  'peeche',
  'piche',
  'pichli',
  'pichla',
  'jao',
  'batao',
  'bataein',
  'batayein',
  'bhejo',
  'bhej',
  'poocho',
  'pucho',
  'pooch',
  'sawal',
  'jawab',
  'aaya',
  'aya',
  'zila',
  'shehar',
  'shahar',
  'ghar',
  'rupay',
  'rupees',
  'hazaar',
  'hazar',
  'saade',
  'saarhe',
  'pachis',
  'pachees',
  'barah',
  'pandrah',
  'pandra',
  'atharah',
  'bees',
  'chaar',
  'paanch',
  'amdan',
  'amdani',
  'mahana',
  'imdad',
  'madad',
  'darkhwast',
  'sailab',
  'barish',
  'tabah',
  'deewar',
  'chhat',
  'ghalat',
  'galat',
  'galti',
  'sahi',
  'theek',
  'thek',
  'tumne',
  'tum',
  'ye',
  'yeh',
  'wo',
  'woh',
  'us',
  'is',
  'isay',
  'isko',
  'cheez',
  'likhi',
  'likha',
  'likho',
  'pakar',
  'liya',
  'bol',
  'bolo',
  'bolain',
  'baat',
  'ab',
  'dobara',
  'dubara',
  'phir',
  'ruko',
  'pehle',
  'sab',
  'bilkul',
  'asal',
  'aam',
  'naya',
  'nayi',
  'bana',
  'banana',
  'banao',
  'hua',
  'hui',
  'aur',
  'se',
  'ko',
  'ka',
  'ki',
  'ke',
  'par',
  'per',
  'bhi',
  'to',
  'toh',
  'haiga',
  'banti',
  'taqreeban',
  'chahiye',
  'chahta',
  'chahti',
  'ijazat',
  'deti',
  'deta',
  'khud',
  'abhi',
  'badal',
  'badlo',
  'tabdeel',
  'mukammal',
  'kab',
  'hogi',
  'hoga',
  'paise',
  'paisay',
  'insaan',
  'faisla',
  'rehta',
  'rehti',
  'paas',
  'gir',
  'gayi',
  'gaya',
  'khana',
  'khanay',
]);

const PURE_ENGLISH_FUNCTION_WORDS = new Set([
  'the',
  'is',
  'are',
  'was',
  'were',
  'would',
  'could',
  'should',
  'have',
  'has',
  'had',
  'want',
  'need',
  'would',
  'like',
  'what',
  'where',
  'when',
  'which',
  'how',
  'who',
  'why',
  'my',
  'your',
  'our',
  'their',
  'this',
  'that',
  'these',
  'those',
  'from',
  'with',
  'about',
  'because',
  'there',
  'here',
  'can',
  'will',
  'shall',
  'must',
  'into',
  'over',
  'under',
  'between',
  'before',
  'after',
  'during',
  'through',
  'check',
  'tell',
  'give',
  'show',
  'know',
  'think',
  'live',
  'house',
  'damaged',
  'flood',
  'rain',
  'family',
  'members',
  'money',
  'assistance',
  'eligibility',
  'documents',
  'required',
  'incorrect',
  'wrong',
  'mistake',
  'previous',
  'confirm',
  'proceed',
  'forward',
  'create',
  'already',
]);

export interface ExplicitLanguageSwitchResult {
  target: LanguageCode;
  isPureSwitchCommand: boolean;
}

/**
 * Detects explicit language switch requests across all 6 languages so switching works IMMEDIATELY on 1 turn!
 */
export function detectExplicitLanguageSwitch(rawText: string): ExplicitLanguageSwitchResult | null {
  const t = rawText.trim();
  if (!t) return null;

  // Standalone single-word language name (e.g., on Language Selector or quick tap)
  if (/^(?:english|انگلش|انگریزی)$/i.test(t)) return { target: 'en', isPureSwitchCommand: true };
  if (/^(?:urdu|اردو)$/i.test(t)) return { target: 'ur', isPureSwitchCommand: true };
  if (/^(?:sindhi|سنڌي|سندھی)$/i.test(t)) return { target: 'sd', isPureSwitchCommand: true };
  if (/^(?:punjabi|پنجابی)$/i.test(t)) return { target: 'pa', isPureSwitchCommand: true };
  if (/^(?:pashto|pushto|پښتو|پشتو)$/i.test(t)) return { target: 'ps', isPureSwitchCommand: true };
  if (/^(?:balochi|بلوچی)$/i.test(t)) return { target: 'bal', isPureSwitchCommand: true };

  // English-phrased explicit switch commands
  const engSwitch = t.match(
    /\b(?:switch|change|talk|speak|reply|respond|continue|go\s+back|back)\s+(?:language\s+)?(?:to|in|into)\s+(english|urdu|sindhi|punjabi|pashto|pushto|balochi)\b/i,
  );
  if (engSwitch?.[1]) {
    const lang = mapLangName(engSwitch[1]);
    if (lang) return { target: lang, isPureSwitchCommand: t.split(/\s+/).length <= 10 };
  }

  // Roman Urdu / Urdu-phrased explicit switch commands:
  // "English mein baat karo", "Ab dobara Urdu mein baat karein", "Ab Urdu mein bolo", "Sindhi bolain", "Pashto mein baat karo"
  const romanSwitch = t.match(
    /\b(english|urdu|sindhi|punjabi|pashto|pushto|balochi)\s+(?:mein|main|me|wch|vich|khe)?\s*(?:baat|bolo|bolain|bol|likho|jawab|karo|karein|shuru)\b/i,
  );
  if (romanSwitch?.[1]) {
    const lang = mapLangName(romanSwitch[1]);
    if (lang) return { target: lang, isPureSwitchCommand: t.split(/\s+/).length <= 12 };
  }

  // Native script switch commands
  if (/(انگلش میں|انگریزی میں|انگلش بولیں|انگریزی بولیں)/.test(t)) {
    return { target: 'en', isPureSwitchCommand: t.split(/\s+/).length <= 12 };
  }
  if (/(اردو میں بات|اردو میں بولیں|اردو بولیں|اب اردو میں|دوبارہ اردو میں)/.test(t)) {
    return { target: 'ur', isPureSwitchCommand: t.split(/\s+/).length <= 12 };
  }
  if (/(سنڌي ۾ ڳالهايو|سندھی میں بات|سندھی بولیں)/.test(t)) {
    return { target: 'sd', isPureSwitchCommand: t.split(/\s+/).length <= 12 };
  }
  if (/(پنجابی وچ گل|پنجابی میں بات|پنجابی بولیں)/.test(t)) {
    return { target: 'pa', isPureSwitchCommand: t.split(/\s+/).length <= 12 };
  }
  if (/(پښتو کې خبرې|پشتو میں بات|پشتو بولیں)/.test(t)) {
    return { target: 'ps', isPureSwitchCommand: t.split(/\s+/).length <= 12 };
  }
  if (/(بلوچی ءَ گپ|بلوچی میں بات|بلوچی بولیں)/.test(t)) {
    return { target: 'bal', isPureSwitchCommand: t.split(/\s+/).length <= 12 };
  }

  return null;
}

function mapLangName(name: string): LanguageCode | null {
  const n = name.toLowerCase();
  if (n === 'english') return 'en';
  if (n === 'urdu') return 'ur';
  if (n === 'sindhi') return 'sd';
  if (n === 'punjabi') return 'pa';
  if (n === 'pashto' || n === 'pushto') return 'ps';
  if (n === 'balochi') return 'bal';
  return null;
}

export interface UtteranceLanguageAnalysis {
  detected_language: LanguageCode;
  confidence: number;
  roman_urdu_marker_count: number;
  pure_english_word_count: number;
  has_arabic_script: boolean;
}

export function analyzeUtteranceLanguage(text: string, fallback: LanguageCode): UtteranceLanguageAnalysis {
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      detected_language: fallback,
      confidence: 0.5,
      roman_urdu_marker_count: 0,
      pure_english_word_count: 0,
      has_arabic_script: false,
    };
  }

  // 1. Native script detection (Pashto, Sindhi, Balochi, Punjabi, Urdu)
  if (
    /[ښځڅډټړڼږ]/.test(trimmed) ||
    /(?:^|[\s،,.۔؟!])(زما|نوم|دی|یم|غواړم|مرسته|روپۍ|کورنۍ|ولسوالۍ)(?:$|[\s،,.۔؟!])/.test(trimmed)
  ) {
    return { detected_language: 'ps', confidence: 0.96, roman_urdu_marker_count: 0, pure_english_word_count: 0, has_arabic_script: true };
  }
  if (
    /[ٻڀٿٽڄڃڇڌڏڍڦڪڻ]/.test(trimmed) ||
    /(?:^|[\s،,.۔؟!])(منهنجو|نالو|آهي|آهيان|گهرجي|رپيا|ضلعي|رهان|ٻوڏ)(?:$|[\s،,.۔؟!])/.test(trimmed)
  ) {
    return { detected_language: 'sd', confidence: 0.96, roman_urdu_marker_count: 0, pure_english_word_count: 0, has_arabic_script: true };
  }
  if (/(?:^|[\s،,.۔؟!])(انت|کنت|وتئی|منی|وتی|لوٹ|ہئو)(?:$|[\s،,.۔؟!])|ءِ|ءَ/.test(trimmed)) {
    return { detected_language: 'bal', confidence: 0.95, roman_urdu_marker_count: 0, pure_english_word_count: 0, has_arabic_script: true };
  }
  if (
    /[\u0A00-\u0A7F]/.test(trimmed) ||
    /(?:^|[\s،,.۔؟!])(نیں|تہاڈا|ناں|وچ|لئی|آں|اے|چاہیدی|چاہیدا|ضلعے|مہینے|تسی|رہندا)(?:$|[\s،,.۔؟!])|میرا ناں|جی آیاں/.test(trimmed)
  ) {
    return { detected_language: 'pa', confidence: 0.95, roman_urdu_marker_count: 0, pure_english_word_count: 0, has_arabic_script: true };
  }
  if (/[\u0600-\u06FF]/.test(trimmed)) {
    const isRegionalFallback = ['sd', 'pa', 'ps', 'bal'].includes(fallback);
    const hasExplicitUrdu = /(?:^|[\s،,.۔؟!])(میرا|میری|ہے|ہوں|کیونکہ|مجھے|چاہیے|آمدنی|درخواست)(?:$|[\s،,.۔؟!])/.test(trimmed);
    return {
      detected_language: isRegionalFallback && !hasExplicitUrdu ? fallback : 'ur',
      confidence: 0.96,
      roman_urdu_marker_count: 0,
      pure_english_word_count: 0,
      has_arabic_script: true,
    };
  }

  // 2. Roman script regional checks
  if (/\b(tuhada|mera naa|chaida|pind|vich|asi|tusi)\b/i.test(trimmed)) {
    return { detected_language: 'pa', confidence: 0.92, roman_urdu_marker_count: 0, pure_english_word_count: 0, has_arabic_script: false };
  }
  if (/\b(muhinjo|nalo|ahe|ahiyan|tawhan|tokhe|ghurje)\b/i.test(trimmed)) {
    return { detected_language: 'sd', confidence: 0.92, roman_urdu_marker_count: 0, pure_english_word_count: 0, has_arabic_script: false };
  }
  if (/\b(zama|num|pakhtun|ghwaram|taso)\b/i.test(trimmed)) {
    return { detected_language: 'ps', confidence: 0.92, roman_urdu_marker_count: 0, pure_english_word_count: 0, has_arabic_script: false };
  }

  // 3. Token-level Pakistani code-switching analysis (Roman Urdu vs Pure English!)
  const tokens = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9_'\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  let romanUrduMarkers = 0;
  let pureEnglishWords = 0;
  let nonLoanwordAlphaWords = 0;

  for (const tok of tokens) {
    if (/^\d+$/.test(tok) || /^(?:mock-id-\d+|\d{5}-\d{7}-\d|awz-[a-z0-9]+)$/i.test(tok)) continue;
    if (ROMAN_URDU_MARKERS.has(tok)) {
      romanUrduMarkers += 1;
    } else if (PAKISTANI_ENGLISH_LOANWORDS.has(tok)) {
      // Loanword is NEUTRAL — NEVER counts as English evidence against Urdu!
      continue;
    } else if (PURE_ENGLISH_FUNCTION_WORDS.has(tok)) {
      pureEnglishWords += 1;
      nonLoanwordAlphaWords += 1;
    } else if (/^[a-z]{3,}$/.test(tok)) {
      nonLoanwordAlphaWords += 1;
    }
  }

  // Any Roman Urdu marker -> Urdu! (Immune to English loanwords like "account login", "monthly income", "status check", "scam OTP policy")
  if (romanUrduMarkers >= 1) {
    return {
      detected_language: 'ur',
      confidence: Math.min(0.98, 0.8 + romanUrduMarkers * 0.05),
      roman_urdu_marker_count: romanUrduMarkers,
      pure_english_word_count: pureEnglishWords,
      has_arabic_script: false,
    };
  }

  // Pure sustained English sentence (>= 4 non-loanword words with >= 2 core English function words and ZERO Urdu markers)
  if (nonLoanwordAlphaWords >= 4 && pureEnglishWords >= 2) {
    return {
      detected_language: 'en',
      confidence: 0.94,
      roman_urdu_marker_count: 0,
      pure_english_word_count: pureEnglishWords,
      has_arabic_script: false,
    };
  }

  // Short / neutral utterances (numbers, CNICs, names, single cities, loanword-only phrases like "login citizen_zainab", "ok", "yes"):
  // Preserve fallback / locked language!
  return {
    detected_language: fallback,
    confidence: 0.65,
    roman_urdu_marker_count: 0,
    pure_english_word_count: pureEnglishWords,
    has_arabic_script: false,
  };
}

export interface HardLanguageLockDecision {
  locked_language: LanguageCode;
  detected_utterance_language: LanguageCode;
  switched: boolean;
  is_pure_switch_command: boolean;
  switch_reason: string;
}

/**
 * PHASE 1 CORE: Sticky `locked_language` resolver.
 * Never flips on loanwords, numbers, usernames, city names, or Roman Urdu!
 */
export function resolveHardLanguageLock(params: {
  transcript: string;
  currentLockedLanguage: LanguageCode;
  wasLanguageLocked: boolean;
  uiLanguageHint?: LanguageCode;
  uiExplicitSwitch?: boolean;
  whisperDetectedLanguage?: LanguageCode;
}): HardLanguageLockDecision {
  const { transcript, currentLockedLanguage, wasLanguageLocked, uiLanguageHint, uiExplicitSwitch } = params;

  // CASE 1A: Explicit UI language dropdown/card click -> instant switch!
  if (uiExplicitSwitch && uiLanguageHint) {
    return {
      locked_language: uiLanguageHint,
      detected_utterance_language: uiLanguageHint,
      switched: uiLanguageHint !== currentLockedLanguage,
      is_pure_switch_command: !transcript.trim(),
      switch_reason: 'explicit_ui_click',
    };
  }

  // CASE 1B: Explicit spoken language switch command -> instant 1-turn switch!
  const explicit = detectExplicitLanguageSwitch(transcript);
  if (explicit) {
    return {
      locked_language: explicit.target,
      detected_utterance_language: explicit.target,
      switched: explicit.target !== currentLockedLanguage,
      is_pure_switch_command: explicit.isPureSwitchCommand,
      switch_reason: 'explicit_voice_command',
    };
  }

  if (!transcript.trim()) {
    const lang = wasLanguageLocked ? currentLockedLanguage : (uiLanguageHint ?? currentLockedLanguage);
    return {
      locked_language: lang,
      detected_utterance_language: lang,
      switched: false,
      is_pure_switch_command: false,
      switch_reason: 'no_transcript_preserve_lock',
    };
  }

  const baseLang = wasLanguageLocked ? currentLockedLanguage : (uiLanguageHint ?? currentLockedLanguage);
  const analysis = analyzeUtteranceLanguage(transcript, baseLang);

  // If language was NOT yet locked (very first clear turn), lock to detected language (or UI hint if neutral)
  if (!wasLanguageLocked) {
    const initialLock = analysis.confidence >= 0.8 ? analysis.detected_language : baseLang;
    return {
      locked_language: initialLock,
      detected_utterance_language: analysis.detected_language,
      switched: initialLock !== currentLockedLanguage,
      is_pure_switch_command: false,
      switch_reason: 'initial_session_lock',
    };
  }

  // CASE 2: Already locked — ONLY allow auto-switch on a PURE sustained full sentence (>= 4 words, >= 0.92 confidence, ZERO markers of locked language)!
  const wordCount = transcript.trim().split(/\s+/).length;
  if (analysis.detected_language !== currentLockedLanguage && analysis.confidence >= 0.92 && wordCount >= 4) {
    // Extra Pakistani immunity guard: NEVER flip away from Urdu/regional to English if ANY Roman Urdu marker or Arabic script is present
    if (
      currentLockedLanguage !== 'en' &&
      analysis.detected_language === 'en' &&
      (analysis.roman_urdu_marker_count > 0 || analysis.has_arabic_script || analysis.pure_english_word_count < 3)
    ) {
      return {
        locked_language: currentLockedLanguage,
        detected_utterance_language: analysis.detected_language,
        switched: false,
        is_pure_switch_command: false,
        switch_reason: 'loanword_immunity_preserved_lock',
      };
    }

    // Extra guard: NEVER flip away from English to Urdu unless >= 3 Urdu markers or genuine Urdu script sentence
    if (
      currentLockedLanguage === 'en' &&
      analysis.detected_language === 'ur' &&
      !analysis.has_arabic_script &&
      analysis.roman_urdu_marker_count < 3
    ) {
      return {
        locked_language: currentLockedLanguage,
        detected_utterance_language: analysis.detected_language,
        switched: false,
        is_pure_switch_command: false,
        switch_reason: 'english_lock_preserved',
      };
    }

    return {
      locked_language: analysis.detected_language,
      detected_utterance_language: analysis.detected_language,
      switched: true,
      is_pure_switch_command: false,
      switch_reason: 'sustained_full_sentence_switch',
    };
  }

  return {
    locked_language: currentLockedLanguage,
    detected_utterance_language: analysis.detected_language,
    switched: false,
    is_pure_switch_command: false,
    switch_reason: 'sticky_language_lock_maintained',
  };
}

/**
 * PHASE 1 PRE-TTS OUTPUT CONSISTENCY GUARD:
 * Validates that `replyText` is strictly written in `lockedLanguage` before returning to Frontend/TTS.
 * If an LLM drifted into English while locked to Urdu (or into Urdu while locked to English),
 * rewrites it immediately into `lockedLanguage`!
 */
export function doesReplyMatchLockedLanguage(replyText: string, lockedLanguage: LanguageCode): boolean {
  const trimmed = replyText.trim();
  if (!trimmed) return false;

  const arabicScriptChars = (trimmed.match(/[\u0600-\u06FF]/g) ?? []).length;
  // Strip technical IDs/acronyms/numbers/proper names that naturally appear inside Urdu replies
  const withoutTechTokens = trimmed
    .replace(/\b(?:AWZ-[A-Z0-9]+|ESC-[A-Z0-9]+|INQ-[A-Z0-9]+|MOCK-ID-\d+|PKR|CNIC|PIN|OTP|SMS|AI|RAG|MCP|READY_FOR_OFFICER|NEEDS_MORE_INFO|NEEDS_HUMAN_REVIEW|APPROVED|REJECTED|OPEN|ANSWERED|IN_REVIEW|RESOLVED)\b/gi, ' ')
    .replace(/\b\d[\d,.-]*\b/g, ' ');
  const latinWords = (withoutTechTokens.match(/\b[A-Za-z]{3,}\b/g) ?? []).length;

  if (lockedLanguage === 'en') {
    // English replies must NEVER leak Urdu/Arabic script!
    return arabicScriptChars === 0;
  }

  // Urdu / Sindhi / Punjabi / Pashto / Balochi replies MUST contain native script and NOT drift into an English paragraph!
  if (arabicScriptChars < 8) return false;
  // If > 12 non-technical English words leaked with very few Urdu characters, flag drift!
  if (latinWords > 12 && arabicScriptChars < latinWords * 3) return false;
  return true;
}

export async function enforceReplyLanguageGuard(params: {
  replyText: string;
  lockedLanguage: LanguageCode;
  explicitSwitched: boolean;
  aiProvider?: AIProvider;
  nodeEnv: string;
  fallbackLocalizedReply?: string;
}): Promise<{ replyText: string; status: LanguageGuardStatus }> {
  const { replyText, lockedLanguage, explicitSwitched, aiProvider, nodeEnv, fallbackLocalizedReply } = params;

  if (doesReplyMatchLockedLanguage(replyText, lockedLanguage)) {
    return {
      replyText,
      status: explicitSwitched ? 'EXPLICIT_SWITCH_APPLIED' : 'PASSED',
    };
  }

  // Drift detected! Try fast LLM rewrite into locked_language when live AI provider is configured
  if (nodeEnv !== 'test' && aiProvider?.isConfigured() && aiProvider.generateStructuredJson) {
    const targetLangLabel: Record<LanguageCode, string> = {
      ur: 'natural conversational Urdu script (اردو)',
      en: 'clear natural English',
      sd: 'natural Sindhi script (سنڌي)',
      pa: 'natural Punjabi Shahmukhi script (پنجابی)',
      ps: 'natural Pashto script (پښتو)',
      bal: 'natural Balochi script (بلوچی)',
    };
    const rewritePrompt = [
      `Rewrite the assistant message strictly into ${targetLangLabel[lockedLanguage]}.`,
      'Preserve ALL numbers, reference codes (AWZ-..., ESC-..., INQ-...), names, amounts, CNICs, and exact meaning.',
      'Return STRICT JSON ONLY: { "rewritten_reply": "..." }',
      `ORIGINAL_REPLY: """${replyText}"""`,
    ].join('\n');

    const rewritten = await aiProvider.generateStructuredJson(rewritePrompt, 'Pre-TTS Language Guard Rewrite', 4500);
    const candidate = typeof rewritten?.rewritten_reply === 'string' ? rewritten.rewritten_reply.trim() : '';
    if (candidate && doesReplyMatchLockedLanguage(candidate, lockedLanguage)) {
      return { replyText: candidate, status: 'REWRITTEN_TO_LOCKED_LANG' };
    }
  }

  // Deterministic fallback localized reply guarantees ZERO language leakage even offline!
  if (fallbackLocalizedReply && doesReplyMatchLockedLanguage(fallbackLocalizedReply, lockedLanguage)) {
    return { replyText: fallbackLocalizedReply, status: 'REWRITTEN_TO_LOCKED_LANG' };
  }

  const safeFallback =
    lockedLanguage === 'en'
      ? 'I have saved your update and am ready to assist you. Please tell me how you would like to proceed.'
      : 'جی بالکل، آپ کی تفصیلات محفوظ ہو گئی ہیں۔ براہِ کرم بتائیں اب آگے میں آپ کی کیا مدد کروں؟';
  return { replyText: safeFallback, status: 'REWRITTEN_TO_LOCKED_LANG' };
}
