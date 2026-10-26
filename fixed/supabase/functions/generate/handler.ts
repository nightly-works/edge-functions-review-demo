import type { Deps } from '../_shared/deps.ts';
import { corsHeaders, json } from '../_shared/http.ts';

const MAX_JOB_DESCRIPTION = 8000;

// Writes a cover letter for a job description and charges the signed-in user one credit.
export async function handler(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // The user comes from the verified token, never from the request body.
  const userId = await deps.userFromRequest(req);
  if (!userId) return json({ error: 'Sign in first' }, 401);

  const body = await req.json().catch(() => null);
  const jobDescription = body?.job_description;
  if (typeof jobDescription !== 'string' || jobDescription.length === 0 || jobDescription.length > MAX_JOB_DESCRIPTION) {
    return json({ error: 'job_description must be 1 to 8000 characters' }, 400);
  }

  // Check and charge in one statement before the slow call, so parallel requests cannot share a credit.
  if (!(await deps.store.spendCredit(userId))) return json({ error: 'No credits left' }, 402);

  let letter: string;
  try {
    letter = await deps.llm.complete(`Write a cover letter for this job:\n${jobDescription}`);
  } catch {
    await deps.store.addCredits(userId, 1); // refund: the user got nothing
    return json({ error: 'Generation failed, credit refunded' }, 502);
  }

  // The user paid for the letter: a failed history write must not cost them it.
  await deps.store.saveGeneration(userId, letter).catch((e) => console.error('saveGeneration failed', e));
  return json({ letter, credits_left: await deps.store.getCredits(userId) });
}
