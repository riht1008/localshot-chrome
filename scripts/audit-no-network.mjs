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
  'src/desktop-capture.html',
  'src/desktop-capture.js',
  'src/editor.html',
  'src/editor.js',
  'src/editor-base.js',
  'src/editor-extensions.js',
  'src/pptx-export.js',
  'src/pptx-export-safe.js',
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
const xmlNamespaceUrls = [
  /http:\/\/schemas\.openxmlformats\.org\/[A-Za-z0-9_./-]*/g,
  /http:\/\/purl\.org\/dc\/[A-Za-z0-9_./-]*/g,
  /http:\/\/www\.w3\.org\/2001\/XMLSchema-instance/g,
];

const violations = [];
for (const relative of runtimeFiles) {
  const file = path.join(root, relative);
  let text = fs.readFileSync(file, 'utf8');
  for (const allowed of xmlNamespaceUrls) text = text.replace(allowed, '');
  for (const pattern of banned) {
    if (pattern.test(text)) violations.push(`${relative}: ${pattern}`);
  }
}

if (violations.length) {
  console.error('Network audit failed:\n' + violations.join('\n'));
  process.exit(1);
}
console.log('network audit: ok (no network primitives / remote URLs in runtime files)');
