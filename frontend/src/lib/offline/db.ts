import Dexie, { type Table } from 'dexie';
import type { AnswerSource, ApplicationFieldName, LanguageCode } from '@awaaz/shared';

export type OfflineSyncStatus = 'local_only' | 'pending_sync' | 'synced' | 'conflict' | 'error';

export interface OfflineDraftAnswer {
  field_name: ApplicationFieldName;
  field_value: string | number | boolean;
  source: AnswerSource;
  confirmed_by_citizen: boolean;
}

export interface OfflineCaseDraft {
  localDraftId: string;
  organizationId: string;
  userId: string;
  serverCaseId: string | null;
  idempotencyKey: string;
  preferredLanguage: LanguageCode;
  currentStep: string;
  answers: Record<string, OfflineDraftAnswer>;
  updatedAt: string;
  serverUpdatedAt: string | null;
  syncStatus: OfflineSyncStatus;
  schemaVersion: number;
  lastError: string | null;
}

class AwaazOfflineDatabase extends Dexie {
  drafts!: Table<OfflineCaseDraft, string>;

  constructor() {
    super('awaaz_offline_db');
    this.version(1).stores({
      drafts: 'localDraftId, organizationId, userId, serverCaseId, idempotencyKey, syncStatus, updatedAt',
    });
  }
}

export const offlineDb = new AwaazOfflineDatabase();

export async function saveLocalDraft(draft: OfflineCaseDraft): Promise<void> {
  await offlineDb.drafts.put({
    ...draft,
    updatedAt: new Date().toISOString(),
    schemaVersion: 1,
  });
}

export async function listLocalDrafts(organizationId: string, userId: string): Promise<OfflineCaseDraft[]> {
  return offlineDb.drafts
    .where('organizationId')
    .equals(organizationId)
    .and((d) => d.userId === userId)
    .reverse()
    .sortBy('updatedAt');
}

export async function clearUnauthorizedLocalCache(organizationId: string, caseId?: string): Promise<void> {
  if (caseId) {
    const matches = await offlineDb.drafts
      .where('serverCaseId')
      .equals(caseId)
      .and((d) => d.organizationId === organizationId)
      .toArray();
    await offlineDb.drafts.bulkDelete(matches.map((m) => m.localDraftId));
    return;
  }
  const matches = await offlineDb.drafts.where('organizationId').equals(organizationId).toArray();
  await offlineDb.drafts.bulkDelete(matches.map((m) => m.localDraftId));
}
