/**
 * TORTURE 5 -- soak. Isolated in its own file on purpose: GC pressure from one
 * case can fire an FinalizationRegistry callback armed by another, so soak
 * measurements only mean anything in a process that is doing nothing else.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLeakGate, EXIT_CLEAN } from '../harness/Gate.js';

describe('T6 gate: repeated-run drift (the leak detector must not leak)', () => {
  it('T6.1 300 sequential runs keep RSS bounded and stay clean', async () => {
    const gate = createLeakGate({ name: 't6', maxRounds: 2, pressureKB: 16, captureStacks: false });
    await gate.run(() => {});
    globalThis.gc();
    const start = process.memoryUsage().heapUsed;
    for (let i = 0; i < 300; i++) {
      const r = await gate.run(() => {});
      if (r.exitCode !== EXIT_CLEAN) throw new Error('run ' + i + ' -> ' + r.exitCode);
    }
    globalThis.gc();
    const end = process.memoryUsage().heapUsed;
    const growthMB = (end - start) / 1048576;
    assert.ok(growthMB < 8, 'heap growth over 300 gate runs: ' + growthMB.toFixed(2) + ' MB');
  });
});

