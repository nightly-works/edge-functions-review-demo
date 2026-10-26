# Edge functions and payments review of an AI-built app (demo)

A proof piece for security reviews of apps written with AI coding tools (Lovable, Bolt, Cursor, Claude Code). The fictional app sells AI-written cover letters for credits: Supabase for sign-in and data, Stripe Checkout for credit packs, and edge functions that call an LLM. The database side of such apps is covered by the companion demo, [supabase-access-review-demo](https://github.com/nightly-works/supabase-access-review-demo). This one covers everything around it: the browser bundle, the edge functions and the payment webhook.

| # | Flaw | Severity | Fix |
|---|---|---|---|
| 1 | The `service_role` key ships to every visitor, through a `VITE_` variable used by the admin page | critical | key removed from the client; `admin-grant-credits` function that checks the caller's role |
| 2 | `generate` takes `user_id` from the request body, with `verify_jwt = false`: anyone spends anyone's credits and your LLM budget | critical | user read from the verified token; gateway check back on; input length capped |
| 3 | The Stripe webhook never checks the signature: one `curl` adds 100,000 credits, and every replay adds them again | critical | signature and timestamp verified on the raw body; pack and amount checked; event recorded and credited in one transaction |
| 4 | Credits are read, then the LLM is called, then credits are written: ten parallel requests spend one credit ten times | medium | one atomic `spend_credit()` before the slow call, refund if the call fails |

Full write-up, as a client receives it: [REPORT.md](REPORT.md).

## Layout

- `flawed/` is the app as delivered; `fixed/` is the same app after the review. `git diff --no-index flawed fixed` shows every change.
- `*/supabase/functions/<name>/handler.ts` holds each function's logic; `index.ts` wires it to `Deno.serve` and the real services (`_shared/real-deps.ts`). The tests call the handlers with in-memory services, so they run under plain Node.
- `*/app/dist/assets/*.js` are excerpts of the production bundles, as the browser downloads them.
- `fixed/supabase/migrations/` adds the atomic `spend_credit()` and `credit_event()`, and the processed-events table.
- `tools/scan-bundle.ts` finds server-side secrets in a bundle or source tree (Supabase `service_role` and `sb_secret_` keys, Stripe, Anthropic and OpenAI secret keys, secret-sounding `VITE_` variables). Point it at a client's `dist/` folder: `node tools/scan-bundle.ts dist`.

## Run

Node 22.18 or later, no install step:

```
node --test tests/*.test.ts
```

`tests/attacks.test.ts` runs each attack against `flawed/` (it must succeed) and against `fixed/` (it must be refused, while normal use still works). The keys in this repository are made up and signed with a throwaway secret.

[![checks](https://github.com/nightly-works/edge-functions-review-demo/actions/workflows/checks.yml/badge.svg)](https://github.com/nightly-works/edge-functions-review-demo/actions/workflows/checks.yml)

Built by an AI agent (Claude) at [Nightly Works](https://github.com/nightly-works). MIT licence.
