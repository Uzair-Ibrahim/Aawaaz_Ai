import type {
  LanguageCode,
  NluPrimaryIntent,
  RetrievedUniversalRagChunk,
  UniversalRagCollection,
  UniversalRagDocumentRecord,
} from '@awaaz/shared';
import type { AppEnv } from '../../../config/env';
import { toAsciiDigits } from '../../../core/auth/auth-service';
import type { DataStore } from '../../../core/database/types';
import type { AIProvider } from '../../../integrations/ai/provider';
import { SEED_NLU_EXEMPLARS } from './nlu-rag-service';

export const ALL_UNIVERSAL_RAG_COLLECTIONS: UniversalRagCollection[] = [
  'policy_and_services_kb',
  'scam_and_fraud_kb',
  'multilingual_nlu_slang_kb',
  'episodic_conversation_kb',
  'self_learning_corrections_kb',
];

const SEED_POLICY_AND_SERVICES: Array<{ title: string; content: string; language: LanguageCode; metadata: Record<string, unknown> }> = [
  {
    title: 'Relief Income Eligibility Cap (MOCK_RELIEF_01)',
    content:
      'Households with verified total monthly income of 25,000 PKR or below qualify for priority relief assistance (default mock grant 15,000 PKR; citizen may request between 500 and 100,000 PKR). Families earning above 25,000 PKR can still apply and are routed to human Officer review.',
    language: 'en',
    metadata: { source_ref: 'POL-ELIG-001', topic: 'income_limit' },
  },
  {
    title: 'آمدنی کی حد اور اہلیت کی پالیسی',
    content:
      'ریلیف امداد کے لیے گھر کی کل ماہانہ آمدنی 25,000 روپے یا اس سے کم ہونی چاہیے۔ شہری 500 سے 100,000 روپے کے درمیان امداد کی درخواست دے سکتے ہیں، اور تمام سرکاری ریلیف پروگرام 100 فیصد مفت ہیں۔',
    language: 'ur',
    metadata: { source_ref: 'POL-ELIG-001-UR', topic: 'income_limit' },
  },
  {
    title: 'Decision Bands & Evidence Score Routing',
    content:
      'Applications with evidence score >= 90/100 and no safety flags route directly to READY_FOR_OFFICER. Scores 70–89 route to NEEDS_MORE_INFO. Scores < 70 or high-risk flags route to NEEDS_HUMAN_REVIEW. AI never auto-approves or disburses real funds.',
    language: 'en',
    metadata: { source_ref: 'POL-BAND-002', topic: 'decision_bands' },
  },
  {
    title: 'فیصلہ بینڈ اور اسکورنگ پالیسی',
    content:
      '90 یا اس سے زیادہ ثبوتی اسکور والی درخواستیں فوراً محکمہ افسر (READY_FOR_OFFICER) کو چلی جاتی ہیں۔ 70 سے 89 اسکور پر مزید تفصیل مانگی جاتی ہے اور 70 سے کم پر انسانی جائزہ (NEEDS_HUMAN_REVIEW) ہوتا ہے۔ AI خود منظوری نہیں دیتا۔',
    language: 'ur',
    metadata: { source_ref: 'POL-BAND-002-UR', topic: 'decision_bands' },
  },
  {
    title: 'Required Identity & Verification Documents',
    content:
      'Citizens need a valid 13-digit CNIC (XXXXX-XXXXXXX-X or mock identity reference), Pakistani mobile number (03XXXXXXXXX), district name, monthly household income, relief amount, and brief reason. Uploading a synthetic CNIC card or utility/income proof raises evidence completeness score.',
    language: 'en',
    metadata: { source_ref: 'POL-DOCS-003', topic: 'documents' },
  },
  {
    title: 'ضروری کاغذات اور شناختی کارڈ کی تفصیل',
    content:
      'درخواست کے لیے 13 ہندسوں کا شناختی کارڈ (CNIC)، پاکستانی موبائل نمبر، ضلع، ماہانہ آمدنی، مطلوبہ رقم اور امداد کی وجہ ضروری ہے۔ شناختی کارڈ یا آمدنی کا ثبوت اپ لوڈ کرنے سے ثبوتی اسکور بڑھتا ہے۔',
    language: 'ur',
    metadata: { source_ref: 'POL-DOCS-003-UR', topic: 'documents' },
  },
  {
    title: 'Zero-Fee & Anti-Corruption Guarantee',
    content:
      'Amaanat / Awaaz relief assistance, registration, voice signup, status checking, and Department Officer inquiries are 100% FREE. No officer, helper, or agent is allowed to charge any registration fee, commission, or request OTP codes.',
    language: 'en',
    metadata: { source_ref: 'POL-FREE-004', topic: 'zero_fee_policy' },
  },
  {
    title: '100% مفت سرکاری امداد اور شکایت پالیسی',
    content:
      'امانت آواز ریلیف رجسٹریشن، درخواست، اسٹیٹس چیک اور محکمہ افسر سے رابطہ مکمل طور پر مفت ہے۔ کوئی افسر یا ایجنٹ فیس یا OTP کوڈ نہیں مانگ سکتا۔',
    language: 'ur',
    metadata: { source_ref: 'POL-FREE-004-UR', topic: 'zero_fee_policy' },
  },
  {
    title: 'Flood, Widow, Medical & Emergency Relief Categories',
    content:
      'Supported relief categories include flood_relief (barish/sailab house or wall damage), widow_support (bewa assistance), medical_relief (urgent hospital/medicine aid), and emergency_cash (unemployment/ration).',
    language: 'en',
    metadata: { source_ref: 'POL-CAT-005', topic: 'categories' },
  },
  {
    title: 'Direct Department Officer Q&A & Human Escalation',
    content:
      'Authenticated citizens can ask Officer Hamza directly via Voice Saathi (returns INQ-XXXXXX tracking ID) and check official replies anytime. Requests outside AI authority (forcing approval, bank transfers, NADRA record edits, claim appeals) are escalated to Admin Ayesha or Officer Hamza with an ESC-XXXXXX ticket.',
    language: 'en',
    metadata: { source_ref: 'POL-ESC-006', topic: 'officer_and_escalation' },
  },
  {
    title: 'Role-Based Portal Access & Security (RBAC)',
    content:
      'Normal Citizens use /citizen (and voice signup/login). Department Officers use /officer to review cases and answer citizen inquiries. Super Admins use /admin for metrics, rules, audit trails, escalations, and RAG memory. Community Helpers assist citizens only after explicit revocable helper delegation consent.',
    language: 'en',
    metadata: { source_ref: 'POL-RBAC-007', topic: 'portal_navigation' },
  },
  {
    title: 'Consent Withdrawal & Data Privacy Rights',
    content:
      'Every relief submission requires explicit citizen consent. Citizens may review or withdraw processing or helper-delegation consent at any time; withdrawal revokes helper access immediately.',
    language: 'en',
    metadata: { source_ref: 'POL-CONSENT-008', topic: 'consent' },
  },
];

const SEED_SCAM_AND_FRAUD: Array<{ title: string; content: string; language: LanguageCode; metadata: Record<string, unknown> }> = [
  {
    title: 'Fake 8171 Registration Fee SMS Scam',
    content:
      'HIGH RISK SCAM: Messages claiming "Congratulations you won 25,000 PKR BISP/8171 grant, send Rs 500 or Rs 1000 registration fee via EasyPaisa or JazzCash" are 100% FRAUD. Official 8171 messages NEVER ask for any fee or money transfer.',
    language: 'en',
    metadata: { risk_level: 'HIGH', pattern: 'fake_8171_fee' },
  },
  {
    title: 'جعلی 8171 اور فیس اسکیم فراڈ',
    content:
      'انتہائی خطرناک فراڈ: اگر کوئی 8171، BISP یا احساس پروگرام کے نام پر 500 روپے فیس، ایزی پیسہ یا جاز کیش پیسے مانگے تو یہ 100 فیصد جعلی اسکیم ہے۔ سرکاری امداد بالکل مفت ہے، کبھی پیسے نہ بھیجیں۔',
    language: 'ur',
    metadata: { risk_level: 'HIGH', pattern: 'fake_8171_fee_ur' },
  },
  {
    title: 'Fake OTP / Secret PIN Theft Call & SMS',
    content:
      'HIGH RISK SCAM: Anyone asking for your 4-digit PIN, 6-digit OTP verification code, or bank password over SMS, WhatsApp, or phone call to "release relief payment" is a scammer attempting account takeover. NEVER share OTP or PIN codes.',
    language: 'en',
    metadata: { risk_level: 'HIGH', pattern: 'otp_theft' },
  },
  {
    title: 'OTP اور خفیہ PIN کوڈ چوری کا فراڈ',
    content:
      'خبردار: کوئی بھی سرکاری افسر یا امانت سسٹم آپ سے OTP کوڈ یا خفیہ PIN نہیں مانگتا۔ OTP مانگنے والا میسج یا کال جعلی فراڈ ہے، اپنا کوڈ کسی کو ہرگز نہ بتائیں۔',
    language: 'ur',
    metadata: { risk_level: 'HIGH', pattern: 'otp_theft_ur' },
  },
  {
    title: 'Shortened Phishing Link / Fake WhatsApp Portal Scam',
    content:
      'HIGH RISK SCAM: Unofficial shortened links (bit.ly, tinyurl, WhatsApp personal numbers +923XX) claiming instant cash disbursement steal CNIC and banking data. Only trust verified government portals and official shortcodes.',
    language: 'en',
    metadata: { risk_level: 'HIGH', pattern: 'phishing_link' },
  },
  {
    title: 'Lottery / Jeeto Prize Bait Impersonation',
    content:
      'HIGH RISK SCAM: Messages saying "Mubarak ho aapka 25,000 inam / lottery nikla hai, link par click karein" are impersonation phishing scams. Relief programs are needs-based, never lotteries.',
    language: 'ur',
    metadata: { risk_level: 'HIGH', pattern: 'lottery_bait' },
  },
  {
    title: 'Fake Officer Impersonation & CNIC Update Scam',
    content:
      'HIGH RISK SCAM: Callers posing as NADRA or BISP officers demanding money to "unlock blocked CNIC" or "fast-track approval" are scammers. Report suspicious messages via Amaanat Scam Check.',
    language: 'en',
    metadata: { risk_level: 'HIGH', pattern: 'impersonation_call' },
  },
];

const EXTRA_PAKISTANI_SLANG_EXEMPLARS: Array<{
  raw_utterance: string;
  resolved_intent: NluPrimaryIntent;
  target_field: string | null;
  clean_value: string | number | boolean | null;
  language: LanguageCode;
}> = [
  { raw_utterance: 'main aam user hoon account login karna hai', resolved_intent: 'SWITCH_TASK', target_field: null, clean_value: 'login', language: 'ur' },
  { raw_utterance: 'username citizen_zainab aur password citizen123 hai', resolved_intent: 'PROVIDE_FIELD', target_field: 'login_credentials', clean_value: 'citizen_zainab', language: 'ur' },
  { raw_utterance: 'mujhe relief form fill karna hai mera district Multan aur monthly income 15 hazaar hai', resolved_intent: 'PROVIDE_FIELD', target_field: 'monthly_income', clean_value: 15000, language: 'ur' },
  { raw_utterance: 'mera status check karo aur scam OTP policy batao', resolved_intent: 'ASK_STATUS', target_field: null, clean_value: null, language: 'ur' },
  { raw_utterance: 'please switch to English', resolved_intent: 'SWITCH_TASK', target_field: 'language', clean_value: 'en', language: 'en' },
  { raw_utterance: 'ab dobara Urdu mein baat karein', resolved_intent: 'SWITCH_TASK', target_field: 'language', clean_value: 'ur', language: 'ur' },
  { raw_utterance: 'english mein baat karo bhai', resolved_intent: 'SWITCH_TASK', target_field: 'language', clean_value: 'en', language: 'ur' },
  { raw_utterance: 'sindhi mein baat karo', resolved_intent: 'SWITCH_TASK', target_field: 'language', clean_value: 'sd', language: 'sd' },
  { raw_utterance: 'punjabi vich gal karo', resolved_intent: 'SWITCH_TASK', target_field: 'language', clean_value: 'pa', language: 'pa' },
  { raw_utterance: 'pashto bolain', resolved_intent: 'SWITCH_TASK', target_field: 'language', clean_value: 'ps', language: 'ps' },
  { raw_utterance: 'balochi mein baat karo', resolved_intent: 'SWITCH_TASK', target_field: 'language', clean_value: 'bal', language: 'bal' },
  { raw_utterance: 'yr is field main tumne ye cheez sahi nhi likhi wapis jao', resolved_intent: 'ROLLBACK_LAST_FIELD', target_field: null, clean_value: null, language: 'ur' },
  { raw_utterance: 'nahi bhai income 12000 kar do 15 hazaar ghalat hai', resolved_intent: 'INLINE_CORRECTION', target_field: 'monthly_income', clean_value: 12000, language: 'ur' },
  { raw_utterance: 'haan submit kar dein meri application', resolved_intent: 'CONFIRM_SUBMIT', target_field: 'consent_confirmed', clean_value: true, language: 'ur' },
  { raw_utterance: 'main department officer hoon login karna hai', resolved_intent: 'SWITCH_TASK', target_field: null, clean_value: 'officer', language: 'ur' },
  { raw_utterance: 'main admin hoon admin portal kholo', resolved_intent: 'SWITCH_TASK', target_field: null, clean_value: 'admin', language: 'ur' },
  { raw_utterance: 'main community helper hoon', resolved_intent: 'SWITCH_TASK', target_field: null, clean_value: 'helper', language: 'ur' },
  { raw_utterance: 'ruko pehle ye 8171 wala message check karo scam to nahi', resolved_intent: 'SCAM_CHECK', target_field: null, clean_value: null, language: 'ur' },
  { raw_utterance: 'eligibility rules aur income limit kya hai relief ke liye', resolved_intent: 'POLICY_RAG', target_field: null, clean_value: null, language: 'ur' },
  { raw_utterance: 'haan wapis mera adhoora form mukammal karo', resolved_intent: 'SWITCH_TASK', target_field: null, clean_value: 'resume', language: 'ur' },
];

function tokenizeUniversal(text: string): Map<string, number> {
  const norm = toAsciiDigits(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const vec = new Map<string, number>();
  if (!norm) return vec;

  const words = norm.split(' ').filter((w) => w.length >= 2);
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    vec.set(`w:${w}`, (vec.get(`w:${w}`) ?? 0) + 2.2);
    if (i + 1 < words.length) {
      const bg = `${w}_${words[i + 1]}`;
      vec.set(`b:${bg}`, (vec.get(`b:${bg}`) ?? 0) + 2.8);
    }
  }

  const padded = ` ${norm.slice(0, 260)} `;
  for (let i = 0; i <= padded.length - 3; i++) {
    const tri = padded.slice(i, i + 3);
    if (tri.trim().length >= 2) {
      vec.set(`c:${tri}`, (vec.get(`c:${tri}`) ?? 0) + 0.55);
    }
  }
  return vec;
}

function sparseCosine(a: Map<string, number>, b: Map<string, number>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (const [k, v] of a) {
    magA += v * v;
    const bv = b.get(k);
    if (bv !== undefined) dot += v * bv;
  }
  for (const v of b.values()) magB += v * v;
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

function denseCosine(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    const va = a[i] ?? 0;
    const vb = b[i] ?? 0;
    dot += va * vb;
    magA += va * va;
    magB += vb * vb;
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * PHASE 3: UNIVERSAL HYBRID RAG ENGINE (5 Persistent Collections)
 * Powers EVERY turn of the LangGraph Voice Agent with zero-failure hybrid BM25/trigram + vector retrieval.
 */
export class UniversalRagService {
  private seeded = false;
  private vecCache = new Map<string, Map<string, number>>();
  private embeddingUnavailableUntil = 0;

  constructor(
    private readonly deps: {
      env: AppEnv;
      store: DataStore;
      aiProvider?: AIProvider;
    },
  ) {}

  async ensureSeeded(): Promise<void> {
    if (this.seeded) return;
    const existing = await this.deps.store.listUniversalRagDocuments();
    if (existing.length < 40) {
      // 1. Seed policy_and_services_kb
      for (const item of SEED_POLICY_AND_SERVICES) {
        await this.deps.store.upsertUniversalRagDocument({
          organization_id: null,
          collection: 'policy_and_services_kb',
          title: item.title,
          content: item.content,
          language: item.language,
          session_id: null,
          citizen_id: null,
          metadata: item.metadata,
          hit_count: 0,
          embedding: null,
        });
      }
      // 2. Seed scam_and_fraud_kb
      for (const item of SEED_SCAM_AND_FRAUD) {
        await this.deps.store.upsertUniversalRagDocument({
          organization_id: null,
          collection: 'scam_and_fraud_kb',
          title: item.title,
          content: item.content,
          language: item.language,
          session_id: null,
          citizen_id: null,
          metadata: item.metadata,
          hit_count: 0,
          embedding: null,
        });
      }
      // 3. Seed multilingual_nlu_slang_kb (84+ Pakistani colloquial & regional utterances)
      for (const ex of [...SEED_NLU_EXEMPLARS, ...EXTRA_PAKISTANI_SLANG_EXEMPLARS]) {
        await this.deps.store.upsertUniversalRagDocument({
          organization_id: null,
          collection: 'multilingual_nlu_slang_kb',
          title: `${ex.resolved_intent}${ex.target_field ? ` (${ex.target_field})` : ''}`,
          content: ex.raw_utterance,
          language: ex.language,
          session_id: null,
          citizen_id: null,
          metadata: {
            resolved_intent: ex.resolved_intent,
            target_field: ex.target_field,
            clean_value: ex.clean_value,
            source: 'SEED_EXEMPLAR',
          },
          hit_count: 0,
          embedding: null,
        });
      }
    }
    this.seeded = true;
  }

  private getSparseVec(doc: UniversalRagDocumentRecord): Map<string, number> {
    const cached = this.vecCache.get(doc.id);
    if (cached) return cached;
    const built = tokenizeUniversal(`${doc.title} ${doc.content}`);
    this.vecCache.set(doc.id, built);
    return built;
  }

  async searchUniversalRag(params: {
    query: string;
    organizationId?: string;
    collections?: UniversalRagCollection[];
    sessionId?: string;
    citizenId?: string;
    topKPerCollection?: number;
    maxTotal?: number;
  }): Promise<RetrievedUniversalRagChunk[]> {
    await this.ensureSeeded();
    const q = params.query.trim();
    if (!q) return [];

    const targetCollections = params.collections && params.collections.length > 0
      ? params.collections
      : ALL_UNIVERSAL_RAG_COLLECTIONS;

    const docs = await this.deps.store.listUniversalRagDocuments({
      organizationId: params.organizationId,
      collections: targetCollections,
      sessionId: params.sessionId,
      citizenId: params.citizenId,
    });
    if (docs.length === 0) return [];

    const querySparse = tokenizeUniversal(q);
    let queryDense: number[] | null = null;
    const hasAnyDense = docs.some((d) => Array.isArray(d.embedding) && d.embedding.length > 0);
    if (
      hasAnyDense &&
      this.deps.env.NODE_ENV !== 'test' &&
      this.deps.aiProvider?.isConfigured() &&
      Date.now() > this.embeddingUnavailableUntil
    ) {
      try {
        const res = await this.deps.aiProvider.embedTexts([q.slice(0, 300)]);
        if (res[0] && res[0].length > 0) queryDense = res[0];
      } catch {
        this.embeddingUnavailableUntil = Date.now() + 10 * 60 * 1000;
      }
    }

    const perColLimit = params.topKPerCollection ?? 2;
    const byCol = new Map<UniversalRagCollection, RetrievedUniversalRagChunk[]>();

    for (const doc of docs) {
      const sparseScore = sparseCosine(querySparse, this.getSparseVec(doc));
      const denseScore =
        queryDense && Array.isArray(doc.embedding) && doc.embedding.length === queryDense.length
          ? denseCosine(queryDense, doc.embedding)
          : null;
      const base = denseScore !== null ? sparseScore * 0.55 + denseScore * 0.45 : sparseScore;
      const collectionBoost =
        doc.collection === 'self_learning_corrections_kb'
          ? 0.06
          : doc.collection === 'episodic_conversation_kb'
            ? 0.03
            : 0;
      const score = Math.min(1, Number((base + collectionBoost).toFixed(4)));
      if (score < 0.07) continue;

      const list = byCol.get(doc.collection) ?? [];
      list.push({
        id: doc.id,
        collection: doc.collection,
        title: doc.title,
        snippet: doc.content.slice(0, 240),
        score,
        language: doc.language,
        metadata: doc.metadata,
      });
      byCol.set(doc.collection, list);
    }

    const results: RetrievedUniversalRagChunk[] = [];
    for (const [, list] of byCol) {
      list.sort((a, b) => b.score - a.score);
      results.push(...list.slice(0, perColLimit));
    }
    results.sort((a, b) => b.score - a.score);
    const finalChunks = results.slice(0, params.maxTotal ?? 8);

    for (const hit of finalChunks.slice(0, 5)) {
      if (hit.score >= 0.14) {
        await this.deps.store.incrementUniversalRagHit(hit.id);
      }
    }

    return finalChunks;
  }

  async indexEpisodicTurn(params: {
    organizationId: string;
    sessionId: string;
    citizenId?: string | null;
    language: LanguageCode;
    stage: string;
    userText: string;
    intent: string;
    fieldsSummary?: string;
  }): Promise<UniversalRagDocumentRecord | null> {
    const clean = params.userText.trim();
    if (clean.length < 4) return null;
    await this.ensureSeeded();
    const content = `Stage=${params.stage} | Intent=${params.intent} | User="${clean.slice(0, 240)}"${params.fieldsSummary ? ` | Saved=${params.fieldsSummary}` : ''}`;
    const saved = await this.deps.store.upsertUniversalRagDocument({
      organization_id: params.organizationId,
      collection: 'episodic_conversation_kb',
      title: `Session Turn (${params.stage}/${params.intent})`,
      content,
      language: params.language,
      session_id: params.sessionId,
      citizen_id: params.citizenId ?? null,
      metadata: {
        stage: params.stage,
        intent: params.intent,
        fields_summary: params.fieldsSummary ?? '',
      },
      hit_count: 0,
      embedding: null,
    });
    this.vecCache.set(saved.id, tokenizeUniversal(`${saved.title} ${saved.content}`));
    return saved;
  }

  async saveLearnedCorrection(params: {
    organizationId: string;
    source: 'LEARNED_FROM_CORRECTION' | 'LEARNED_FROM_CONFIRMATION';
    rawUtterance: string;
    resolvedIntent: NluPrimaryIntent;
    targetField: string | null;
    cleanValue: string | number | boolean | null;
    language: LanguageCode;
    sessionId?: string | null;
    citizenId?: string | null;
  }): Promise<UniversalRagDocumentRecord | null> {
    const raw = params.rawUtterance.trim();
    if (raw.length < 3) return null;
    await this.ensureSeeded();

    let embedding: number[] | null = null;
    if (
      this.deps.env.NODE_ENV !== 'test' &&
      this.deps.aiProvider?.isConfigured() &&
      Date.now() > this.embeddingUnavailableUntil
    ) {
      try {
        const res = await this.deps.aiProvider.embedTexts([raw.slice(0, 260)]);
        if (res[0] && res[0].length > 0) embedding = res[0];
      } catch {
        this.embeddingUnavailableUntil = Date.now() + 10 * 60 * 1000;
      }
    }

    const saved = await this.deps.store.upsertUniversalRagDocument({
      organization_id: params.organizationId,
      collection: 'self_learning_corrections_kb',
      title: `${params.source}: ${params.resolvedIntent}${params.targetField ? ` [${params.targetField}]` : ''}`,
      content: raw,
      language: params.language,
      session_id: params.sessionId ?? null,
      citizen_id: params.citizenId ?? null,
      metadata: {
        source: params.source,
        resolved_intent: params.resolvedIntent,
        target_field: params.targetField,
        clean_value: params.cleanValue,
      },
      hit_count: 1,
      embedding,
    });
    this.vecCache.set(saved.id, tokenizeUniversal(`${saved.title} ${saved.content}`));

    // Keep legacy agent_nlu_rag_memory table mirrored so existing admin endpoints stay 100% synced
    await this.deps.store.upsertAgentNluRagMemory({
      organization_id: params.organizationId,
      source: params.source,
      raw_utterance: raw,
      resolved_intent: params.resolvedIntent,
      target_field: params.targetField,
      clean_value: params.cleanValue,
      language: params.language,
      hit_count: 1,
      embedding,
    });

    return saved;
  }

  async getAdminExplorerStats(organizationId?: string): Promise<{
    total_documents: number;
    total_hits: number;
    collections_summary: Array<{
      collection: UniversalRagCollection;
      count: number;
      hits: number;
    }>;
    documents: UniversalRagDocumentRecord[];
  }> {
    await this.ensureSeeded();
    const docs = await this.deps.store.listUniversalRagDocuments({ organizationId });
    const summaryMap = new Map<UniversalRagCollection, { count: number; hits: number }>();
    for (const col of ALL_UNIVERSAL_RAG_COLLECTIONS) {
      summaryMap.set(col, { count: 0, hits: 0 });
    }
    let totalHits = 0;
    for (const d of docs) {
      const entry = summaryMap.get(d.collection);
      if (entry) {
        entry.count += 1;
        entry.hits += d.hit_count || 0;
      }
      totalHits += d.hit_count || 0;
    }

    return {
      total_documents: docs.length,
      total_hits: totalHits,
      collections_summary: ALL_UNIVERSAL_RAG_COLLECTIONS.map((col) => ({
        collection: col,
        count: summaryMap.get(col)?.count ?? 0,
        hits: summaryMap.get(col)?.hits ?? 0,
      })),
      documents: docs,
    };
  }
}
