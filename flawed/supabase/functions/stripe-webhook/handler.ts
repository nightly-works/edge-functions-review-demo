import type { Deps } from '../_shared/deps.ts';
import { json } from '../_shared/http.ts';

// Adds the purchased credits when Stripe reports a completed checkout.
export async function handler(req: Request, deps: Deps): Promise<Response> {
  const event = await req.json();

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    await deps.store.addCredits(session.metadata.user_id, Number(session.metadata.credits));
  }
  return json({ received: true });
}
