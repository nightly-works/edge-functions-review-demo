// What a function needs from the outside world. index.ts wires the real services (supabase-js, the
// LLM API); the tests pass in-memory ones, so every handler runs under Node without Supabase.
export interface Store {
  getCredits(userId: string): Promise<number>;
  setCredits(userId: string, credits: number): Promise<void>;
  addCredits(userId: string, credits: number): Promise<void>;
  // Atomic "credits = credits - 1 where credits > 0"; false when no credit was left.
  spendCredit(userId: string): Promise<boolean>;
  saveGeneration(userId: string, text: string): Promise<void>;
  isAdmin(userId: string): Promise<boolean>;
  // Records a webhook event id and adds the credits in one transaction; false when the event was seen before.
  creditEvent(eventId: string, userId: string, credits: number): Promise<boolean>;
}

export interface Deps {
  store: Store;
  llm: { complete(prompt: string): Promise<string> };
  // Returns the signed-in user's id from a verified Authorization header, or null.
  userFromRequest(req: Request): Promise<string | null>;
  env: { STRIPE_WEBHOOK_SECRET: string };
  now(): number; // seconds since the epoch
}
