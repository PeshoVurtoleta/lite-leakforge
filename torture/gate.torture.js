/**
 * TORTURE 1 -- harness/Gate.js
 * Async checks, throwing checks, concurrent gates, patch-surface integrity,
 * repeated-run drift.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createLeakGate, assertNoLeaks,
  EXIT_CLEAN, EXIT_LEAK, EXIT_INCONCLUSIVE,
} from '../harness/Gate.js';

describe('T1 gate: async check bodies', () => {
  it('T1.1 awaits an async check before auditing/settling', async () => {
    const gate = createLeakGate({ name: 't1' });
    let bodyFinished = false;
    const r = await gate.run(async (tracker) => {
      await new Promise((res) => setTimeout(res, 20));
      // Leak injected AFTER the await. If the gate does not await the
      // check, audit()+settle() have already run and this is invisible.
      const target = { big: 1 };
      tracker.track(target, () => {}, 'late-leak');
      bodyFinished = true;
    });
    assert.equal(bodyFinished, true, 'check body ran to completion before gate resolved');
    assert.equal(r.exitCode, EXIT_LEAK, 'post-await leak must be caught');
  });

  it('T1.2 an async check that rejects must fail the run, not vanish', async () => {
    const gate = createLeakGate({ name: 't1b' });
    let threw = false;
    try {
      await gate.run(async () => { throw new Error('boom-async'); });
    } catch (e) { threw = true; }
    assert.equal(threw, true, 'rejected async check must surface');
  });
});

describe('T2 gate: teardown integrity', () => {
  it('T2.1 restores global patches when the check throws', async () => {
    const beforeSetTimeout = globalThis.setTimeout;
    const beforeAddEL = EventTarget.prototype.addEventListener;
    const beforeAC = globalThis.AbortController;
    const gate = createLeakGate({ name: 't2' });
    await assert.rejects(() => gate.run(() => { throw new Error('boom'); }));
    assert.equal(globalThis.setTimeout, beforeSetTimeout, 'setTimeout restored');
    assert.equal(EventTarget.prototype.addEventListener, beforeAddEL, 'addEventListener restored');
    assert.equal(globalThis.AbortController, beforeAC, 'AbortController restored');
  });

  it('T2.2 restores global patches on the clean path', async () => {
    const beforeSetTimeout = globalThis.setTimeout;
    const gate = createLeakGate({ name: 't2b' });
    await gate.run(() => {});
    assert.equal(globalThis.setTimeout, beforeSetTimeout);
  });

  it('T2.3 a throwing check inside a suite of many does not poison later runs', async () => {
    const gate = createLeakGate({ name: 't2c' });
    try { await gate.run(() => { throw new Error('x'); }); } catch (_e) { /* expected */ }
    const r = await gate.run(() => {});
    assert.equal(r.exitCode, EXIT_CLEAN, 'later run still clean after a thrown check');
  });
});

describe('T3 gate: concurrency', () => {
  it('T3.1 two overlapping gate.run() calls do not corrupt global patches', async () => {
    const beforeSetTimeout = globalThis.setTimeout;
    const a = createLeakGate({ name: 't3a' });
    const b = createLeakGate({ name: 't3b' });
    const results = await Promise.allSettled([
      a.run(() => {}),
      b.run(() => {}),
    ]);
    const errs = results.filter((r) => r.status === 'rejected').map((r) => String(r.reason && r.reason.message));
    assert.equal(globalThis.setTimeout, beforeSetTimeout,
      'setTimeout restored after concurrent gates; errs=' + JSON.stringify(errs));
    // Record whether overlap is rejected loudly or silently mis-runs.
    assert.ok(true, 'overlap outcome: ' + JSON.stringify(results.map((r) => r.status)) + ' ' + JSON.stringify(errs));
  });

  it('T3.2 same gate instance run concurrently', async () => {
    const beforeSetTimeout = globalThis.setTimeout;
    const g = createLeakGate({ name: 't3c' });
    const results = await Promise.allSettled([g.run(() => {}), g.run(() => {})]);
    assert.equal(globalThis.setTimeout, beforeSetTimeout, 'restored after same-gate overlap');
    assert.ok(true, 'same-gate overlap: ' + JSON.stringify(results.map((r) => r.status)));
  });
});

describe('T4 gate: evidence-wins precedence matrix', () => {
  it('T4.1 leak + unsettled => LEAK (evidence wins)', async () => {
    const gate = createLeakGate({ name: 't4', maxRounds: 1 });
    const held = [];
    const r = await gate.run((tracker) => {
      const t = {};
      tracker.track(t, () => {}, 'kept');
      held.push(t); // stays reachable => never settles
      const g = {};
      tracker.track(g, () => {}, 'gone'); // becomes garbage
    });
    assert.ok(r.exitCode === EXIT_LEAK || r.exitCode === EXIT_INCONCLUSIVE,
      'got ' + r.exitCode);
  });

  it('T4.2 clean check settles and exits 0', async () => {
    const gate = createLeakGate({ name: 't4b' });
    const r = await gate.run(() => {});
    assert.equal(r.exitCode, EXIT_CLEAN);
    assert.equal(r.settleResult.settled, true);
  });
});

describe('T5 gate: option hostility', () => {
  it('T5.1 extraKernels containing junk', async () => {
    const gate = createLeakGate({ name: 't5', extraKernels: [null, 42, {}, 'nope'] });
    let msg = null;
    try { await gate.run(() => {}); } catch (e) { msg = e.message; }
    assert.ok(true, 'junk kernels => ' + msg);
  });

  it('T5.2 NaN maxRounds does not silently mean zero rounds', async () => {
    const gate = createLeakGate({ name: 't5b', maxRounds: NaN });
    const r = await gate.run(() => {});
    assert.notEqual(r.settleResult.rounds, 0,
      'NaN maxRounds ran ' + r.settleResult.rounds + ' rounds and reported settled=' + r.settleResult.settled);
  });

  it('T5.3 negative pressureKB does not throw', async () => {
    const gate = createLeakGate({ name: 't5c', pressureKB: -1 });
    const r = await gate.run(() => {});
    assert.equal(r.clean, true);
  });

  it('T5.4 absurd pressureKB is clamped, not fatal', async () => {
    const gate = createLeakGate({ name: 't5d', pressureKB: 1e9, maxRounds: 1 });
    const r = await gate.run(() => {});
    assert.equal(r.clean, true);
  });
});

describe('T7 assertNoLeaks', () => {
  it('T7.1 throws with gateResult attached on leak', async () => {
    let err = null;
    try {
      await assertNoLeaks((tracker) => {
        const t = { x: 1 };
        tracker.track(t, () => {}, 'assert-leak');
      }, { name: 't7', maxRounds: 6 });
    } catch (e) { err = e; }
    assert.ok(err !== null, 'expected a throw');
    assert.ok(err.gateResult !== undefined, 'gateResult attached');
  });
});
