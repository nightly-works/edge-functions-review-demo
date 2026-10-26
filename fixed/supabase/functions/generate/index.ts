// Deployed entry point (Deno on Supabase Edge Functions). The tests import handler.ts directly.
import { handler } from './handler.ts';
import { realDeps } from '../_shared/real-deps.ts';

Deno.serve((req) => handler(req, realDeps()));
