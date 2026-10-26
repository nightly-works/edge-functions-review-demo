import type { Deps } from '../_shared/deps.ts';
import { corsHeaders, json } from '../_shared/http.ts';

const MAX_GRANT = 1000;

// Lets an admin give credits to a user (support gestures). Replaces the admin page's direct
// service-role calls from the browser.
export async function handler(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const callerId = await deps.userFromRequest(req);
  if (!callerId) return json({ error: 'Sign in first' }, 401);
  if (!(await deps.store.isAdmin(callerId))) return json({ error: 'Admins only' }, 403);

  const body = await req.json().catch(() => null);
  const credits = body?.credits;
  if (typeof body?.user_id !== 'string' || !Number.isInteger(credits) || credits < 1 || credits > MAX_GRANT) {
    return json({ error: 'user_id and credits (1 to 1000) required' }, 400);
  }

  await deps.store.addCredits(body.user_id, credits);
  return json({ granted: credits });
}
