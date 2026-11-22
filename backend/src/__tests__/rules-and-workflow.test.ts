import { describe, expect, it } from 'vitest';
import type { CaseAnswerRecord, DocumentRecord, RuleVersionRecord } from '@awaaz/shared';
import { DEFAULT_RULE_DEFINITION } from '../core/database/seed-data';
import { validateAudioUpload } from '../integrations/voice/audio-validation';
import { detectCrossFieldConflicts } from '../modules/relief-assistance/documents/document-service';
import { evaluateEligibilityDeterministic } from '../modules/relief-assistance/rules/engine';
import { validateCaseTransition } from '../modules/relief-assistance/workflow/state-machine';

const mockRuleVersion: RuleVersionRecord = {
  id: 'rv-1',
  organization_id: 'org-1',
  rule_id: 'rule-1',
  scheme_id: 'MOCK_RELIEF_01',
  version_number: 1,
  rules_json: DEFAULT_RULE_DEFINITION,
  published_by: 'admin-1',
  published_at: new Date().toISOString(),
};

function makeCompleteAnswers(overrides: Partial<Record<string, string | number | boolean>> = {}): CaseAnswerRecord[] {
  const base: Record<string, string | number | boolean> = {
    full_name: 'Amina Bibi',
    mock_identity_reference: 'MOCK-ID-1001',
    district: 'Multan',
    household_size: 5,
    monthly_income: 18000,
    employment_status: 'daily_wage',
    relief_reason: 'Flood impact on synthetic household',
    ...overrides,
  };
  return Object.entries(base).map(([field_name, field_value], idx) => ({
    id: `ans-${idx}`,
    organization_id: 'org-1',
    case_id: 'case-1',
    field_name: field_name as CaseAnswerRecord['field_name'],
    field_value,
    source: 'text',
    confirmed_by_citizen: true,
    extraction_confidence: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));
}

function makeCompleteDocuments(): DocumentRecord[] {
  return [
    {
      id: 'doc-1',
      organization_id: 'org-1',
      case_id: 'case-1',
      document_type: 'mock_identity_document',
      file_name: 'id.txt',
      mime_type: 'text/plain',
      size_bytes: 120,
      storage_path: 'org/org-1/cases/case-1/doc-1/id.txt',
      processing_status: 'EXTRACTED',
      extraction_result: {},
      conflicts: [],
      review_status: 'PENDING',
      created_at: new Date().toISOString(),
    },
    {
      id: 'doc-2',
      organization_id: 'org-1',
      case_id: 'case-1',
      document_type: 'mock_proof_of_income',
      file_name: 'income.txt',
      mime_type: 'text/plain',
      size_bytes: 120,
      storage_path: 'org/org-1/cases/case-1/doc-2/income.txt',
      processing_status: 'EXTRACTED',
      extraction_result: {},
      conflicts: [],
      review_status: 'PENDING',
      created_at: new Date().toISOString(),
    },
  ];
}

describe('Deterministic Eligibility Rules Engine & Evidence Scoring', () => {
  it('routes complete, verified, eligible application to READY_FOR_OFFICER (never auto-approves)', () => {
    const result = evaluateEligibilityDeterministic({
      ruleVersion: mockRuleVersion,
      answers: makeCompleteAnswers(),
      documents: makeCompleteDocuments(),
      hasActiveProcessingConsent: true,
      mockIdentityVerified: true,
      duplicateIdentityDetected: false,
    });

    expect(result.evidence_score).toBe(100);
    expect(result.evaluation_status).toBe('officer_ready');
    expect(result.recommended_next_status).toBe('READY_FOR_OFFICER');
    expect(result.hard_safety_flags).toEqual([]);
  });

  it('overrides score and forces NEEDS_HUMAN_REVIEW when hard safety flags are triggered', () => {
    const result = evaluateEligibilityDeterministic({
      ruleVersion: mockRuleVersion,
      answers: makeCompleteAnswers(),
      documents: makeCompleteDocuments(),
      hasActiveProcessingConsent: true,
      mockIdentityVerified: true,
      duplicateIdentityDetected: true,
    });

    expect(result.hard_safety_flags).toContain('DUPLICATE_MOCK_IDENTITY_REFERENCE');
    expect(result.recommended_next_status).toBe('NEEDS_HUMAN_REVIEW');
  });

  it('routes high income to NEEDS_HUMAN_REVIEW rather than auto-rejecting', () => {
    const result = evaluateEligibilityDeterministic({
      ruleVersion: mockRuleVersion,
      answers: makeCompleteAnswers({ monthly_income: 80000 }),
      documents: makeCompleteDocuments(),
      hasActiveProcessingConsent: true,
      mockIdentityVerified: true,
      duplicateIdentityDetected: false,
    });

    expect(result.unmatched_conditions.length).toBeGreaterThan(0);
    expect(result.recommended_next_status).toBe('NEEDS_HUMAN_REVIEW');
  });
});

describe('Centralized Case State Machine', () => {
  it('strictly forbids AI from approving or rejecting a case', () => {
    expect(() =>
      validateCaseTransition({
        currentStatus: 'OFFICER_REVIEW',
        nextStatus: 'APPROVED',
        actorRole: 'officer',
        actorIsAi: true,
        hasProcessingConsent: true,
        ruleVersionId: 'rv-1',
      }),
    ).toThrow(/prohibited/i);
  });

  it('forbids citizens from approving applications and rejects invalid transitions', () => {
    expect(() =>
      validateCaseTransition({
        currentStatus: 'OFFICER_REVIEW',
        nextStatus: 'APPROVED',
        actorRole: 'citizen',
        hasProcessingConsent: true,
        ruleVersionId: 'rv-1',
      }),
    ).toThrow(/not authorized/i);

    expect(() =>
      validateCaseTransition({
        currentStatus: 'DRAFT',
        nextStatus: 'MOCK_PAYMENT_QUEUED',
        actorRole: 'officer',
        hasProcessingConsent: true,
        ruleVersionId: 'rv-1',
      }),
    ).toThrow(/not allowed/i);
  });
});

describe('Document Conflict Detection & Audio Validation', () => {
  it('flags hard_review conflict when extracted income contradicts application income', () => {
    const conflicts = detectCrossFieldConflicts(makeCompleteAnswers({ monthly_income: 15000 }), {
      monthly_income: 42000,
    });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.severity).toBe('hard_review');
  });

  it('rejects unsupported audio formats and overly long recordings', () => {
    expect(() =>
      validateAudioUpload({
        buffer: Buffer.from('abc'),
        mimeType: 'application/octet-stream',
        maxSizeBytes: 1024 * 1024,
      }),
    ).toThrow(/not supported/i);

    expect(() =>
      validateAudioUpload({
        buffer: Buffer.from('abc'),
        mimeType: 'audio/webm',
        maxSizeBytes: 1024 * 1024,
        durationSeconds: 95,
      }),
    ).toThrow(/60 seconds/i);
  });
});
