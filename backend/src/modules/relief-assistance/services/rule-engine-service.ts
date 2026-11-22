import crypto from 'node:crypto';
import type {
  CostTierEvaluationResult,
  DecisionTier,
  DynamicRuleVersionRecord,
  EntityResolutionResult,
  LanguageCode,
  StructuredUncertaintyCaseNotes,
} from '@awaaz/shared';
import type { AuditService } from '../../../core/audit/audit-service';
import type { AuthContext } from '../../../core/auth/auth-service';
import { AppError } from '../../../core/security/errors';

export interface PublishRuleVersionInput {
  max_monthly_income_pkr: number;
  act_alone_max_amount_pkr: number;
  ask_proof_max_amount_pkr: number;
  min_confidence_act_alone: number;
  min_confidence_ask_proof: number;
  false_approval_cost_pkr?: number;
  false_delay_cost_pkr?: number;
  wrongful_rejection_cost_pkr?: number;
  change_reason: string;
}

export interface ClaimCostEvaluationInput {
  amount_pkr: number;
  monthly_income_pkr: number;
  confidence_score?: number;
  language?: LanguageCode;
  has_supporting_document?: boolean;
  document_blurry_or_missing?: boolean;
  duplicate_result?: EntityResolutionResult | null;
  forgery_flagged?: boolean;
  conflicting_fields?: string[];
  missing_fields?: string[];
  model_version?: string;
}

/**
 * MODULES 1 & 2 — LIVE DYNAMIC RULE ENGINE + COST-BACKED 3-TIER DECISION MATRIX
 * - Evaluates every claim strictly against the active rule version in memory/DB (never hardcoded!).
 * - Publishes new immutable versions (v1.0 -> v1.1 -> v1.2) live with zero server restart.
 * - Preserves historical rule snapshots permanently on past claims.
 * - Produces explicit "I am not sure" uncertainty flags + structured officer case_notes.
 */
export class DynamicRuleEngineService {
  private versionsByOrg = new Map<string, DynamicRuleVersionRecord[]>();

  constructor(private readonly audit: AuditService) {}

  private ensureOrgSeeded(organizationId: string): DynamicRuleVersionRecord[] {
    let list = this.versionsByOrg.get(organizationId);
    if (!list || list.length === 0) {
      const v1: DynamicRuleVersionRecord = {
        id: crypto.randomUUID(),
        organization_id: organizationId,
        version: 'v1.0',
        is_active: true,
        max_monthly_income_pkr: 25000,
        act_alone_max_amount_pkr: 5000,
        ask_proof_max_amount_pkr: 12000,
        min_confidence_act_alone: 0.85,
        min_confidence_ask_proof: 0.65,
        false_approval_cost_pkr: 15000,
        false_delay_cost_pkr: 600,
        wrongful_rejection_cost_pkr: 4500,
        change_reason: 'Initial baseline policy v1.0 (cost ratio 25:1 false approval vs delay)',
        updated_by: 'System Seed',
        created_at: new Date().toISOString(),
      };
      list = [v1];
      this.versionsByOrg.set(organizationId, list);
    }
    return list;
  }

  getActiveRuleVersion(organizationId: string): DynamicRuleVersionRecord {
    const list = this.ensureOrgSeeded(organizationId);
    const active = list.find((r) => r.is_active) ?? list[0]!;
    return structuredClone(active);
  }

  listRuleVersions(organizationId: string): DynamicRuleVersionRecord[] {
    const list = this.ensureOrgSeeded(organizationId);
    return list.map((r) => structuredClone(r));
  }

  async publishNewRuleVersion(
    auth: AuthContext,
    input: PublishRuleVersionInput,
  ): Promise<{ active_version: DynamicRuleVersionRecord; history: DynamicRuleVersionRecord[] }> {
    if (auth.role !== 'admin') {
      throw new AppError(403, 'ADMIN_ONLY', 'Only an authorized Administrator may publish live policy rule versions.');
    }
    const reason = input.change_reason.trim();
    if (reason.length < 3) {
      throw new AppError(400, 'CHANGE_REASON_REQUIRED', 'Please provide a clear change_reason (at least 3 characters).');
    }
    if (input.act_alone_max_amount_pkr > input.ask_proof_max_amount_pkr) {
      throw new AppError(
        400,
        'INVALID_TIER_THRESHOLDS',
        'act_alone_max_amount_pkr must be less than or equal to ask_proof_max_amount_pkr.',
      );
    }
    if (input.min_confidence_ask_proof > input.min_confidence_act_alone) {
      throw new AppError(
        400,
        'INVALID_CONFIDENCE_THRESHOLDS',
        'min_confidence_ask_proof must be less than or equal to min_confidence_act_alone.',
      );
    }

    const list = this.ensureOrgSeeded(auth.organizationId);
    const prevActive = list.find((r) => r.is_active) ?? list[0]!;
    const nextMinor = list.length; // v1.0 -> v1.1 -> v1.2 ...
    const nextVersionTag = `v1.${nextMinor}`;

    for (const item of list) {
      item.is_active = false;
    }

    const created: DynamicRuleVersionRecord = {
      id: crypto.randomUUID(),
      organization_id: auth.organizationId,
      version: nextVersionTag,
      is_active: true,
      max_monthly_income_pkr: Math.max(0, Math.round(input.max_monthly_income_pkr)),
      act_alone_max_amount_pkr: Math.max(0, Math.round(input.act_alone_max_amount_pkr)),
      ask_proof_max_amount_pkr: Math.max(0, Math.round(input.ask_proof_max_amount_pkr)),
      min_confidence_act_alone: Math.min(1, Math.max(0.1, Number(input.min_confidence_act_alone))),
      min_confidence_ask_proof: Math.min(1, Math.max(0.1, Number(input.min_confidence_ask_proof))),
      false_approval_cost_pkr: Math.max(1, Math.round(input.false_approval_cost_pkr ?? prevActive.false_approval_cost_pkr)),
      false_delay_cost_pkr: Math.max(1, Math.round(input.false_delay_cost_pkr ?? prevActive.false_delay_cost_pkr)),
      wrongful_rejection_cost_pkr: Math.max(
        1,
        Math.round(input.wrongful_rejection_cost_pkr ?? prevActive.wrongful_rejection_cost_pkr),
      ),
      change_reason: reason,
      updated_by: auth.displayName,
      created_at: new Date().toISOString(),
    };

    list.unshift(created);

    await this.audit.log({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'dynamic_rule.version_published',
      resourceType: 'eligibility_rule_version',
      resourceId: created.id,
      metadata: {
        previous_version: prevActive.version,
        new_version: created.version,
        max_monthly_income_pkr: created.max_monthly_income_pkr,
        act_alone_max_amount_pkr: created.act_alone_max_amount_pkr,
        ask_proof_max_amount_pkr: created.ask_proof_max_amount_pkr,
        change_reason: created.change_reason,
      },
    });

    return {
      active_version: structuredClone(created),
      history: this.listRuleVersions(auth.organizationId),
    };
  }

  evaluateClaimWithCostMatrix(
    organizationId: string,
    input: ClaimCostEvaluationInput,
  ): CostTierEvaluationResult {
    const rule = this.getActiveRuleVersion(organizationId);
    const lang: LanguageCode = input.language ?? 'ur';
    const amount = Number.isFinite(input.amount_pkr) ? input.amount_pkr : 0;
    const income = Number.isFinite(input.monthly_income_pkr) ? input.monthly_income_pkr : 0;
    const confidence = Math.min(1, Math.max(0, Number.isFinite(input.confidence_score) ? Number(input.confidence_score) : 0.91));
    const modelVersion = input.model_version ?? 'Awaaz-LangGraph-v2.0';

    const uncertaintyReasons: string[] = [];
    const conflictingOrMissing: string[] = [
      ...(input.conflicting_fields ?? []),
      ...(input.missing_fields ?? []),
    ];
    const recommendedChecks: string[] = [];
    const requiredProofItems: string[] = [];

    const incomeExceedsLimit = income > rule.max_monthly_income_pkr;
    const duplicateFlagged =
      input.duplicate_result?.classification === 'EXACT_DUPLICATE_PERSON' ||
      input.duplicate_result?.classification === 'POSSIBLE_DUPLICATE_NEEDS_HUMAN';
    const forgeryFlagged = Boolean(input.forgery_flagged);
    const lowConfidence = confidence < rule.min_confidence_ask_proof;
    const mediumConfidence =
      confidence >= rule.min_confidence_ask_proof && confidence < rule.min_confidence_act_alone;

    if (incomeExceedsLimit) {
      uncertaintyReasons.push(
        `Monthly income (${income.toLocaleString()} PKR) exceeds active ${rule.version} eligibility cap (${rule.max_monthly_income_pkr.toLocaleString()} PKR).`,
      );
      conflictingOrMissing.push(`monthly_income (${income} > ${rule.max_monthly_income_pkr})`);
      recommendedChecks.push('Verify household income proof or hardship exemption under active policy.');
    }

    if (lowConfidence) {
      uncertaintyReasons.push(
        `AI extraction confidence (${Math.round(confidence * 100)}%) is below the safe minimum threshold (${Math.round(rule.min_confidence_ask_proof * 100)}%).`,
      );
      recommendedChecks.push('Confirm spoken/uploaded applicant fields directly with the citizen.');
    }

    if (duplicateFlagged && input.duplicate_result) {
      uncertaintyReasons.push(`Entity resolution flagged ${input.duplicate_result.classification}: ${input.duplicate_result.explanation}`);
      conflictingOrMissing.push('identity_duplicate_check');
      recommendedChecks.push('Compare side-by-side applicant CNIC, phone, and district before deciding.');
    }

    if (forgeryFlagged) {
      uncertaintyReasons.push('Document authenticity analyzer flagged possible tampering or mismatch.');
      conflictingOrMissing.push('supporting_document_authenticity');
      recommendedChecks.push('Inspect original CNIC / proof of income manually without auto-banning applicant.');
    }

    if (amount > rule.ask_proof_max_amount_pkr) {
      uncertaintyReasons.push(
        `Requested amount (${amount.toLocaleString()} PKR) exceeds Tier 2 Ask-Proof ceiling (${rule.ask_proof_max_amount_pkr.toLocaleString()} PKR).`,
      );
      recommendedChecks.push('Department Officer review required due to high false-approval cost ratio.');
    }

    if (input.document_blurry_or_missing) {
      requiredProofItems.push('Clear CNIC photo (front/back)', 'Proof of monthly household income or utility bill');
    } else if (amount > rule.act_alone_max_amount_pkr && amount <= rule.ask_proof_max_amount_pkr) {
      requiredProofItems.push('Supporting income / damage proof document');
    }

    let decisionTier: DecisionTier;

    if (
      amount > rule.ask_proof_max_amount_pkr ||
      lowConfidence ||
      duplicateFlagged ||
      forgeryFlagged ||
      incomeExceedsLimit ||
      (input.conflicting_fields && input.conflicting_fields.length > 0)
    ) {
      decisionTier = 'HUMAN_OFFICER_HANDOFF';
    } else if (
      amount > rule.act_alone_max_amount_pkr ||
      mediumConfidence ||
      input.document_blurry_or_missing
    ) {
      decisionTier = 'ASK_FOR_MORE_PROOF';
      if (requiredProofItems.length === 0) {
        requiredProofItems.push('Clear supporting proof of income or residence');
      }
      recommendedChecks.push(`Collect requested proof: ${requiredProofItems.join(', ')}.`);
    } else {
      decisionTier = 'ACT_ALONE_FAST_TRACK';
    }

    const isUncertain =
      lowConfidence ||
      Boolean(input.conflicting_fields && input.conflicting_fields.length > 0) ||
      input.duplicate_result?.classification === 'POSSIBLE_DUPLICATE_NEEDS_HUMAN';

    const caseNotes: StructuredUncertaintyCaseNotes | null =
      decisionTier === 'HUMAN_OFFICER_HANDOFF' || isUncertain
        ? {
            confidence_score: Number(confidence.toFixed(2)),
            uncertainty_reasons:
              uncertaintyReasons.length > 0
                ? uncertaintyReasons
                : [`Evaluated under ${rule.version} and routed to Department Officer for verification.`],
            conflicting_or_missing_fields: Array.from(new Set(conflictingOrMissing)),
            recommended_human_checks:
              recommendedChecks.length > 0
                ? recommendedChecks
                : ['Review applicant details and record a clear officer decision reason.'],
          }
        : null;

    const costRatio = Number((rule.false_approval_cost_pkr / Math.max(1, rule.false_delay_cost_pkr)).toFixed(1));
    const citizenSimpleReason = this.buildPlainLanguageReason(lang, decisionTier, rule, amount, income, confidence, requiredProofItems, isUncertain, incomeExceedsLimit);

    return {
      decision_tier: decisionTier,
      rule_version_used: rule.version,
      rule_snapshot: rule,
      confidence_score: Number(confidence.toFixed(2)),
      is_uncertain: isUncertain,
      citizen_simple_reason: citizenSimpleReason,
      required_proof_items: requiredProofItems,
      cost_rationale: {
        false_approval_cost_pkr: rule.false_approval_cost_pkr,
        false_delay_cost_pkr: rule.false_delay_cost_pkr,
        wrongful_rejection_cost_pkr: rule.wrongful_rejection_cost_pkr,
        cost_ratio_false_approval_vs_delay: costRatio,
      },
      case_notes: caseNotes,
      model_version: modelVersion,
    };
  }

  private buildPlainLanguageReason(
    lang: LanguageCode,
    tier: DecisionTier,
    rule: DynamicRuleVersionRecord,
    amount: number,
    income: number,
    confidence: number,
    proofItems: string[],
    isUncertain: boolean,
    incomeExceedsLimit: boolean,
  ): string {
    const pct = Math.round(confidence * 100);
    if (lang === 'en') {
      if (isUncertain) {
        return `I am not sure (Confidence: ${pct}%). Under Policy ${rule.version}, your application was safely sent to a Relief Department Officer with structured notes instead of guessing.`;
      }
      if (tier === 'ACT_ALONE_FAST_TRACK') {
        return `Fast-track provisional pass under Policy ${rule.version}: requested ${amount.toLocaleString()} PKR (≤ ${rule.act_alone_max_amount_pkr.toLocaleString()} PKR) and income ${income.toLocaleString()} PKR (≤ ${rule.max_monthly_income_pkr.toLocaleString()} PKR). Final disbursement requires official confirmation.`;
      }
      if (tier === 'ASK_FOR_MORE_PROOF') {
        return `Additional proof needed under Policy ${rule.version} for ${amount.toLocaleString()} PKR (Confidence: ${pct}%). Please upload: ${proofItems.join(', ')}.`;
      }
      if (incomeExceedsLimit) {
        return `Sent to Relief Officer under Policy ${rule.version}: reported income (${income.toLocaleString()} PKR) is above the ${rule.max_monthly_income_pkr.toLocaleString()} PKR limit, so a human officer will review your hardship case.`;
      }
      return `Sent to Relief Department Officer under Policy ${rule.version}: requested amount (${amount.toLocaleString()} PKR) exceeds the ${rule.ask_proof_max_amount_pkr.toLocaleString()} PKR threshold for automated handling.`;
    }

    if (isUncertain) {
      return `میں یقین سے نہیں کہہ سکتا (اعتماد: ${pct}%)۔ پالیسی ${rule.version} کے تحت اندازہ لگانے کے بجائے آپ کی درخواست محفوظ طریقے سے محکمہ افسر کو نوٹس کے ساتھ بھیج دی گئی ہے۔`;
    }
    if (tier === 'ACT_ALONE_FAST_TRACK') {
      return `پالیسی ${rule.version} کے تحت فاسٹ ٹریک عارضی منظوری: رقم ${amount.toLocaleString()} روپے اور آمدنی ${income.toLocaleString()} روپے مقررہ حد کے اندر ہے۔ حتمی تصدیق افسر کے ذریعے ہوگی۔`;
    }
    if (tier === 'ASK_FOR_MORE_PROOF') {
      return `پالیسی ${rule.version} کے تحت ${amount.toLocaleString()} روپے کے لیے مزید ثبوت درکار ہے (اعتماد: ${pct}%)۔ براہِ کرم واضح شناختی کارڈ یا آمدنی کا ثبوت اپلوڈ کریں۔`;
    }
    if (incomeExceedsLimit) {
      return `پالیسی ${rule.version} کے تحت آمدنی (${income.toLocaleString()} روپے) مقررہ حد (${rule.max_monthly_income_pkr.toLocaleString()} روپے) سے زیادہ ہے، اس لیے درخواست انسانی افسر کے جائزے کے لیے بھیج دی گئی ہے۔`;
    }
    return `پالیسی ${rule.version} کے تحت درخواست کردہ رقم (${amount.toLocaleString()} روپے) خودکار حد سے زیادہ ہے، اس لیے محکمہ افسر اس کا جائزہ لیں گے۔`;
  }
}
