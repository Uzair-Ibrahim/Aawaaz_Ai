import type { ConsentRecord } from '@awaaz/shared';
import type { AuditService } from '../../../core/audit/audit-service';
import type { AuthContext } from '../../../core/auth/auth-service';
import type { DataStore } from '../../../core/database/types';
import { AppError } from '../../../core/security/errors';

export class ConsentService {
  constructor(
    private readonly store: DataStore,
    private readonly audit: AuditService,
  ) {}

  async grantConsent(
    auth: AuthContext,
    input: {
      consent_type: 'processing' | 'helper_delegation';
      helper_id?: string | null;
      case_id?: string | null;
      permissions: string[];
      expires_at?: string | null;
    },
  ): Promise<ConsentRecord> {
    // Only citizens can grant consent (helpers can NEVER grant consent on a citizen's behalf)
    if (auth.role !== 'citizen') {
      throw new AppError(
        403,
        'CONSENT_CITIZEN_ONLY',
        'Only the citizen may grant processing or helper-delegation consent.',
      );
    }

    let citizen = await this.store.getCitizenByUserId(auth.organizationId, auth.userId);
    if (!citizen) {
      citizen = await this.store.createCitizen({
        organization_id: auth.organizationId,
        user_id: auth.userId,
        display_name: auth.displayName,
        mock_identity_reference: `MOCK-ID-${auth.userId.slice(0, 8).toUpperCase()}`,
      });
    }

    if (input.consent_type === 'helper_delegation') {
      if (!input.helper_id) {
        throw new AppError(400, 'HELPER_ID_REQUIRED', 'helper_id is required for helper_delegation consent.');
      }
      const helperMembership = await this.store.getMembership(auth.organizationId, input.helper_id);
      if (!helperMembership || helperMembership.role !== 'helper') {
        throw new AppError(
          400,
          'INVALID_HELPER',
          'Target helper must be an active Community Helper in your workspace.',
        );
      }
    }

    const consent = await this.store.createConsent({
      organization_id: auth.organizationId,
      citizen_id: citizen.id,
      helper_id: input.consent_type === 'helper_delegation' ? (input.helper_id ?? null) : null,
      case_id: input.case_id ?? null,
      consent_type: input.consent_type,
      permissions: input.permissions,
      expires_at: input.expires_at ?? null,
    });

    await this.audit.log({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'consent.granted',
      resourceType: 'consent',
      resourceId: consent.id,
      metadata: {
        consent_type: consent.consent_type,
        helper_id: consent.helper_id,
        case_id: consent.case_id,
        permissions: consent.permissions,
      },
    });

    return consent;
  }

  async withdrawConsent(auth: AuthContext, consentId: string): Promise<ConsentRecord> {
    const existing = await this.store.getConsentById(auth.organizationId, consentId);
    if (!existing) {
      throw new AppError(404, 'CONSENT_NOT_FOUND', 'Consent record not found.');
    }

    const citizen = await this.store.getCitizenById(auth.organizationId, existing.citizen_id);
    if (!citizen || citizen.user_id !== auth.userId) {
      throw new AppError(403, 'CONSENT_WITHDRAW_FORBIDDEN', 'You can only withdraw your own consent records.');
    }

    const withdrawn = await this.store.withdrawConsent(auth.organizationId, consentId);

    await this.audit.log({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'consent.withdrawn',
      resourceType: 'consent',
      resourceId: withdrawn.id,
      metadata: {
        consent_type: withdrawn.consent_type,
        helper_id: withdrawn.helper_id,
        case_id: withdrawn.case_id,
        withdrawn_at: withdrawn.withdrawn_at,
      },
    });

    return withdrawn;
  }

  async hasActiveProcessingConsent(organizationId: string, citizenId: string, caseId?: string): Promise<boolean> {
    const consents = await this.store.listConsents(organizationId, {
      citizenId,
      caseId,
      activeOnly: true,
    });
    return consents.some((c) => c.consent_type === 'processing');
  }

  async hasActiveHelperConsent(
    organizationId: string,
    helperUserId: string,
    citizenId: string,
    caseId?: string,
  ): Promise<boolean> {
    const consents = await this.store.listConsents(organizationId, {
      citizenId,
      helperId: helperUserId,
      caseId,
      activeOnly: true,
    });
    return consents.some((c) => c.consent_type === 'helper_delegation');
  }

  async listAuthorizedConsents(auth: AuthContext): Promise<ConsentRecord[]> {
    if (auth.role === 'admin' || auth.role === 'officer') {
      return this.store.listConsents(auth.organizationId);
    }
    if (auth.role === 'helper') {
      return this.store.listConsents(auth.organizationId, { helperId: auth.userId });
    }
    if (auth.role === 'citizen') {
      const citizen = await this.store.getCitizenByUserId(auth.organizationId, auth.userId);
      if (!citizen) return [];
      return this.store.listConsents(auth.organizationId, { citizenId: citizen.id });
    }
    throw new AppError(403, 'FORBIDDEN', 'Role cannot list citizen consent records.');
  }
}
