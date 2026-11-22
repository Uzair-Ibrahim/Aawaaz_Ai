import crypto from 'node:crypto';
import type {
  CitizenConsentScopes,
  CitizenGranularConsentRecord,
  ConsentRecipientEntry,
} from '@awaaz/shared';
import type { AuditService } from '../../../core/audit/audit-service';
import type { AuthContext } from '../../../core/auth/auth-service';
import type { DataStore } from '../../../core/database/types';
import { AppError } from '../../../core/security/errors';

function buildWhoHasAccess(scopes: CitizenConsentScopes, status: 'GRANTED' | 'WITHDRAWN'): ConsentRecipientEntry[] {
  const isGranted = status === 'GRANTED';
  return [
    {
      recipient_id: 'dept_relief_assistance',
      name: 'Relief Assistance Department (Officer Hamza)',
      department: 'RELIEF_ASSISTANCE',
      purpose: 'Review relief applications, verify eligibility, and respond to citizen inquiries.',
      scope_key: 'share_with_relief_officer',
      access_active: isGranted && scopes.share_with_relief_officer,
    },
    {
      recipient_id: 'ai_voice_saathi',
      name: 'Awaaz AI Voice Assistant',
      department: 'RELIEF_ASSISTANCE',
      purpose: 'Transcribe multilingual voice turns and fill relief application fields.',
      scope_key: 'allow_ai_voice_processing',
      access_active: isGranted && scopes.allow_ai_voice_processing,
    },
    {
      recipient_id: 'doc_verification_engine',
      name: 'Document Verification Engine',
      department: 'SCAM_CYBER_SAFETY',
      purpose: 'Extract synthetic CNIC/income fields and check for document tampering.',
      scope_key: 'allow_document_verification',
      access_active: isGranted && scopes.allow_document_verification,
    },
  ];
}

/**
 * MODULE 4 — CHALLENGE 06: TRUE CONSENT VISIBILITY, GRANULAR CONTROLS & HARD ACCESS REVOCATION
 * Enforced at the API, Officer Portal, and AI Voice Agent layers with immutable audit logs.
 */
export class ConsentEnforcementService {
  private recordsByKey = new Map<string, CitizenGranularConsentRecord>();

  constructor(
    private readonly store: DataStore,
    private readonly audit: AuditService,
  ) {}

  private key(organizationId: string, userId: string): string {
    return `${organizationId}:${userId}`;
  }

  private async ensureRecord(
    organizationId: string,
    userId: string,
    citizenId?: string | null,
  ): Promise<CitizenGranularConsentRecord> {
    const k = this.key(organizationId, userId);
    let existing = this.recordsByKey.get(k);
    if (!existing) {
      const citizen = citizenId
        ? await this.store.getCitizenById(organizationId, citizenId)
        : await this.store.getCitizenByUserId(organizationId, userId);
      const scopes: CitizenConsentScopes = {
        share_with_relief_officer: true,
        allow_ai_voice_processing: true,
        allow_document_verification: true,
      };
      const ts = new Date().toISOString();
      existing = {
        id: crypto.randomUUID(),
        organization_id: organizationId,
        citizen_id: citizen?.id ?? userId,
        user_id: userId,
        status: 'GRANTED',
        scopes,
        who_has_access: buildWhoHasAccess(scopes, 'GRANTED'),
        created_at: ts,
        updated_at: ts,
      };
      this.recordsByKey.set(k, existing);
    }
    return structuredClone(existing);
  }

  async getMyConsentRecord(auth: AuthContext): Promise<CitizenGranularConsentRecord> {
    const citizen = await this.store.getCitizenByUserId(auth.organizationId, auth.userId);
    return this.ensureRecord(auth.organizationId, auth.userId, citizen?.id ?? null);
  }

  async getConsentStateForCitizenId(
    organizationId: string,
    citizenId: string,
  ): Promise<CitizenGranularConsentRecord | null> {
    const citizen = await this.store.getCitizenById(organizationId, citizenId);
    if (!citizen?.user_id) return null;
    return this.ensureRecord(organizationId, citizen.user_id, citizen.id);
  }

  async isOfficerAccessAllowedForCitizen(organizationId: string, citizenId: string): Promise<boolean> {
    const rec = await this.getConsentStateForCitizenId(organizationId, citizenId);
    if (!rec) return true;
    return rec.status === 'GRANTED' && rec.scopes.share_with_relief_officer;
  }

  async isAiProcessingAllowedForUser(organizationId: string, userId: string): Promise<boolean> {
    const k = this.key(organizationId, userId);
    const existing = this.recordsByKey.get(k);
    if (!existing) return true;
    return existing.status === 'GRANTED' && existing.scopes.allow_ai_voice_processing;
  }

  private async logConsentAuditEvent(params: {
    organizationId: string;
    actorId: string;
    actorRole: string;
    citizenId: string;
    userId: string;
    eventType:
      | 'CONSENT_GRANTED'
      | 'CONSENT_SCOPE_UPDATED'
      | 'CONSENT_WITHDRAWN'
      | 'DATA_ACCESS_BLOCKED_CONSENT_WITHDRAWN';
    summary: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.audit.log({
      organizationId: params.organizationId,
      actorId: params.actorId,
      action: params.eventType,
      resourceType: 'citizen_consent',
      resourceId: params.citizenId,
      metadata: {
        consent_event_type: params.eventType,
        summary: params.summary,
        ...(params.metadata ?? {}),
      },
    });

    await this.store.appendAgentReasoningAuditLog({
      organization_id: params.organizationId,
      department_id: 'RELIEF_ASSISTANCE',
      related_application_id:
        typeof params.metadata?.case_id === 'string' ? params.metadata.case_id : null,
      session_id: `consent-${params.citizenId.slice(0, 8)}`,
      citizen_id: params.citizenId,
      user_id: params.userId,
      workflow_stage: 'AGENT_HUB',
      detected_language: 'en',
      locked_language: 'en',
      user_input: `[${params.eventType}] ${params.summary}`,
      intent_detected: params.eventType.toLowerCase(),
      mood_or_context_switch: 'consent_governance',
      access_control_decision: {
        decision: params.eventType === 'DATA_ACCESS_BLOCKED_CONSENT_WITHDRAWN' ? 'DENIED' : 'ALLOWED',
        actor_role: params.actorRole,
        authenticated: true,
        rule_reason: params.summary,
      },
      capability_check: 'IN_SCOPE',
      reasoning_steps: [
        `Consent Governance Event: ${params.eventType}`,
        params.summary,
      ],
      self_reflection_check: {
        passed: true,
        self_corrected: false,
        notes: `Immutable consent audit recorded (${params.eventType}).`,
      },
      memory_snapshot_diff: {
        action: 'SAVED',
        active_task: 'idle',
        suspended_count: 0,
        summary: params.summary,
      },
      mcp_tools_invoked: [],
      validation_errors: [],
      model_version: 'Consent-Enforcement-Engine-v1.0',
      confidence_score: 1,
      consent_event_type: params.eventType,
      final_agent_response: params.summary,
    });
  }

  async recordAccessBlocked(params: {
    auth: AuthContext;
    citizenId: string;
    caseId?: string;
    operation: string;
  }): Promise<void> {
    const citizen = await this.store.getCitizenById(params.auth.organizationId, params.citizenId);
    await this.logConsentAuditEvent({
      organizationId: params.auth.organizationId,
      actorId: params.auth.userId,
      actorRole: params.auth.role,
      citizenId: params.citizenId,
      userId: citizen?.user_id ?? params.citizenId,
      eventType: 'DATA_ACCESS_BLOCKED_CONSENT_WITHDRAWN',
      summary: `Blocked ${params.auth.displayName} (${params.auth.role}) from ${params.operation} because citizen withdrew data-sharing consent.`,
      metadata: {
        blocked_actor_id: params.auth.userId,
        blocked_actor_name: params.auth.displayName,
        case_id: params.caseId ?? null,
        operation: params.operation,
      },
    });
  }

  async updateGranularScopes(
    auth: AuthContext,
    patch: Partial<CitizenConsentScopes>,
  ): Promise<CitizenGranularConsentRecord> {
    if (auth.role !== 'citizen') {
      throw new AppError(403, 'CONSENT_CITIZEN_ONLY', 'Only the citizen may modify their own consent settings.');
    }
    const current = await this.getMyConsentRecord(auth);
    const nextScopes: CitizenConsentScopes = {
      share_with_relief_officer:
        patch.share_with_relief_officer ?? current.scopes.share_with_relief_officer,
      allow_ai_voice_processing:
        patch.allow_ai_voice_processing ?? current.scopes.allow_ai_voice_processing,
      allow_document_verification:
        patch.allow_document_verification ?? current.scopes.allow_document_verification,
    };
    const anyActive =
      nextScopes.share_with_relief_officer ||
      nextScopes.allow_ai_voice_processing ||
      nextScopes.allow_document_verification;
    const nextStatus: 'GRANTED' | 'WITHDRAWN' = anyActive ? 'GRANTED' : 'WITHDRAWN';
    const updated: CitizenGranularConsentRecord = {
      ...current,
      status: nextStatus,
      scopes: nextScopes,
      who_has_access: buildWhoHasAccess(nextScopes, nextStatus),
      updated_at: new Date().toISOString(),
    };
    this.recordsByKey.set(this.key(auth.organizationId, auth.userId), updated);

    await this.logConsentAuditEvent({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      actorRole: auth.role,
      citizenId: updated.citizen_id,
      userId: auth.userId,
      eventType: nextStatus === 'WITHDRAWN' ? 'CONSENT_WITHDRAWN' : 'CONSENT_SCOPE_UPDATED',
      summary: `Citizen updated consent scopes: officer=${nextScopes.share_with_relief_officer}, ai=${nextScopes.allow_ai_voice_processing}, docs=${nextScopes.allow_document_verification}.`,
      metadata: { scopes: nextScopes, status: nextStatus },
    });

    return structuredClone(updated);
  }

  async withdrawAllConsent(auth: AuthContext): Promise<CitizenGranularConsentRecord> {
    if (auth.role !== 'citizen') {
      throw new AppError(403, 'CONSENT_CITIZEN_ONLY', 'Only the citizen may withdraw their consent.');
    }
    const current = await this.getMyConsentRecord(auth);
    const scopes: CitizenConsentScopes = {
      share_with_relief_officer: false,
      allow_ai_voice_processing: false,
      allow_document_verification: false,
    };
    const updated: CitizenGranularConsentRecord = {
      ...current,
      status: 'WITHDRAWN',
      scopes,
      who_has_access: buildWhoHasAccess(scopes, 'WITHDRAWN'),
      updated_at: new Date().toISOString(),
    };
    this.recordsByKey.set(this.key(auth.organizationId, auth.userId), updated);

    await this.logConsentAuditEvent({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      actorRole: auth.role,
      citizenId: updated.citizen_id,
      userId: auth.userId,
      eventType: 'CONSENT_WITHDRAWN',
      summary: `Citizen ${auth.displayName} withdrew all data-sharing consent. Officer & AI access immediately revoked.`,
      metadata: { status: 'WITHDRAWN' },
    });

    return structuredClone(updated);
  }

  async grantAllConsent(auth: AuthContext): Promise<CitizenGranularConsentRecord> {
    if (auth.role !== 'citizen') {
      throw new AppError(403, 'CONSENT_CITIZEN_ONLY', 'Only the citizen may grant their consent.');
    }
    const current = await this.getMyConsentRecord(auth);
    const scopes: CitizenConsentScopes = {
      share_with_relief_officer: true,
      allow_ai_voice_processing: true,
      allow_document_verification: true,
    };
    const updated: CitizenGranularConsentRecord = {
      ...current,
      status: 'GRANTED',
      scopes,
      who_has_access: buildWhoHasAccess(scopes, 'GRANTED'),
      updated_at: new Date().toISOString(),
    };
    this.recordsByKey.set(this.key(auth.organizationId, auth.userId), updated);

    await this.logConsentAuditEvent({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      actorRole: auth.role,
      citizenId: updated.citizen_id,
      userId: auth.userId,
      eventType: 'CONSENT_GRANTED',
      summary: `Citizen ${auth.displayName} granted data-sharing consent for Relief Officer, AI Voice, and Document Verification.`,
      metadata: { status: 'GRANTED' },
    });

    return structuredClone(updated);
  }
}
