// Static guards for V 34 push setup: edge _shared copies in sync, VAPID key
// shape, migration additive-only, no secrets committed.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createECDH } from 'node:crypto';
import { generateVapidKeys } from './generate-vapid-keys.mjs';

let pass = 0, fail = 0;
function check(label: string, cond: boolean) {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${label}`);
  if (cond) pass++; else fail++;
}

// edge shared modules are byte-identical (modulo import rewrite) to src/lib
let syncOk = true;
try { execFileSync('node', ['scripts/sync-edge-shared.mjs', '--check'], { stdio: 'pipe' }); } catch { syncOk = false; }
check('supabase/functions/_shared matches src/lib (run node scripts/sync-edge-shared.mjs)', syncOk);
const fn = readFileSync('supabase/functions/push-reminders/index.ts', 'utf8');
const mig = readFileSync('supabase/schema-v10-push-and-recurring.sql', 'utf8');
check('edge function checks x-cron-secret against CRON_SECRET', /x-cron-secret/.test(fn) && /Deno\.env\.get\('CRON_SECRET'\)/.test(fn));
check('edge function claims dedupe_key before sending', fn.indexOf("onConflict: 'dedupe_key'") > 0 && fn.indexOf("onConflict: 'dedupe_key'") < fn.indexOf('sendNotification('));
check('edge function targets OWNERS only (no tenant pushes)', /\.eq\('role', 'owner'\)/.test(fn) && !/role === 'tenant'|tenantUsers|tenant_id: d\./.test(fn) && (fn.match(/sendLogged\(sb,/g) ?? []).length === 2);
const tenantHome = readFileSync('src/pages/TenantHome.tsx', 'utf8');
check('tenant portal has no push subscribe card', !/PushSettings/.test(tenantHome));
check('push_subscriptions stays generic (no role column)', !/role/.test(mig.slice(mig.indexOf('create table if not exists push_subscriptions'), mig.indexOf('alter table push_subscriptions'))));
check('edge function reads VAPID private key from env only', /Deno\.env\.get\('VAPID_PRIVATE_KEY'\)/.test(fn));

// VAPID keys
const k = generateVapidKeys();
const pubRaw = Buffer.from(k.publicKey, 'base64url');
const privRaw = Buffer.from(k.privateKey, 'base64url');
check('VAPID public key is 65-byte uncompressed P-256 point', pubRaw.length === 65 && pubRaw[0] === 4);
check('VAPID private key is 32 bytes', privRaw.length === 32);
const ecdh = createECDH('prime256v1'); ecdh.setPrivateKey(privRaw);
check('VAPID public key matches private key', ecdh.getPublicKey().equals(pubRaw));
check('two runs give different keys', generateVapidKeys().privateKey !== k.privateKey);

// migration is additive
const code = mig.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').toLowerCase();
check('v10 has no drop/truncate/delete/update/alter column type', !/\b(drop\s+(table|column|policy|constraint)|truncate|delete\s+from|update\s+\w+\s+set|alter\s+column)\b/.test(code));
check('v10 creates tables with if not exists', (code.match(/create table if not exists/g) ?? []).length === 3 && !/create table (?!if not exists)/.test(code));
check('v10 enables RLS on all new tables', ['push_subscriptions', 'push_send_log', 'recurring_expenses'].every((t) => code.includes(`alter table ${t} enable row level security`)));
check('push_subscriptions RLS = own rows only', /using \(user_id = auth\.uid\(\)\)\s*with check \(user_id = auth\.uid\(\)\)/.test(code));
check('v10 adds expenses.recurring_expense_id additively', code.includes('alter table expenses add column if not exists recurring_expense_id uuid'));
check('v10 does not schedule cron (needs the real secret)', !code.includes('cron.schedule'));
const cron = readFileSync('supabase/cron-push-reminders.sql', 'utf8');
check('cron template uses <CRON_SECRET> placeholder', cron.includes("'<CRON_SECRET>'"));

// no secrets committed
const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter((f) => f && !f.startsWith('public/ocr') && /\.(ts|tsx|js|mjs|sql|md|json|yml|example)$/.test(f) && existsSync(f));
const leaks = files.filter((f) => {
  const s = readFileSync(f, 'utf8');
  return /VAPID_PRIVATE_KEY\s*=\s*[A-Za-z0-9_-]{30,}/.test(s) || /service_role[^\n]{0,20}eyJ[A-Za-z0-9_-]{20,}/.test(s) || /x-cron-secret',\s*'(?!<CRON_SECRET>)[A-Za-z0-9_-]{20,}'/.test(s);
});
check(`no VAPID private key / service-role JWT / cron secret in tracked files (${files.length} scanned)`, leaks.length === 0);
if (leaks.length) console.log('  leaks in:', leaks.join(', '));
check('functions dir has only push-reminders + _shared', readdirSync('supabase/functions').sort().join() === '_shared,push-reminders');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
