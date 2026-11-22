import type { AuditLogEntry } from '@awaaz/shared';
import type { DataStore } from '../database/types';

export class AuditService {
  constructor(private readonly store: DataStore) {}

  async log(input: {
    organizationId: string;
    actorId: string | null;
    action: string;
    resourceType: string;
    resourceId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<AuditLogEntry> {
    return this.store.appendAuditLog({
      organization_id: input.organizationId,
      actor_id: input.actorId,
      action: input.action,
      resource_type: input.resourceType,
      resource_id: input.resourceId ?? null,
      metadata: input.metadata ?? {},
    });
  }

  async list(
    organizationId: string,
    filters?: { resourceType?: string; resourceId?: string; limit?: number },
  ): Promise<AuditLogEntry[]> {
    return this.store.listAuditLogs(organizationId, filters);
  }
}
