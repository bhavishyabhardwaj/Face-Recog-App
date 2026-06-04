import {SYNC} from '../config';
import {
  AuthRecord,
  getQueue,
  updateRecord,
  purgeRecord,
  appendAudit,
} from './encryptedStorage';
import {verifyRecord} from './recordSigner';
import {isOnline, onConnectivityChange} from '../utils/networkStatus';

/**
 * Offline-first sync. Records live in an encrypted local queue. When the network
 * returns we upload each pending record; the server replies and:
 *   - confirms  -> mark synced, then purge the local copy
 *   - rejects   -> keep record, mark failed for admin review
 *   - transient -> retry with exponential backoff, queue preserved
 *
 * Local tamper check (verifyRecord) runs before every upload.
 */

let syncing = false;
let unsubscribe: (() => void) | null = null;

export type SyncProgress = (msg: string) => void;

function backoff(attempt: number): number {
  return Math.min(SYNC.baseBackoffMs * 2 ** attempt, SYNC.maxBackoffMs);
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function uploadOne(rec: AuthRecord): Promise<'confirmed' | 'rejected' | 'retry'> {
  // Reject locally tampered records outright.
  if (!(await verifyRecord(rec))) {
    appendAudit({event: 'tamper_detected', id: rec.id});
    return 'rejected';
  }
  try {
    const res = await fetch(SYNC.endpoint, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(rec),
    });
    if (res.status === 200) return 'confirmed';
    if (res.status >= 400 && res.status < 500) return 'rejected'; // bad/invalid -> review
    return 'retry'; // 5xx -> transient
  } catch {
    return 'retry'; // network blip
  }
}

/** Attempt to drain the queue once. Safe to call repeatedly; self-guards. */
export async function syncNow(onProgress?: SyncProgress): Promise<void> {
  if (syncing) return;
  if (!(await isOnline())) {
    onProgress?.('Offline — queue preserved.');
    return;
  }
  syncing = true;
  try {
    const pending = getQueue().filter(r => r.status !== 'synced');
    onProgress?.(`Syncing ${pending.length} record(s)…`);

    for (const rec of pending) {
      let result = await uploadOne(rec);
      let attempt = rec.retryCount;

      while (result === 'retry' && attempt < SYNC.maxRetries) {
        await sleep(backoff(attempt));
        if (!(await isOnline())) break; // lost network mid-retry; keep queue
        attempt += 1;
        updateRecord(rec.id, {retryCount: attempt});
        result = await uploadOne(rec);
      }

      if (result === 'confirmed') {
        updateRecord(rec.id, {status: 'synced'});
        purgeRecord(rec.id); // purge ONLY after server confirmation
        onProgress?.(`Synced & purged ${rec.id}`);
      } else if (result === 'rejected') {
        updateRecord(rec.id, {status: 'failed', serverError: 'server_rejected'});
        onProgress?.(`Rejected ${rec.id} — kept for admin review`);
      } else {
        updateRecord(rec.id, {status: 'pending', retryCount: attempt});
        onProgress?.(`Retry budget hit for ${rec.id} — will retry later`);
      }
    }
    onProgress?.('Sync pass complete.');
  } finally {
    syncing = false;
  }
}

/** Auto-sync whenever connectivity returns. Call once at app start. */
export function startAutoSync(onProgress?: SyncProgress): void {
  if (unsubscribe) return;
  unsubscribe = onConnectivityChange(online => {
    if (online) syncNow(onProgress);
  });
}

export function stopAutoSync(): void {
  unsubscribe?.();
  unsubscribe = null;
}
