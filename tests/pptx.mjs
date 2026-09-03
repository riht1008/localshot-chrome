import assert from 'node:assert/strict';
import { exportEditablePptx } from '../src/pptx-export-safe.js';

const backgroundDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZxN8AAAAASUVORK5CYII=';
const blob = await exportEditablePptx({
  backgroundDataUrl,
  width: 800,
  height: 450,
  title: 'LocalShot test',
  annotations: [
    { type: 'rect', x: 40, y: 40, w: 180, h: 90, color: '#ef4444', strokeWidth: 6, fill: false },
    { type: 'arrow', x1: 80, y1: 220, x2: 300, y2: 180, color: '#2563eb', strokeWidth: 6, arrowStyle: 'open' },
    { type: 'text', x: 80, y: 360, text: 'editable', color: '#111827', fontSize: 32, background: true },
  ],
});

assert.equal(blob.type, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
const bytes = new Uint8Array(await blob.arrayBuffer());
assert.equal(bytes[0], 0x50);
assert.equal(bytes[1], 0x4b);

const raw = Buffer.from(bytes).toString('latin1');
assert.match(raw, /ppt\/slides\/slide1\.xml/);
assert.match(raw, /ppt\/media\/image1\.png/);
assert.match(raw, /name="rect 3"/);
assert.match(raw, /name="Arrow 4"/);
assert.match(raw, /name="Text 5"/);
assert.match(raw, /<p:sldLayoutId id="2147483649" r:id="rId1"\/>/);
assert.doesNotMatch(raw, /<p:sldLayoutId id="1"/);

console.log('pptx export: ok');
