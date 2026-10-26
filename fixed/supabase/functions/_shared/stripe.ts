// Stripe webhook signature check (Stripe-Signature: t=<unix time>,v1=<hex HMAC-SHA256 of "t.body">).
// Web Crypto only, so the same code runs on Deno and Node. Stripe's SDK offers the same check as
// constructEventAsync; this version keeps the demo dependency-free.
const TOLERANCE_SECONDS = 300;

export async function verifyStripeEvent(
  rawBody: string,
  header: string | null,
  secret: string,
  now: number,
): Promise<any | null> {
  if (!header || !secret) return null;
  const parts = header.split(',').map((p) => p.split('='));
  const t = Number(parts.find(([k]) => k === 't')?.[1]);
  const signatures = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!Number.isFinite(t) || signatures.length === 0) return null;
  if (Math.abs(now - t) > TOLERANCE_SECONDS) return null; // stale: a replayed capture

  const expected = await hmacHex(secret, `${t}.${rawBody}`);
  if (!signatures.some((s) => constantTimeEqual(s, expected))) return null;
  return JSON.parse(rawBody);
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
  return Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
