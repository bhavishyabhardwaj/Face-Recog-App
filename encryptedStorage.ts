import {MMKV} from 'react-native-mmkv';
import * as Keychain from 'react-native-keychain';
import {KEYCHAIN_SERVICE} from '../config';

/**
 * Encrypted local storage.
 *
 * - A 256-bit device secret is generated once and stored in the OS keystore
 *   (Android Keystore / iOS Keychain) via react-native-keychain.
 * - That secret encrypts the MMKV store (AES) AND keys the HMAC record signer.
 * - We store encrypted face *embeddings* (templates), the sync queue, and a
 *   capped audit log. We never store raw face images.
 */

export interface EnrolledTemplate {
  employeeId: string;
  embedding: number[]; // L2-normalized average embedding
  modelVersion: string;
  createdAt: string; // ISO
}

export type RecordStatus = 'pending' | 'synced' | 'failed';

export interface AuthRecord {
  id: string; // uuid-ish
  employeeId: string;
  timestamp: string; // ISO
  deviceId: string;
  modelVersion: string;
  livenessPassed: boolean;
  confidence: number; // cosine similarity
  challengeSequence: string[];
  gps?: {lat: number; lng: number} | null;
  signature: string; // HMAC-SHA256 of the canonical payload
  status: RecordStatus;
  retryCount: number;
  serverError?: string;
}

let mmkv: MMKV | null = null;
let cachedSecret: string | null = null;

/** Generate a random 256-bit hex secret. */
function randomSecret(): string {
  const bytes = new Uint8Array(32);
  // global.crypto.getRandomValues exists in RN 0.76 via built-in support;
  // fall back to Math.random only if unavailable (dev only).
  const g: any = global as any;
  if (g.crypto?.getRandomValues) {
    g.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/** Load (or create) the device secret from the OS keystore. */
export async function getDeviceSecret(): Promise<string> {
  if (cachedSecret) return cachedSecret;
  const existing = await Keychain.getGenericPassword({service: KEYCHAIN_SERVICE});
  if (existing && existing.password) {
    cachedSecret = existing.password;
    return cachedSecret;
  }
  const secret = randomSecret();
  await Keychain.setGenericPassword('devicesecret', secret, {
    service: KEYCHAIN_SERVICE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  cachedSecret = secret;
  return secret;
}

/** Initialize the encrypted MMKV store. Call once at app start. */
export async function initStorage(): Promise<void> {
  if (mmkv) return;
  const secret = await getDeviceSecret();
  mmkv = new MMKV({id: 'faceauth-secure', encryptionKey: secret});
}

function store(): MMKV {
  if (!mmkv) throw new Error('Storage not initialized — call initStorage() first.');
  return mmkv;
}

/* ----------------------------- Device id ----------------------------- */

export function getDeviceId(): string {
  const KEY = 'device.id';
  let id = store().getString(KEY);
  if (!id) {
    id = 'dev_' + randomSecret().slice(0, 16);
    store().set(KEY, id);
  }
  return id;
}

/* --------------------------- Enrollment ------------------------------ */

const TPL_PREFIX = 'tpl.';

export function saveTemplate(t: EnrolledTemplate): void {
  store().set(TPL_PREFIX + t.employeeId, JSON.stringify(t));
}

export function getTemplate(employeeId: string): EnrolledTemplate | null {
  const raw = store().getString(TPL_PREFIX + employeeId);
  return raw ? (JSON.parse(raw) as EnrolledTemplate) : null;
}

export function listTemplates(): EnrolledTemplate[] {
  return store()
    .getAllKeys()
    .filter(k => k.startsWith(TPL_PREFIX))
    .map(k => JSON.parse(store().getString(k)!) as EnrolledTemplate);
}

/* ----------------------------- Queue --------------------------------- */

const QUEUE_KEY = 'queue.records';

export function getQueue(): AuthRecord[] {
  const raw = store().getString(QUEUE_KEY);
  return raw ? (JSON.parse(raw) as AuthRecord[]) : [];
}

function writeQueue(records: AuthRecord[]): void {
  store().set(QUEUE_KEY, JSON.stringify(records));
}

export function enqueueRecord(rec: AuthRecord): void {
  const q = getQueue();
  q.push(rec);
  writeQueue(q);
}

export function updateRecord(id: string, patch: Partial<AuthRecord>): void {
  const q = getQueue().map(r => (r.id === id ? {...r, ...patch} : r));
  writeQueue(q);
}

/** Purge a successfully synced record from local storage. */
export function purgeRecord(id: string): void {
  writeQueue(getQueue().filter(r => r.id !== id));
}

export function queueCounts(): {pending: number; synced: number; failed: number} {
  const q = getQueue();
  return {
    pending: q.filter(r => r.status === 'pending').length,
    synced: q.filter(r => r.status === 'synced').length,
    failed: q.filter(r => r.status === 'failed').length,
  };
}

/* --------------------------- Audit log ------------------------------- */

const AUDIT_KEY = 'audit.log';
const AUDIT_CAP = 200;

/** Capped, encrypted audit entries (no images). Useful for failed attempts. */
export function appendAudit(entry: object): void {
  const raw = store().getString(AUDIT_KEY);
  const log: object[] = raw ? JSON.parse(raw) : [];
  log.push({...entry, at: new Date().toISOString()});
  while (log.length > AUDIT_CAP) log.shift();
  store().set(AUDIT_KEY, JSON.stringify(log));
}
