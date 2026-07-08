/**
 * @zakkster/lite-leakforge -- test/gate.test.js
 *
 * Tests for the CI gate harness.
 * GC-dependent tests skip gracefully without --expose-gc.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createLeakGate,
  assertNoLeaks,
  leakSuite,
  EXIT_CLEAN,
  EXIT_LEAK,
  EXIT_INCONCLUSIVE,
} from '../harness/Gate.js';

const HAS_GC = typeof globalThis.gc === 'function';

describe('exit codes', () => {
  it('EXIT_CLEAN is 0', () => assert.equal(EXIT_CLEAN, 0));
  it('EXIT_LEAK is 1', () => assert.equal(EXIT_LEAK, 1));
  it('EXIT_INCONCLUSIVE is 3', () => assert.equal(EXIT_INCONCLUSIVE, 3));
});

describe('createLeakGate', () => {
  it('reports clean when no leaks', { skip: !HAS_GC && 'requires --expose-gc' }, async () => {
    const gate = createLeakGate();
    const result = await gate.run(function (tracker) {
      const target = { x: 1 };
      const handle = tracker.track(target, function () {}, 'test');
      tracker.untrack(handle);
    });
    assert.equal(result.exitCode, EXIT_CLEAN);
    assert.equal(result.clean, true);
    assert.equal(result.leaks.length, 0);
  });

  it('reports leak via FR path', { skip: !HAS_GC && 'requires --expose-gc' }, async () => {
    const gate = createLeakGate();
    const result = await gate.run(function (tracker) {
      (function inject() {
        const target = { leaked: true };
        tracker.track(target, function () {}, 'leaked-target');
      })();
    });
    assert.equal(result.exitCode, EXIT_LEAK);
    assert.equal(result.clean, false);
    assert.ok(result.leaks.length >= 1);
  });

  it('installs timer/listener/async kernels by default', { skip: !HAS_GC && 'requires --expose-gc' }, async () => {
    const gate = createLeakGate();
    const result = await gate.run(function (_tracker) {});
    assert.equal(result.exitCode, EXIT_CLEAN);
  });

  it('allows disabling default kernels', { skip: !HAS_GC && 'requires --expose-gc' }, async () => {
    const gate = createLeakGate({
      installTimerKernel: false,
      installListenerKernel: false,
      installAsyncKernel: false,
    });
    const result = await gate.run(function (_tracker) {});
    assert.equal(result.exitCode, EXIT_CLEAN);
  });
});

describe('exit-code precedence', () => {
  it('finding + unsettled FR is EXIT_LEAK, not inconclusive', { skip: !HAS_GC && 'requires --expose-gc' }, async () => {
    // A confirmed audit finding must not be downgraded to "recapture"
    // by an unsettled FR. Force both: an orphan timer (audit finding)
    // and a tracked-but-strongly-held target (FR can never settle).
    const held = { pinned: true };
    let timerId;
    const gate = createLeakGate({ maxRounds: 1, pressureKB: 16 });
    const result = await gate.run(function (tracker) {
      timerId = setTimeout(function () {}, 999999); // audit finding
      tracker.track(held, function () {}, 'pinned'); // never settles
    });
    clearTimeout(timerId);
    assert.ok(result.findings.length >= 1, 'should have an audit finding');
    assert.equal(result.settleResult.settled, false);
    assert.equal(result.exitCode, EXIT_LEAK);
  });

  it('no evidence + unsettled FR is EXIT_INCONCLUSIVE', { skip: !HAS_GC && 'requires --expose-gc' }, async () => {
    const held = { pinned: true };
    const gate = createLeakGate({
      maxRounds: 1,
      pressureKB: 16,
      installTimerKernel: false,
      installListenerKernel: false,
      installAsyncKernel: false,
    });
    const result = await gate.run(function (tracker) {
      tracker.track(held, function () {}, 'pinned');
    });
    assert.equal(result.leaks.length, 0);
    assert.equal(result.findings.length, 0);
    assert.equal(result.exitCode, EXIT_INCONCLUSIVE);
  });
});

describe('kernel teardown safety', () => {
  it('restores patched globals when the user fn throws', { skip: !HAS_GC && 'requires --expose-gc' }, async () => {
    const origSetTimeout = globalThis.setTimeout;
    const origAbortController = globalThis.AbortController;
    const gate = createLeakGate();
    await assert.rejects(
      () => gate.run(function () { throw new Error('user code exploded'); }),
      { message: 'user code exploded' }
    );
    assert.equal(globalThis.setTimeout, origSetTimeout,
      'setTimeout patch must be removed after throw');
    assert.equal(globalThis.AbortController, origAbortController,
      'AbortController patch must be removed after throw');
  });
});

describe('assertNoLeaks', () => {
  it('resolves for clean code', { skip: !HAS_GC && 'requires --expose-gc' }, async () => {
    const result = await assertNoLeaks(function (tracker) {
      const target = { x: 1 };
      const h = tracker.track(target, function () {}, 'test');
      tracker.untrack(h);
    });
    assert.equal(result.exitCode, EXIT_CLEAN);
  });

  it('throws on confirmed leak', { skip: !HAS_GC && 'requires --expose-gc' }, async () => {
    await assert.rejects(
      () => assertNoLeaks(function (tracker) {
        (function () {
          const target = { leaked: true };
          tracker.track(target, function () {}, 'test');
        })();
      }),
      function (err) {
        assert.ok(err.message.includes('confirmed leak'));
        assert.ok(err.gateResult !== undefined);
        assert.equal(err.gateResult.exitCode, EXIT_LEAK);
        return true;
      }
    );
  });
});

describe('leakSuite integration', { skip: !HAS_GC && 'requires --expose-gc' }, () => {
  leakSuite(describe, it, 'clean-code', function (measure) {
    measure('track and untrack', function (tracker) {
      const target = { x: 1 };
      const h = tracker.track(target, function () {}, 'test');
      tracker.untrack(h);
    });

    measure('no-op function', function (_tracker) {});
  });
});
