/**
 * @zakkster/lite-leakforge -- test/version.test.js
 *
 * VERSION constant must match package.json.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VERSION } from '../Leakforge.js';
import { readFileSync } from 'node:fs';

describe('VERSION', () => {
  it('matches package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    assert.equal(VERSION, pkg.version);
    assert.equal(VERSION, '1.5.0');
  });
});
