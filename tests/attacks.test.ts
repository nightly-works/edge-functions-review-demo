// Each finding of REPORT.md as an attack: it must succeed against flawed/ and fail against fixed/,
// and normal use must keep working in fixed/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handler as flawedGenerate } from '../flawed/supabase/functions/generate/handler.ts';
import { handler as fixedGenerate } from '../fixed/supabase/functions/generate/handler.ts';
import { handler as flawedWebhook } from '../flawed/supabase/functions/stripe-webhook/handler.ts';
import { handler as fixedWebhook } from '../fixed/supabase/functions/stripe-webhook/handler.ts';
import { handler as adminGrant } from '../fixed/supabase/functions/admin-grant-credits/handler.ts';
import { scan } from '../tools/scan-bundle.ts';
import { ADMIN, ALICE, BOB, NOW, bearer, checkoutCompleted, makeDeps, post, stripeDelivery, tokenFor } from './helpers.ts';

const job = { job_description: 'Junior data analyst, Lyon' };

test('1. flawed: the service_role key ships in the browser bundle', () => {
  const kinds = scan('flawed/app/dist').map((f) => f.kind);
  assert.ok(kinds.includes('Supabase service_role key'));
  assert.ok(scan('flawed/app/src').some((f) => f.kind === 'Secret in a VITE_ variable'));
});

test('1. fixed: no secret in the bundle or the source; credits granted through a checked function', async () => {
  assert.deepEqual(scan('fixed/app'), []);
  const { deps, credits } = makeDeps({ [ALICE]: 0, [BOB]: 0 });
  assert.equal((await adminGrant(post({ user_id: BOB, credits: 50 }), deps)).status, 401);
  assert.equal((await adminGrant(post({ user_id: BOB, credits: 50 }, bearer(BOB)), deps)).status, 403);
  assert.equal((await adminGrant(post({ user_id: ALICE, credits: 5 }, bearer(ADMIN)), deps)).status, 200);
  assert.equal((await adminGrant(post({ user_id: ALICE, credits: 1e9 }, bearer(ADMIN)), deps)).status, 400);
  assert.deepEqual(credits, { [ALICE]: 5, [BOB]: 0 });
});

test("2. flawed: anyone spends another user's credits without signing in", async () => {
  const { deps, credits, generations } = makeDeps({ [ALICE]: 3, [BOB]: 0 });
  const res = await flawedGenerate(post({ user_id: ALICE, ...job }), deps); // no Authorization header
  assert.equal(res.status, 200);
  assert.equal(credits[ALICE], 2);
  assert.equal(generations[0].userId, ALICE);
});

test('2. fixed: the user comes from a verified token; the body cannot name someone else', async () => {
  const { deps, credits, llmCalls } = makeDeps({ [ALICE]: 3, [BOB]: 0 });
  assert.equal((await fixedGenerate(post({ user_id: ALICE, ...job }), deps)).status, 401);
  assert.equal((await fixedGenerate(post({ user_id: ALICE, ...job }, { Authorization: `Bearer ${tokenFor(ALICE, 'guessed-secret')}` }), deps)).status, 401);
  assert.equal((await fixedGenerate(post({ user_id: ALICE, ...job }, bearer(BOB)), deps)).status, 402); // Bob is charged, and has nothing
  assert.equal(credits[ALICE], 3);
  assert.equal(llmCalls.length, 0);

  const ok = await fixedGenerate(post(job, bearer(ALICE)), deps);
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { letter: 'Dear hiring manager, ...', credits_left: 2 });
});

test('3. flawed: an unsigned request to the webhook adds credits for free, and replays add more', async () => {
  const { deps, credits } = makeDeps({ [ALICE]: 0, [BOB]: 0 });
  const forged = { id: 'evt_forged', type: 'checkout.session.completed', data: { object: { metadata: { user_id: BOB, credits: '100000' } } } };
  await flawedWebhook(post(forged), deps);
  await flawedWebhook(post(forged), deps);
  assert.equal(credits[BOB], 200000);
});

test('3. fixed: only signed, fresh, paid, matching and first-seen events add credits', async () => {
  const { deps, credits } = makeDeps({ [ALICE]: 0, [BOB]: 0 });
  const forged = checkoutCompleted('evt_forged', { client_reference_id: BOB });
  assert.equal((await fixedWebhook(post(forged), deps)).status, 400); // no signature
  assert.equal((await fixedWebhook(stripeDelivery(forged, { secret: 'whsec_guessed' }), deps)).status, 400);
  assert.equal((await fixedWebhook(stripeDelivery(checkoutCompleted('evt_old'), { t: NOW - 3600 }), deps)).status, 400); // replayed capture
  await fixedWebhook(stripeDelivery(checkoutCompleted('evt_unpaid', { payment_status: 'unpaid' })), deps);
  await fixedWebhook(stripeDelivery(checkoutCompleted('evt_cheap', { amount_total: 1, metadata: { pack: 'pro' } })), deps);
  assert.deepEqual(credits, { [ALICE]: 0, [BOB]: 0 });

  // A real purchase, delivered twice as Stripe does on retries: credited once.
  const paid = checkoutCompleted('evt_paid');
  assert.equal((await fixedWebhook(stripeDelivery(paid), deps)).status, 200);
  assert.equal((await fixedWebhook(stripeDelivery(paid), deps)).status, 200);
  assert.equal(credits[ALICE], 10);
});

test('4. flawed: parallel requests turn one credit into many generations', async () => {
  const { deps, credits, llmCalls } = makeDeps({ [ALICE]: 1, [BOB]: 0 });
  const results = await Promise.all(Array.from({ length: 10 }, () => flawedGenerate(post({ user_id: ALICE, ...job }), deps)));
  assert.equal(results.filter((r) => r.status === 200).length, 10);
  assert.equal(llmCalls.length, 10); // ten paid LLM calls for one credit
  assert.equal(credits[ALICE], 0);
});

test('4. fixed: parallel requests get exactly as many generations as credits', async () => {
  const { deps, credits, llmCalls } = makeDeps({ [ALICE]: 1, [BOB]: 0 });
  const results = await Promise.all(Array.from({ length: 10 }, () => fixedGenerate(post(job, bearer(ALICE)), deps)));
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  assert.equal(results.filter((r) => r.status === 402).length, 9);
  assert.equal(llmCalls.length, 1);
  assert.equal(credits[ALICE], 0);
});

test('fixed: a failed LLM call refunds the credit', async () => {
  const { deps, credits } = makeDeps({ [ALICE]: 1, [BOB]: 0 });
  deps.llm.complete = async () => { throw new Error('upstream 529'); };
  assert.equal((await fixedGenerate(post(job, bearer(ALICE)), deps)).status, 502);
  assert.equal(credits[ALICE], 1);
});

test('fixed: a webhook that fails mid-way credits the buyer on Stripe\'s retry', async () => {
  const { deps, credits } = makeDeps({ [ALICE]: 0, [BOB]: 0 });
  const creditEvent = deps.store.creditEvent;
  deps.store.creditEvent = async () => { throw new Error('connection reset'); }; // the transaction rolls back
  await assert.rejects(fixedWebhook(stripeDelivery(checkoutCompleted('evt_retry')), deps)); // Stripe sees a 500
  deps.store.creditEvent = creditEvent;
  assert.equal((await fixedWebhook(stripeDelivery(checkoutCompleted('evt_retry')), deps)).status, 200);
  assert.equal(credits[ALICE], 10);
});
