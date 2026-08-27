import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const runtimeFiles = [
  'manifest.json',
  'src/service-worker.js',
  'src/page-functions.js',
  'src/popup.html',
  'src/popup.js',
  'src/editor.html',
  'src/editor.js',
];
const banned = [
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bWebSocket\b/,
  /\bEventSource\b/,
  /\bsendBeacon\b/,
  /https?:\/\//i,
  /wss?:\/\//i,
];

const violations = [];
for (const relative of runtimeFiles) {
  const file = path.join(root, relative);
  const text = fs.readFileSync(file, 'utf8');
  for (const pattern of banned) {
    if (pattern.test(text)) violations.push(`${relative}: ${pattern}`);
  }
}

if (violations.length) {
  console.error('Network audit failed:\n' + violations.join('\n'));
  process.exit(1);
}
console.log('network audit: ok (no network primitives / remote URLs in runtime files)');
