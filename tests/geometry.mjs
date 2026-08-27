import assert from 'node:assert/strict';
import { computeScrollPositions, isProtectedUrl, sanitizeFilename } from '../src/utils.js';

assert.deepEqual(computeScrollPositions(800, 800), [0]);
assert.deepEqual(computeScrollPositions(1800, 800), [0, 800, 1000]);
assert.deepEqual(computeScrollPositions(2400, 800), [0, 800, 1600]);
assert.equal(isProtectedUrl('chrome://settings'), true);
assert.equal(isProtectedUrl('https://example.com'), false);
assert.equal(sanitizeFilename('a/b:c*?'), 'a_b_c__');
console.log('geometry tests: ok');
