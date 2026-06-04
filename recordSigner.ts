import HmacSHA256 from 'crypto-js/hmac-sha256';
import Hex from 'crypto-js/enc-hex';
import {getDeviceSecret} from './encryptedStorage';
import {AuthRecord} from './encryptedStorage';

/**
 * Tamper protection. Each offline record is sealed with an HMAC-SHA256 over a
 * canonical (sorted-key) JSON of its content, keyed by the device secret.
 * The same secret is provisioned server-side (per device) so the Lambda can
 * verify the seal before accepting a record. Recompute-and-compare before sync
 * to catch local tampering.
 */

/** Build the exact byte string that gets signed. Order is fixed and explicit. */
export function canonicalPayload(
  r: Omit<AuthRecord, 'signature' | 'status' | 'retryCount' | 'serverError'>,
): string {
  return JSON.stringify({
    id: r.id,
    employeeId: r.employeeId,
    timestamp: r.timestamp,
    deviceId: r.deviceId,
    modelVersion: r.modelVersion,
    livenessPassed: r.livenessPassed,
    confidence: Number(r.confidence.toFixed(6)),
    challengeSequence: r.challengeSequence,
    gps: r.gps ?? null,
  });
}

export async function signRecord(
  r: Omit<AuthRecord, 'signature' | 'status' | 'retryCount' | 'serverError'>,
): Promise<string> {
  const secret = await getDeviceSecret();
  return HmacSHA256(canonicalPayload(r), secret).toString(Hex);
}

/** Returns true if the stored signature still matches the record content. */
export async function verifyRecord(r: AuthRecord): Promise<boolean> {
  const expected = await signRecord(r);
  return expected === r.signature;
}
