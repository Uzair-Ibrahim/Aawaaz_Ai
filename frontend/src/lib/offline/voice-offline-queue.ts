export interface OfflineQueuedReliefClaim {
  id: string;
  created_at: string;
  district: string;
  monthly_income: number;
  amount: number;
  reason: string;
  language: string;
  status: 'QUEUED_OFFLINE' | 'SYNCING' | 'SYNCED';
  synced_reference?: string | null;
}

const DRAFT_KEY = 'awaaz_voice_draft_v1';
const QUEUE_KEY = 'awaaz_offline_claim_queue_v1';
const SIM_OFFLINE_KEY = 'awaaz_simulated_offline_v1';
export const NETWORK_MODE_EVENT = 'awaaz-network-mode-change';

export function isSimulatedOffline(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(SIM_OFFLINE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setSimulatedOffline(offline: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (offline) {
      window.localStorage.setItem(SIM_OFFLINE_KEY, 'true');
    } else {
      window.localStorage.removeItem(SIM_OFFLINE_KEY);
    }
    window.dispatchEvent(new CustomEvent(NETWORK_MODE_EVENT, { detail: { offline } }));
  } catch {
    // Ignore storage quota errors
  }
}

export function isEffectiveOffline(): boolean {
  if (typeof window === 'undefined') return false;
  return !navigator.onLine || isSimulatedOffline();
}

export function savePersistedVoiceDraft(draft: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...draft, saved_at: new Date().toISOString() }));
  } catch {
    // Ignore
  }
}

export function loadPersistedVoiceDraft(): Record<string, unknown> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function listOfflineQueuedClaims(): OfflineQueuedReliefClaim[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(QUEUE_KEY);
    const parsed = raw ? (JSON.parse(raw) as OfflineQueuedReliefClaim[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function enqueueOfflineReliefClaim(
  input: Omit<OfflineQueuedReliefClaim, 'id' | 'created_at' | 'status'>,
): OfflineQueuedReliefClaim {
  const item: OfflineQueuedReliefClaim = {
    ...input,
    id: `offline-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    created_at: new Date().toISOString(),
    status: 'QUEUED_OFFLINE',
  };
  const current = listOfflineQueuedClaims();
  current.unshift(item);
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(QUEUE_KEY, JSON.stringify(current));
    } catch {
      // Ignore
    }
  }
  return item;
}

export function removeOfflineQueuedClaim(id: string): OfflineQueuedReliefClaim[] {
  const next = listOfflineQueuedClaims().filter((c) => c.id !== id);
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(QUEUE_KEY, JSON.stringify(next));
    } catch {
      // Ignore
    }
  }
  return next;
}
