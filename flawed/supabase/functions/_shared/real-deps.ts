// Production wiring for Supabase Edge Functions (Deno). Not run by the tests, which use in-memory deps.
import { createClient } from 'npm:@supabase/supabase-js@2';
import type { Deps } from './deps.ts';

export function realDeps(): Deps {
  // Server-side only: this key never leaves the function's environment.
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  return {
    store: {
      async getCredits(userId) {
        const { data, error } = await db.from('profiles').select('credits').eq('id', userId).single();
        if (error) throw error;
        return data.credits;
      },
      async setCredits(userId, credits) {
        const { error } = await db.from('profiles').update({ credits }).eq('id', userId);
        if (error) throw error;
      },
      async addCredits(userId, credits) {
        const { error } = await db.rpc('add_credits', { p_user: userId, p_credits: credits });
        if (error) throw error;
      },
      async spendCredit(userId) {
        const { data, error } = await db.rpc('spend_credit', { p_user: userId });
        if (error) throw error;
        return data === true;
      },
      async saveGeneration(userId, text) {
        const { error } = await db.from('generations').insert({ user_id: userId, text });
        if (error) throw error;
      },
      async isAdmin(userId) {
        const { data, error } = await db.from('profiles').select('is_admin').eq('id', userId).single();
        if (error) throw error;
        return data.is_admin === true;
      },
      async creditEvent(eventId, userId, credits) {
        const { data, error } = await db.rpc('credit_event', { p_event: eventId, p_user: userId, p_credits: credits });
        if (error) throw error;
        return data === true;
      },
    },
    llm: {
      async complete(prompt) {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: 'claude-haiku-5-5',
            max_tokens: 1024,
            messages: [{ role: 'user', content: prompt }],
          }),
        });
        if (!res.ok) throw new Error(`LLM call failed: ${res.status}`);
        const out = await res.json();
        return out.content[0].text;
      },
    },
    async userFromRequest(req) {
      const token = req.headers.get('Authorization')?.replace(/^Bearer /, '');
      if (!token) return null;
      const { data, error } = await db.auth.getUser(token);
      return error || !data.user ? null : data.user.id;
    },
    env: { STRIPE_WEBHOOK_SECRET: Deno.env.get('STRIPE_WEBHOOK_SECRET')! },
    now: () => Math.floor(Date.now() / 1000),
  };
}
