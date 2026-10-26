// In-memory stand-ins for Supabase, the LLM API and Stripe, close enough to reproduce each attack.
import { createHmac } from 'node:crypto';
import type { Deps, Store } from '../fixed/supabase/functions/_shared/deps.ts';

export const JWT_SECRET = 'test-jwt-secret';
export const WEBHOOK_SECRET = 'whsec_test_secret';
export const ALICE = '00000000-0000-0000-0000-00000000000a';
export const BOB = '00000000-0000-0000-0000-00000000000b';
export const ADMIN = '00000000-0000-0000-0000-0000000000ad';
export const NOW = 1_793_000_000;

// Every database call takes a turn on the event loop, as a network round trip does.
const roundTrip = () => new Promise((r) => setImmediate(r));

export function memoryStore(credits: Record<string, number>) {
  const generations: Array<{ userId: string; text: string }> = [];
  const events = new Set<string>();
  const store: Store = {
    async getCredits(id) { await roundTrip(); return credits[id] ?? 0; },
    async setCredits(id, n) { await roundTrip(); credits[id] = n; },
    async addCredits(id, n) { await roundTrip(); credits[id] = (credits[id] ?? 0) + n; },
    async spendCredit(id) {
      await roundTrip();
      // One UPDATE ... WHERE credits > 0: no await between the check and the write.
      if ((credits[id] ?? 0) < 1) return false;
      credits[id] -= 1;
      return true;
    },
    async saveGeneration(userId, text) { await roundTrip(); generations.push({ userId, text }); },
    async isAdmin(id) { await roundTrip(); return id === ADMIN; },
    async creditEvent(eventId, userId, n) {
      await roundTrip();
      if (events.has(eventId)) return false;
      events.add(eventId);
      credits[userId] = (credits[userId] ?? 0) + n;
      return true;
    },
  };
  return { store, credits, generations };
}

// Supabase access token for a user (HS256, as projects on the legacy JWT secret issue them).
export function tokenFor(userId: string, secret = JWT_SECRET): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: userId, role: 'authenticated', exp: NOW + 3600 })}`;
  return `${head}.${createHmac('sha256', secret).update(head).digest('base64url')}`;
}

// Stands in for supabase.auth.getUser(token): signature and expiry checked, user id returned.
async function userFromRequest(req: Request): Promise<string | null> {
  const token = req.headers.get('Authorization')?.replace(/^Bearer /, '');
  const [h, p, s] = token?.split('.') ?? [];
  if (!h || !p || !s) return null;
  if (createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest('base64url') !== s) return null;
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
  return claims.exp > NOW ? claims.sub : null;
}

export function makeDeps(credits: Record<string, number>) {
  const mem = memoryStore(credits);
  const llmCalls: string[] = [];
  const deps: Deps = {
    store: mem.store,
    llm: {
      async complete(prompt) {
        llmCalls.push(prompt);
        await new Promise((r) => setTimeout(r, 5)); // the slow part of the request
        return 'Dear hiring manager, ...';
      },
    },
    userFromRequest,
    env: { STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET },
    now: () => NOW,
  };
  return { deps, ...mem, llmCalls };
}

export function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://demoref0000000000000.supabase.co/functions/v1/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

export const bearer = (userId: string) => ({ Authorization: `Bearer ${tokenFor(userId)}` });

// A Stripe delivery as Stripe signs it: v1 = HMAC-SHA256(secret, "<t>.<raw body>").
export function stripeDelivery(event: object, { secret = WEBHOOK_SECRET, t = NOW } = {}): Request {
  const raw = JSON.stringify(event);
  const sig = createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
  return post(raw, { 'stripe-signature': `t=${t},v1=${sig}` });
}

export function checkoutCompleted(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: 'checkout.session.completed',
    data: {
      object: {
        client_reference_id: ALICE,
        payment_status: 'paid',
        amount_total: 500,
        metadata: { pack: 'starter', user_id: ALICE, credits: '10' },
        ...overrides,
      },
    },
  };
}
