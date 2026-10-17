#!/usr/bin/env node
// Generates a VAPID key pair for Web Push (P-256 / prime256v1), using only
// Node's built-in crypto. Prints to stdout ONLY — never writes a file, so
// nothing lands in the repo. Do not commit or paste the private key.
//
//   node scripts/generate-vapid-keys.mjs
//
// Then (release steps):
//   - VAPID public key  → GitHub repo secret VITE_VAPID_PUBLIC_KEY (client build)
//                         and Supabase secret VAPID_PUBLIC_KEY
//   - VAPID private key → Supabase secret VAPID_PRIVATE_KEY (never in the client)
import { generateKeyPairSync } from 'node:crypto';

export function generateVapidKeys() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pub = publicKey.export({ format: 'jwk' });
  const priv = privateKey.export({ format: 'jwk' });
  const b = (s) => Buffer.from(s, 'base64url');
  // Uncompressed point 0x04 || X || Y (65 bytes) = applicationServerKey.
  const raw = Buffer.concat([Buffer.from([4]), b(pub.x), b(pub.y)]);
  return { publicKey: raw.toString('base64url'), privateKey: b(priv.d).toString('base64url') };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const k = generateVapidKeys();
  console.log('VAPID_PUBLIC_KEY=' + k.publicKey);
  console.log('VAPID_PRIVATE_KEY=' + k.privateKey);
  console.error('\nPrivate key: put it ONLY in Supabase secrets. Do not commit it.');
}
