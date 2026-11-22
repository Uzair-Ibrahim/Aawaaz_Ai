import type { EntityResolutionResult } from '@awaaz/shared';
import { toAsciiDigits } from '../../../core/auth/auth-service';
import type { DataStore } from '../../../core/database/types';

export interface CandidatePersonRecord {
  id: string;
  user_id: string | null;
  display_name: string;
  cnic: string | null;
  phone: string | null;
  district: string | null;
}

export interface EntityResolutionInput {
  full_name?: string | null;
  cnic?: string | null;
  phone?: string | null;
  district?: string | null;
  exclude_user_id?: string | null;
  extra_candidates?: CandidatePersonRecord[];
}

const HONORIFIC_RE = /\b(syed|sayyed|haji|chaudhry|chaudhary|ch|mian|malik|sardar|bibi|begum|mr|mrs|ms|dr|janab|sahib|saab)\b/gi;

const PAKISTANI_VARIANT_MAP: Record<string, string> = {
  mohammad: 'muhammad',
  mohammed: 'muhammad',
  muhammed: 'muhammad',
  mohamed: 'muhammad',
  mohd: 'muhammad',
  muhd: 'muhammad',
  md: 'muhammad',
  m: 'muhammad',
  fatimah: 'fatima',
  fatma: 'fatima',
  zaynab: 'zainab',
  zainub: 'zainab',
  zenab: 'zainab',
  aisha: 'ayesha',
  aysha: 'ayesha',
  aiesha: 'ayesha',
  husain: 'hussain',
  hossein: 'hussain',
  husayn: 'hussain',
  othman: 'usman',
  osman: 'usman',
  shaikh: 'sheikh',
  shaykh: 'sheikh',
  rahman: 'rehman',
  rahmaan: 'rehman',
  abdul: 'abdul',
  abdal: 'abdul',
  ahmad: 'ahmed',
  ahmadullah: 'ahmedullah',
  mehmod: 'mehmood',
  mahmood: 'mehmood',
  mahmud: 'mehmood',
  yusuf: 'yousaf',
  yousuf: 'yousaf',
  yosef: 'yousaf',
  salmaan: 'salman',
  suleman: 'sulaiman',
  suleiman: 'sulaiman',
  zubayr: 'zubair',
  tarique: 'tariq',
  tarik: 'tariq',
  imraan: 'imran',
  uzayr: 'uzair',
  ibraheem: 'ibrahim',
  khalid: 'khalid',
  khaleed: 'khalid',
  nadeem: 'nadim',
  wasim: 'waseem',
  naveed: 'navid',
  sajid: 'sajid',
  sajeed: 'sajid',
  zahra: 'zehra',
  zahrah: 'zehra',
};

function safeString(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  return '';
}

export function normalizeCnicDigits(raw: unknown): string | null {
  const s = toAsciiDigits(safeString(raw)).replace(/[^0-9A-Za-z-]/g, '').trim();
  if (!s) return null;
  const digits = s.replace(/\D/g, '');
  if (digits.length === 13) {
    return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`;
  }
  if (/^MOCK-ID-[A-Z0-9-]+$/i.test(s)) {
    return s.toUpperCase();
  }
  return digits.length >= 8 ? digits : null;
}

export function normalizePhoneDigits(raw: unknown): string | null {
  const digits = toAsciiDigits(safeString(raw)).replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('92') && digits.length === 12) return `0${digits.slice(2)}`;
  if (digits.startsWith('03') && digits.length === 11) return digits;
  return digits.length >= 10 ? digits.slice(-10) : null;
}

export function normalizePakistaniName(raw: unknown): string {
  const cleaned = toAsciiDigits(safeString(raw))
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[.,_/-]+/g, ' ')
    .replace(HONORIFIC_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (!cleaned) return '';

  return cleaned
    .split(' ')
    .filter(Boolean)
    .map((tok) => PAKISTANI_VARIANT_MAP[tok] ?? tok)
    .join(' ');
}

function tokenSoundex(word: string): string {
  const clean = word.toUpperCase().replace(/[^A-Z]/g, '');
  if (!clean) return '';
  const map: Record<string, string> = {
    B: '1', F: '1', P: '1', V: '1',
    C: '2', G: '2', J: '2', K: '2', Q: '2', S: '2', X: '2', Z: '2',
    D: '3', T: '3',
    L: '4',
    M: '5', N: '5',
    R: '6',
  };
  let out = clean[0] ?? '';
  let prev = map[out] ?? '';
  for (let i = 1; i < clean.length; i++) {
    const code = map[clean[i] ?? ''] ?? '';
    if (code && code !== prev) {
      out += code;
    }
    prev = code;
  }
  return out.slice(0, 4).padEnd(4, '0');
}

export function computePakistaniPhoneticKey(rawName: unknown): string {
  const normalized = normalizePakistaniName(rawName);
  if (!normalized) return '';
  return normalized
    .split(' ')
    .filter(Boolean)
    .map((t) => tokenSoundex(t))
    .filter(Boolean)
    .join('-');
}

export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const dp: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prevDiag = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = dp[j]!;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prevDiag + cost);
      prevDiag = temp;
    }
  }
  return dp[b.length]!;
}

export function computeNameSimilarity(nameA: unknown, nameB: unknown): number {
  const normA = normalizePakistaniName(nameA);
  const normB = normalizePakistaniName(nameB);
  if (!normA || !normB) return 0;
  if (normA === normB) return 1;

  const maxLen = Math.max(normA.length, normB.length);
  const levSim = Math.max(0, 1 - levenshteinDistance(normA, normB) / Math.max(1, maxLen));

  const phonA = computePakistaniPhoneticKey(normA);
  const phonB = computePakistaniPhoneticKey(normB);
  const phonBonus = phonA && phonA === phonB ? 0.94 : 0;

  return Number(Math.max(levSim, phonBonus).toFixed(3));
}

/**
 * MODULE 3 — CHALLENGE 03: BAD DATA, PHONETIC NAME VARIANTS & SAFE 3-WAY ENTITY RESOLUTION
 * Never crashes on null, empty, Urdu digits, or malformed inputs.
 */
export class EntityResolutionService {
  constructor(private readonly store: DataStore) {}

  async resolvePerson(
    organizationId: string,
    input: EntityResolutionInput,
  ): Promise<EntityResolutionResult> {
    const rawName = safeString(input?.full_name).trim();
    const normName = normalizePakistaniName(rawName);
    const phoneticKey = computePakistaniPhoneticKey(rawName);
    const normCnic = normalizeCnicDigits(input?.cnic);
    const normPhone = normalizePhoneDigits(input?.phone);
    const normDistrict = safeString(input?.district).trim().toLowerCase() || null;

    // Graceful bad-data guard: never crash on completely empty/malformed inputs
    if (!normName && !normCnic && !normPhone) {
      return {
        classification: 'NO_MATCH',
        match_confidence: 0,
        normalized_input_name: '',
        phonetic_key: '',
        matched_citizen_id: null,
        matched_display_name: null,
        matched_cnic: null,
        similarity_score: 0,
        should_block_submission: false,
        requires_human_review: false,
        explanation: 'Insufficient non-empty identity fields provided; handled safely without error.',
        side_by_side_comparison: null,
      };
    }

    const candidates: CandidatePersonRecord[] = [];
    const [citizens, members] = await Promise.all([
      this.store.listCitizens(organizationId),
      this.store.listOrganizationMembers(organizationId),
    ]);
    const profileByUserId = new Map(members.map((m) => [m.profile.id, m.profile]));

    for (const c of citizens) {
      if (input.exclude_user_id && c.user_id && c.user_id === input.exclude_user_id) {
        continue;
      }
      const prof = c.user_id ? profileByUserId.get(c.user_id) : undefined;
      candidates.push({
        id: c.id,
        user_id: c.user_id,
        display_name: c.display_name,
        cnic: normalizeCnicDigits(c.mock_identity_reference),
        phone: normalizePhoneDigits(prof?.phone_number ?? null),
        district: null,
      });
    }

    if (Array.isArray(input.extra_candidates)) {
      for (const extra of input.extra_candidates) {
        if (!extra) continue;
        candidates.push({
          id: safeString(extra.id) || 'candidate',
          user_id: extra.user_id ?? null,
          display_name: safeString(extra.display_name),
          cnic: normalizeCnicDigits(extra.cnic),
          phone: normalizePhoneDigits(extra.phone),
          district: safeString(extra.district).trim().toLowerCase() || null,
        });
      }
    }

    // 1. CASE A: Exact CNIC match (even with Pakistani spelling variants like "Muhammad Ali" vs "Mohammad Ali")
    if (normCnic) {
      const exactCnicMatch = candidates.find((cand) => cand.cnic && cand.cnic === normCnic);
      if (exactCnicMatch) {
        const nameSim = computeNameSimilarity(rawName, exactCnicMatch.display_name);
        const confidence = Number(Math.max(0.95, 0.95 + nameSim * 0.05).toFixed(2));
        return {
          classification: 'EXACT_DUPLICATE_PERSON',
          match_confidence: confidence,
          normalized_input_name: normName,
          phonetic_key: phoneticKey,
          matched_citizen_id: exactCnicMatch.id,
          matched_display_name: exactCnicMatch.display_name,
          matched_cnic: exactCnicMatch.cnic,
          similarity_score: nameSim,
          should_block_submission: true,
          requires_human_review: true,
          explanation: `Exact CNIC match (${normCnic}) with existing record "${exactCnicMatch.display_name}" (name similarity ${Math.round(nameSim * 100)}%). Blocked duplicate submission safely.`,
          side_by_side_comparison: {
            incoming: { name: rawName, cnic: normCnic, phone: normPhone, district: normDistrict },
            existing: {
              name: exactCnicMatch.display_name,
              cnic: exactCnicMatch.cnic,
              phone: exactCnicMatch.phone,
              district: exactCnicMatch.district,
            },
          },
        };
      }
    }

    // 2. Variant / Fuzzy Name Matches (similarity >= 0.82)
    let bestCandidate: CandidatePersonRecord | null = null;
    let bestSim = 0;
    for (const cand of candidates) {
      const sim = computeNameSimilarity(rawName, cand.display_name);
      if (sim > bestSim) {
        bestSim = sim;
        bestCandidate = cand;
      }
    }

    if (bestCandidate && bestSim >= 0.82) {
      const samePhone = Boolean(normPhone && bestCandidate.phone && normPhone === bestCandidate.phone);
      const sameDistrict = Boolean(normDistrict && bestCandidate.district && normDistrict === bestCandidate.district);
      const hasDifferentValidCnic = Boolean(normCnic && bestCandidate.cnic && normCnic !== bestCandidate.cnic);

      // CASE B: Similar/variant spelling + DIFFERENT valid CNIC + different phone -> DISTINCT PERSON (DO NOT MERGE / DO NOT BLOCK!)
      if (hasDifferentValidCnic && !samePhone) {
        return {
          classification: 'DISTINCT_PERSON_HOMONYM',
          match_confidence: Number(bestSim.toFixed(2)),
          normalized_input_name: normName,
          phonetic_key: phoneticKey,
          matched_citizen_id: bestCandidate.id,
          matched_display_name: bestCandidate.display_name,
          matched_cnic: bestCandidate.cnic,
          similarity_score: bestSim,
          should_block_submission: false,
          requires_human_review: false,
          explanation: `Verified distinct person despite similar spelling ("${rawName}" vs "${bestCandidate.display_name}", similarity ${Math.round(bestSim * 100)}%) because CNICs differ (${normCnic} ≠ ${bestCandidate.cnic}). Not merged and not blocked.`,
          side_by_side_comparison: {
            incoming: { name: rawName, cnic: normCnic, phone: normPhone, district: normDistrict },
            existing: {
              name: bestCandidate.display_name,
              cnic: bestCandidate.cnic,
              phone: bestCandidate.phone,
              district: bestCandidate.district,
            },
          },
        };
      }

      // CASE C: Similar/variant spelling + same phone OR missing/unclear CNIC in same district -> HUMAN REVIEW (no blind auto-block)
      if (samePhone || (!normCnic && (sameDistrict || !bestCandidate.district))) {
        return {
          classification: 'POSSIBLE_DUPLICATE_NEEDS_HUMAN',
          match_confidence: Number(Math.min(0.92, bestSim * 0.92).toFixed(2)),
          normalized_input_name: normName,
          phonetic_key: phoneticKey,
          matched_citizen_id: bestCandidate.id,
          matched_display_name: bestCandidate.display_name,
          matched_cnic: bestCandidate.cnic,
          similarity_score: bestSim,
          should_block_submission: false,
          requires_human_review: true,
          explanation: `Possible duplicate name variant ("${rawName}" vs "${bestCandidate.display_name}", similarity ${Math.round(bestSim * 100)}%) with ${samePhone ? 'matching phone number' : 'missing/unverified CNIC'}. Routed to Human Officer for side-by-side verification without auto-blocking.`,
          side_by_side_comparison: {
            incoming: { name: rawName, cnic: normCnic, phone: normPhone, district: normDistrict },
            existing: {
              name: bestCandidate.display_name,
              cnic: bestCandidate.cnic,
              phone: bestCandidate.phone,
              district: bestCandidate.district,
            },
          },
        };
      }
    }

    return {
      classification: 'NO_MATCH',
      match_confidence: 0,
      normalized_input_name: normName,
      phonetic_key: phoneticKey,
      matched_citizen_id: null,
      matched_display_name: null,
      matched_cnic: null,
      similarity_score: Number(bestSim.toFixed(3)),
      should_block_submission: false,
      requires_human_review: false,
      explanation: 'No duplicate person found in registry.',
      side_by_side_comparison: null,
    };
  }
}
