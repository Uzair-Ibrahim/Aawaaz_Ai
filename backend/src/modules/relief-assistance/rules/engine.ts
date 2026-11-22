import type {
  CaseAnswerRecord,
  DocumentRecord,
  EligibilityEvaluationResult,
  EligibilityRuleDefinition,
  RuleCondition,
  RuleVersionRecord,
} from '@awaaz/shared';

export interface RuleEvaluationContext {
  ruleVersion: RuleVersionRecord;
  answers: CaseAnswerRecord[];
  documents: DocumentRecord[];
  hasActiveProcessingConsent: boolean;
  mockIdentityVerified: boolean;
  duplicateIdentityDetected: boolean;
}

function evaluateSingleCondition(
  condition: RuleCondition,
  facts: Record<string, unknown>,
): { matched: boolean; actual: unknown } {
  const actual = facts[condition.field];
  const expected = condition.value;

  if (actual === undefined || actual === null) {
    return { matched: false, actual: null };
  }

  switch (condition.operator) {
    case 'eq':
    case 'equals':
      return { matched: actual === expected, actual };
    case 'neq':
      return { matched: actual !== expected, actual };
    case 'lt':
      return { matched: typeof actual === 'number' && typeof expected === 'number' && actual < expected, actual };
    case 'lte':
      return { matched: typeof actual === 'number' && typeof expected === 'number' && actual <= expected, actual };
    case 'gt':
      return { matched: typeof actual === 'number' && typeof expected === 'number' && actual > expected, actual };
    case 'gte':
      return { matched: typeof actual === 'number' && typeof expected === 'number' && actual >= expected, actual };
    case 'in':
      return {
        matched: Array.isArray(expected) && expected.includes(actual as never),
        actual,
      };
    default:
      return { matched: false, actual };
  }
}

/**
 * 100% Deterministic Eligibility Rules Engine + Evidence Completeness Scorer (§13 & §14).
 * NEVER uses an LLM to evaluate rules and NEVER automatically approves or rejects a case.
 */
export function evaluateEligibilityDeterministic(ctx: RuleEvaluationContext): EligibilityEvaluationResult {
  const def: EligibilityRuleDefinition = ctx.ruleVersion.rules_json;
  const answerMap = new Map<string, CaseAnswerRecord>();
  for (const ans of ctx.answers) {
    answerMap.set(ans.field_name, ans);
  }

  // Build facts dictionary for deterministic condition evaluation
  const facts: Record<string, unknown> = {};
  for (const [k, v] of answerMap.entries()) {
    facts[k] = v.field_value;
  }

  const uploadedDocTypes = new Set(ctx.documents.map((d) => d.document_type));
  const missingDocuments = def.required_documents.filter((dt) => !uploadedDocTypes.has(dt));
  const missingFields = def.required_fields.filter((f) => {
    const ans = answerMap.get(f);
    return !ans || ans.field_value === '' || ans.field_value === null || ans.field_value === undefined;
  });

  const unreadableDocs = ctx.documents.filter(
    (d) => d.processing_status === 'FAILED' || d.processing_status === 'NEEDS_REVIEW' || d.review_status === 'FLAGGED',
  );
  const allConflicts = ctx.documents.flatMap((d) => d.conflicts ?? []);
  const hasHardConflicts = allConflicts.some((c) => c.severity === 'hard_review');
  const unconfirmedCritical = ctx.answers.filter(
    (a) =>
      ['full_name', 'mock_identity_reference', 'monthly_income', 'household_size'].includes(a.field_name) &&
      !a.confirmed_by_citizen,
  );

  const documentsVerified =
    missingDocuments.length === 0 &&
    ctx.documents.length > 0 &&
    unreadableDocs.length === 0 &&
    allConflicts.length === 0;
  facts.documents_verified = documentsVerified;
  facts.mock_identity_verified = ctx.mockIdentityVerified;

  // Evaluate top-level conditions & optional groups
  const matchedConditions: EligibilityEvaluationResult['matched_conditions'] = [];
  const unmatchedConditions: EligibilityEvaluationResult['unmatched_conditions'] = [];

  const evalList = (conditions: RuleCondition[], combinator: 'AND' | 'OR'): boolean => {
    const results = conditions.map((cond) => {
      const res = evaluateSingleCondition(cond, facts);
      const entry = {
        field: cond.field,
        operator: cond.operator,
        expected: cond.value,
        actual: res.actual,
      };
      if (res.matched) matchedConditions.push(entry);
      else unmatchedConditions.push(entry);
      return res.matched;
    });
    if (results.length === 0) return true;
    return combinator === 'AND' ? results.every(Boolean) : results.some(Boolean);
  };

  const baseConditionsMet = evalList(def.conditions, def.combinator);
  const groupsMet =
    def.groups && def.groups.length > 0
      ? def.groups.every((g) => evalList(g.conditions, g.combinator))
      : true;

  // --- Evidence Completeness Score (§14) ---
  const weights = def.scoring_weights;
  const mockIdentityScore = ctx.mockIdentityVerified ? weights.mock_identity_verification : 0;

  let documentReadabilityScore = 0;
  if (def.required_documents.length === 0) {
    documentReadabilityScore = weights.document_readability;
  } else {
    const presentRatio =
      (def.required_documents.length - missingDocuments.length) / def.required_documents.length;
    const readabilityPenalty = unreadableDocs.length > 0 ? 0.5 : 1;
    documentReadabilityScore = Math.round(weights.document_readability * presentRatio * readabilityPenalty);
  }

  const requiredFieldsCount = Math.max(1, def.required_fields.length);
  const completedFieldsCount = def.required_fields.length - missingFields.length;
  const requiredFieldCompletenessScore = Math.round(
    (completedFieldsCount / requiredFieldsCount) * weights.required_field_completeness,
  );

  let crossFieldConsistencyScore = weights.cross_field_consistency;
  if (allConflicts.length > 0) {
    crossFieldConsistencyScore = Math.max(0, weights.cross_field_consistency - allConflicts.length * 10);
  }
  if (unconfirmedCritical.length > 0) {
    crossFieldConsistencyScore = Math.max(0, crossFieldConsistencyScore - 5);
  }

  const evidenceScore = Math.min(
    100,
    Math.max(
      0,
      mockIdentityScore +
        documentReadabilityScore +
        requiredFieldCompletenessScore +
        crossFieldConsistencyScore,
    ),
  );

  // --- Hard Safety Conditions Override Score (§14) ---
  const hardSafetyFlags: string[] = [];
  if (!ctx.hasActiveProcessingConsent) {
    hardSafetyFlags.push('MISSING_PROCESSING_CONSENT');
  }
  if (ctx.duplicateIdentityDetected) {
    hardSafetyFlags.push('DUPLICATE_MOCK_IDENTITY_REFERENCE');
  }
  if (hasHardConflicts) {
    hardSafetyFlags.push('CONTRADICTORY_DOCUMENT_INFORMATION');
  }
  if (unreadableDocs.length > 0) {
    hardSafetyFlags.push('UNREADABLE_OR_FLAGGED_DOCUMENTS');
  }
  if (unconfirmedCritical.length > 0) {
    hardSafetyFlags.push('UNCONFIRMED_CRITICAL_FIELDS');
  }

  // Routing decision (NEVER auto-approve or auto-reject)
  let evaluationStatus: EligibilityEvaluationResult['evaluation_status'];
  let recommendedNextStatus: EligibilityEvaluationResult['recommended_next_status'];
  let explanation: string;

  if (hardSafetyFlags.length > 0) {
    evaluationStatus = 'requires_officer_review';
    recommendedNextStatus = 'NEEDS_HUMAN_REVIEW';
    explanation = `Hard safety override triggered (${hardSafetyFlags.join(', ')}). Routed for human officer review.`;
  } else if (missingFields.length > 0 || missingDocuments.length > 0) {
    evaluationStatus = 'needs_more_info';
    recommendedNextStatus = 'NEEDS_MORE_INFO';
    explanation = `Additional information is required (${missingFields.length} missing fields, ${missingDocuments.length} missing documents).`;
  } else if (!baseConditionsMet || !groupsMet) {
    evaluationStatus = 'requires_officer_review';
    recommendedNextStatus = 'NEEDS_HUMAN_REVIEW';
    explanation =
      'One or more deterministic eligibility rule conditions were not met. Routed for human officer review (never auto-rejected).';
  } else if (evidenceScore >= def.thresholds.officer_ready_min) {
    evaluationStatus = 'officer_ready';
    recommendedNextStatus = 'READY_FOR_OFFICER';
    explanation = `Evidence completeness score (${evidenceScore}/100) meets officer-ready threshold (${def.thresholds.officer_ready_min}). Ready for human officer review.`;
  } else if (evidenceScore >= def.thresholds.needs_more_info_min) {
    evaluationStatus = 'needs_more_info';
    recommendedNextStatus = 'NEEDS_MORE_INFO';
    explanation = `Evidence completeness score (${evidenceScore}/100) indicates more supporting information is needed.`;
  } else {
    evaluationStatus = 'requires_officer_review';
    recommendedNextStatus = 'NEEDS_HUMAN_REVIEW';
    explanation = `Evidence completeness score (${evidenceScore}/100) is below ${def.thresholds.needs_more_info_min}. Routed for human officer review.`;
  }

  return {
    rule_id: ctx.ruleVersion.rule_id,
    rule_version_id: ctx.ruleVersion.id,
    rule_version: ctx.ruleVersion.version_number,
    evaluation_status: evaluationStatus,
    recommended_next_status: recommendedNextStatus,
    evidence_score: evidenceScore,
    score_breakdown: {
      mock_identity_verification: mockIdentityScore,
      document_readability: documentReadabilityScore,
      required_field_completeness: requiredFieldCompletenessScore,
      cross_field_consistency: crossFieldConsistencyScore,
    },
    hard_safety_flags: hardSafetyFlags,
    matched_conditions: matchedConditions,
    unmatched_conditions: unmatchedConditions,
    missing_fields: missingFields,
    missing_documents: missingDocuments,
    explanation,
    evaluated_at: new Date().toISOString(),
  };
}
