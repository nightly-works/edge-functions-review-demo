import type { Deps } from '../_shared/deps.ts';
import { corsHeaders, json } from '../_shared/http.ts';

// Writes a cover letter for a job description and charges the user one credit.
export async function handler(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const { user_id, job_description } = await req.json();

  const credits = await deps.store.getCredits(user_id);
  if (credits < 1) return json({ error: 'No credits left' }, 402);

  const letter = await deps.llm.complete(`Write a cover letter for this job:\n${job_description}`);

  await deps.store.setCredits(user_id, credits - 1);
  await deps.store.saveGeneration(user_id, letter);
  return json({ letter, credits_left: credits - 1 });
}
