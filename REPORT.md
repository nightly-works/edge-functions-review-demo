# Security review: Cover Letter AI (sample report)

*Cover Letter AI is a fictional app built for this demo.*

**Scope**: browser bundle, Supabase edge functions (`generate`, `stripe-webhook`), function settings in `supabase/config.toml`. Database policies are out of scope here (see the companion database review).
**Method**: source read, then each suspected flaw reproduced as an automated attack against a copy of the app; fixes applied to the copy and the same attacks re-run. No production system was touched.
**Result**: 4 findings, 3 critical. All fixed in the copy, each with a test that fails if the flaw comes back.

## Summary for the owner

Today a stranger can, without an account: read and change every row in the database with a key your site hands out, use other people's credits and your AI budget, and give themselves unlimited credits without paying. Replace the leaked key first: in Project Settings › API Keys, create a secret key and give it to the functions, switch the app to the publishable key, then deactivate the legacy `anon` and `service_role` keys. Then deploy the fixed functions. About half a day of work in total.

## Findings

### 1. Database master key in the public website (critical)

**What**: `src/lib/supabase.ts` creates an admin client from `VITE_SUPABASE_SERVICE_ROLE_KEY`. Vite inlines every `VITE_` variable the code uses into the JavaScript that every visitor downloads, so the key is in `dist/assets/index-*.js`. The `service_role` key bypasses all row-level security.
**Impact**: anyone who opens the browser's developer tools can read, change or delete every row of every table, including other users' data and credit balances. Hiding the admin page from non-admins does not hide the key.
**Reproduced**: `tools/scan-bundle.ts` finds the key in the built bundle (test 1, flawed).
**Fix**: the admin client is gone from the browser. Granting credits goes through a new `admin-grant-credits` function that verifies the caller's token and admin flag on the server and caps the amount. The key has been public, so it must be **replaced and the legacy keys deactivated** (see the summary).
**Verified**: the scanner finds nothing in `fixed/app`; the function refuses anonymous callers (401) and non-admins (403) (test 1, fixed).

### 2. Anyone can spend anyone's credits (critical)

**What**: `generate` reads `user_id` from the JSON body and is deployed with `verify_jwt = false`.
**Impact**: a request with no sign-in and someone else's user id charges that user and runs a paid LLM call on your account. User ids show up in URLs and API responses, and the endpoint alone is enough to burn the LLM budget.
**Reproduced**: a request without any token spends Alice's credit (test 2, flawed).
**Fix**: the user is taken from the verified access token (`auth.getUser`), any `user_id` in the body is ignored, the gateway check is back on, and the job description is capped at 8,000 characters.
**Verified**: no token or a forged token gives 401; Bob naming Alice is charged himself; Alice's own request works (test 2, fixed).

### 3. Free credits from a fake payment notification (critical)

**What**: `stripe-webhook` trusts any JSON it receives. It must have `verify_jwt = false`, since Stripe sends no Supabase token, so nothing checks the sender.
**Impact**: one request with `"credits": "100000"` adds 100,000 credits; repeating it adds them again.
**Reproduced**: two unsigned requests add 200,000 credits (test 3, flawed).
**Fix**: the `Stripe-Signature` header is checked against the raw body with the webhook secret, and events older than 5 minutes are refused. Credits come from a pack list in the function, only for paid sessions whose amount matches the pack. Recording the event id and adding the credits happen in one transaction (`credit_event()`), so Stripe's retries neither credit twice nor lose a purchase after a failure.
**Verified**: unsigned, wrongly signed, stale, unpaid and underpaid events add nothing; a genuine event delivered twice credits once (test 3, fixed).

### 4. One credit, many generations (medium)

**What**: `generate` reads the balance, waits for the LLM, then writes `balance − 1`. Parallel requests all read the same balance.
**Impact**: a user with one credit who sends ten requests at once gets ten letters, and you pay for ten LLM calls.
**Reproduced**: ten parallel requests, ten letters, one credit charged (test 4, flawed).
**Fix**: `spend_credit()` checks and charges in one SQL statement before the LLM call; a failed LLM call refunds the credit. The function is executable by the server only.
**Verified**: ten parallel requests with one credit give one letter and nine "no credits" answers; a failed call refunds (test 4, fixed; refund test).

## Checked next in a full review

Row-level security and column privileges on every table, storage bucket policies, rate limits per user and per IP on the LLM function, CORS origins, and the `create-checkout` function that sets the pack and `client_reference_id`.
