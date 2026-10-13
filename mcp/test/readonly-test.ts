// Static guard: the MCP server must never write. Fails on any write-style
// Supabase / Dexie / outbox call in mcp/src.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

let pass = 0, fail = 0;
function check(label: string, cond: boolean) { console.log(`${cond ? 'PASS' : 'FAIL'} — ${label}`); if (cond) pass++; else fail++; }

const dir = new URL('../src/', import.meta.url).pathname;
const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
const FORBIDDEN: [string, RegExp][] = [
  ['.insert(', /\.insert\s*\(/], ['.update(', /\.update\s*\(/], ['.delete(', /\.delete\s*\(/], ['.upsert(', /\.upsert\s*\(/],
  ['.rpc(', /\.rpc\s*\(/], ['storage', /\.storage\b/], ['functions.invoke', /\.functions\b/],
  ['outbox', /outbox/i], ['dexie/db', /from ['"][^'"]*\/(db|mutations|sync)['"]/], ['service_role key env', /SERVICE_ROLE_KEY|service_role_key|SUPABASE_SERVICE/],
  ['.put/.add/.bulk', /\.(bulkPut|bulkAdd|put|add)\s*\(/],
];
check('found source files', files.length >= 3);
for (const f of files) {
  const src = readFileSync(join(dir, f), 'utf8').replace(/\/\/.*$/gm, '');
  for (const [name, re] of FORBIDDEN) check(`${f}: no ${name}`, !re.test(src));
}
// Only SELECT-family builder methods on the Supabase client
const sb = readFileSync(join(dir, 'supabaseSource.ts'), 'utf8');
const chained = [...sb.matchAll(/\bq\s*=\s*q\.(\w+)|\.from\(table\)\.(\w+)|\bq\.(\w+)\(/g)].map((m) => m[1] ?? m[2] ?? m[3]);
check('supabase builder uses only select/is/gte/lte/order/range', chained.length > 0 && chained.every((m) => ['select', 'is', 'gte', 'lte', 'order', 'range'].includes(m)));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
