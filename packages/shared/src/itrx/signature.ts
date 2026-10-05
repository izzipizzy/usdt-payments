import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

/** JSON with keys sorted alphabetically (one level, as itrx.io documents), compact separators. */
export function sortedCompactJson(data: Record<string, unknown>): string {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(data).sort()) sorted[key] = data[key];
  return JSON.stringify(sorted);
}

/** itrx.io: SIGNATURE = HMAC-SHA256(secret, "{timestamp}&{sortedCompactJson}") hex. */
export function itrxSign(secret: string, timestamp: number | string, data: Record<string, unknown>): string {
  const message = `${timestamp}&${sortedCompactJson(data)}`;
  return bytesToHex(hmac(sha256, utf8ToBytes(secret), utf8ToBytes(message)));
}

export function itrxVerify(
  secret: string,
  timestamp: number | string,
  data: Record<string, unknown>,
  signature: string,
): boolean {
  const expected = itrxSign(secret, timestamp, data);
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}
