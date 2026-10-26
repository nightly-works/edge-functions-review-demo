// Finds server-side secrets in what ships to the browser: a built bundle (dist/) or the app's source.
// Usage: node tools/scan-bundle.ts <dir> [<dir> ...]   Exit code 1 when anything is found.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Finding { file: string; line: number; kind: string; excerpt: string }

const JWT = /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;

// Patterns that are secret wherever they appear. Public keys (Supabase anon or sb_publishable_,
// Stripe pk_) are meant for the browser and are not reported.
const SECRET_PATTERNS: Array<[string, RegExp]> = [
  ['Supabase secret key', /sb_secret_[A-Za-z0-9_-]{16,}/g],
  ['Stripe secret or restricted key', /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/g],
  ['Anthropic API key', /sk-ant-[A-Za-z0-9_-]{20,}/g],
  ['OpenAI API key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/g],
  // Vite inlines every VITE_ variable into the bundle, so a secret-sounding name is a leak in waiting.
  ['Secret in a VITE_ variable', /\bVITE_[A-Z0-9_]*(?:SERVICE_ROLE|SECRET|PRIVATE)[A-Z0-9_]*/g],
];

const SCANNED = /\.(?:js|mjs|cjs|ts|tsx|jsx|html|map|env|json)$|^\.env/;

export function scan(dir: string): Finding[] {
  const findings: Finding[] = [];
  for (const file of walk(dir)) {
    readFileSync(file, 'utf8').split('\n').forEach((text, i) => {
      for (const m of text.matchAll(JWT)) {
        const role = jwtRole(m[0]);
        if (role === 'service_role') findings.push({ file, line: i + 1, kind: 'Supabase service_role key', excerpt: m[0].slice(0, 24) + '…' });
      }
      for (const [kind, re] of SECRET_PATTERNS) {
        for (const m of text.matchAll(re)) findings.push({ file, line: i + 1, kind, excerpt: m[0].slice(0, 24) + '…' });
      }
    });
  }
  return findings;
}

function jwtRole(token: string): string | undefined {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).role;
  } catch {
    return undefined;
  }
}

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (SCANNED.test(name)) yield path;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dirs = process.argv.slice(2);
  if (dirs.length === 0) {
    console.error('usage: node tools/scan-bundle.ts <dir> [<dir> ...]');
    process.exit(2);
  }
  const findings = dirs.flatMap(scan);
  for (const f of findings) console.log(`${f.file}:${f.line}  ${f.kind}  ${f.excerpt}`);
  console.log(findings.length === 0 ? 'no secrets found' : `${findings.length} finding(s)`);
  process.exit(findings.length === 0 ? 0 : 1);
}
