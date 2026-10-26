import type { Deps } from '../_shared/deps.ts';
import { json } from '../_shared/http.ts';
import { verifyStripeEvent } from '../_shared/stripe.ts';

// Credit packs as sold on the pricing page. The amount paid must match the pack, so a session
// created with a tampered pack name or price adds nothing.
export const PACKS: Record<string, { credits: number; amountCents: number }> = {
  starter: { credits: 10, amountCents: 500 },
  pro: { credits: 50, amountCents: 2000 },
};

// Adds the purchased credits when Stripe reports a paid checkout.
export async function handler(req: Request, deps: Deps): Promise<Response> {
  // The signature covers the raw bytes: read text, never re-serialised JSON.
  const rawBody = await req.text();
  const event = await verifyStripeEvent(rawBody, req.headers.get('stripe-signature'), deps.env.STRIPE_WEBHOOK_SECRET, deps.now());
  if (!event) return json({ error: 'Invalid signature' }, 400);

  if (event.type !== 'checkout.session.completed') return json({ received: true });

  const session = event.data.object;
  const pack = PACKS[session.metadata?.pack];
  const userId = session.client_reference_id;
  if (session.payment_status !== 'paid' || !pack || !userId || session.amount_total !== pack.amountCents) {
    return json({ received: true, credited: 0 });
  }

  // Stripe retries deliveries: each event adds credits once. Recording the event and adding the
  // credits happen together, so a failure leaves neither and Stripe's retry credits the buyer.
  if (!(await deps.store.creditEvent(event.id, userId, pack.credits))) return json({ received: true, duplicate: true });
  return json({ received: true, credited: pack.credits });
}
