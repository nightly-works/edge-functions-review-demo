import { createClient } from '@supabase/supabase-js';

// The browser only ever holds the public key; privileged work happens in edge functions.
export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);
