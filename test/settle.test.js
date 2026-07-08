/**
 * @zakkster/lite-leakforge -- test/settle.test.js
 *
 * Tests for the settleFinalizers() harness.
 * GC-dependent tests skip gracefully without --expose-gc.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { settleFinalizers, settleTracker } from '../harness/Settle.js';
import { createLeakTracker } from '@zakkster/lite-leak';

const HAS_GC = typeof globalThis.gc === 'function';

describe('settleFinalizers', () => {
  it('throws without --expose-gc', async () => {
    const orig = globalThis.gc;
    globalThis.gc = undefined;
    try {
      await assert.rejects(
        () => settleFinalizers({ check: () => 0 }),
        { message: /--expose-gc/ }
      );
    } finally {
      globalThis.gc = orig;
    }
  });

  it('throws if check is not a function', { skip: !HAS_GC && 'requires --expose-gc' }, async () => {
    await assert.rejects(
      () => settleFinalizers({ check: 42 }),
      { name: 'TypeError' }
    );
  });

  it('settles immediately when check returns 0', { skip: !HAS_GC && 'requires --expose-gc' }, async () => {
    const result = await settleFinalizers({
      check: () => 0,
      maxRounds: 5,
    });
    assert.equal(result.settled, true);
    assert.equal(result.rounds, 1);
    assert.equal(result.remaining, 0);
  });

  it('settles when check reaches target', { skip: !HAS_GC && 'requires --expose-gc' }, async () => {
    let count = 3;
    const result = await settleFinalizers({
      check: () => --count,
      target: 0,
      maxRounds: 10,
    });
    assert.equal(result.settled, true);
    assert.ok(result.rounds >= 1);
    assert.equal(result.remaining, 0);
  });

  it('reports not settled when maxRounds exhausted', { skip: !HAS_GC && 'requires --expose-gc' }, async () => {
    const result = await settleFinalizers({
      check: () => 999,
      maxRounds: 2,
    });
    assert.equal(result.settled, false);
    assert.equal(result.rounds, 2);
    assert.equal(result.remaining, 999);
  });

  it('settles a real FinalizationRegistry', { skip: !HAS_GC && 'requires --expose-gc' }, async () => {
    let fired = 0;
    const fr = new FinalizationRegistry(() => { fired++; });
    (function register() {
      for (let i = 0; i < 10; i++) {
        fr.register({ idx: i }, i);
      }
    })();
    const result = await settleFinalizers({
      check: () => 10 - fired,
      maxRounds: 10,
    });
    assert.equal(result.settled, true, 'all 10 should have fired');
    assert.equal(fired, 10);
  });
});

describe('settleTracker', () => {
  it('settles a tracker to size 0', { skip: !HAS_GC && 'requires --expose-gc' }, async () => {
    const tracker = createLeakTracker({ name: 'settle-test' });
    (function inject() {
      const target = { x: 1 };
      tracker.track(target, () => {}, 'settle-test');
    })();
    assert.equal(tracker.size(), 1);
    const result = await settleTracker(tracker);
    assert.equal(result.settled, true);
    assert.equal(tracker.size(), 0);
  });
});
