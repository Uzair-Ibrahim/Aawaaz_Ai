import type { CaseStatus, UserRole } from '@awaaz/shared';
import { AppError } from '../../../core/security/errors';

const ALLOWED_TRANSITIONS: Record<CaseStatus, ReadonlyArray<CaseStatus>> = {
  DRAFT: ['COLLECTING_INFORMATION', 'DOCUMENT_PENDING', 'AI_ANALYSIS'],
  COLLECTING_INFORMATION: ['DOCUMENT_PENDING', 'AI_ANALYSIS', 'NEEDS_MORE_INFO'],
  DOCUMENT_PENDING: ['COLLECTING_INFORMATION', 'AI_ANALYSIS', 'NEEDS_MORE_INFO'],
  AI_ANALYSIS: ['NEEDS_MORE_INFO', 'NEEDS_HUMAN_REVIEW', 'READY_FOR_OFFICER'],
  NEEDS_MORE_INFO: ['COLLECTING_INFORMATION', 'DOCUMENT_PENDING', 'AI_ANALYSIS', 'OFFICER_REVIEW'],
  NEEDS_HUMAN_REVIEW: ['OFFICER_REVIEW', 'READY_FOR_OFFICER', 'NEEDS_MORE_INFO'],
  READY_FOR_OFFICER: ['OFFICER_REVIEW', 'NEEDS_MORE_INFO'],
  OFFICER_REVIEW: ['APPROVED', 'REJECTED', 'NEEDS_MORE_INFO'],
  APPROVED: ['MOCK_PAYMENT_QUEUED'],
  REJECTED: [],
  MOCK_PAYMENT_QUEUED: ['MOCK_PAYMENT_COMPLETED'],
  MOCK_PAYMENT_COMPLETED: [],
};

const TARGET_ALLOWED_ROLES: Record<CaseStatus, ReadonlyArray<UserRole>> = {
  DRAFT: ['citizen', 'helper'],
  COLLECTING_INFORMATION: ['citizen', 'helper'],
  DOCUMENT_PENDING: ['citizen', 'helper'],
  AI_ANALYSIS: ['citizen', 'helper', 'officer', 'admin'],
  NEEDS_MORE_INFO: ['citizen', 'helper', 'officer', 'admin'],
  NEEDS_HUMAN_REVIEW: ['citizen', 'helper', 'officer', 'admin'],
  READY_FOR_OFFICER: ['citizen', 'helper', 'officer', 'admin'],
  OFFICER_REVIEW: ['officer', 'admin'],
  APPROVED: ['officer', 'admin'],
  REJECTED: ['officer', 'admin'],
  MOCK_PAYMENT_QUEUED: ['officer', 'admin'],
  MOCK_PAYMENT_COMPLETED: ['officer', 'admin'],
};

export interface TransitionValidationInput {
  currentStatus: CaseStatus;
  nextStatus: CaseStatus;
  actorRole: UserRole;
  actorIsAi?: boolean;
  hasProcessingConsent: boolean;
  ruleVersionId?: string | null;
}

/**
 * Centralized Case State-Transition Validator (§8).
 * Enforces:
 * - Valid state machine edge
 * - Authorized human role (AI can NEVER approve, reject, or initiate payments)
 * - Active citizen consent before submission/analysis/decision
 * - Rule version binding on analysis/decision transitions
 */
export function validateCaseTransition(input: TransitionValidationInput): void {
  const { currentStatus, nextStatus, actorRole, actorIsAi, hasProcessingConsent, ruleVersionId } = input;

  if (actorIsAi && ['APPROVED', 'REJECTED', 'MOCK_PAYMENT_QUEUED', 'MOCK_PAYMENT_COMPLETED'].includes(nextStatus)) {
    throw new AppError(
      403,
      'AI_DECISION_FORBIDDEN',
      'AI systems are strictly prohibited from approving, rejecting, or initiating payments.',
    );
  }

  const allowedNext = ALLOWED_TRANSITIONS[currentStatus] ?? [];
  if (!allowedNext.includes(nextStatus)) {
    throw new AppError(
      409,
      'INVALID_STATE_TRANSITION',
      `Transition from '${currentStatus}' to '${nextStatus}' is not allowed.`,
    );
  }

  const allowedRoles = TARGET_ALLOWED_ROLES[nextStatus] ?? [];
  if (!allowedRoles.includes(actorRole)) {
    throw new AppError(
      403,
      'UNAUTHORIZED_TRANSITION_ACTOR',
      `Role '${actorRole}' is not authorized to transition a case to '${nextStatus}'.`,
    );
  }

  const consentRequiredTargets: CaseStatus[] = [
    'AI_ANALYSIS',
    'READY_FOR_OFFICER',
    'OFFICER_REVIEW',
    'APPROVED',
    'MOCK_PAYMENT_QUEUED',
  ];
  if (consentRequiredTargets.includes(nextStatus) && !hasProcessingConsent) {
    throw new AppError(
      412,
      'CONSENT_REQUIRED',
      `Active citizen processing consent is required before transitioning to '${nextStatus}'.`,
    );
  }

  if (['READY_FOR_OFFICER', 'APPROVED', 'REJECTED'].includes(nextStatus) && !ruleVersionId) {
    throw new AppError(
      412,
      'RULE_VERSION_REQUIRED',
      `Case must be evaluated against a published rule version before transitioning to '${nextStatus}'.`,
    );
  }
}
