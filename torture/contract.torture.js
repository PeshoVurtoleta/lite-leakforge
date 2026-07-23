/**
 * TORTURE 2 -- scenarios/Contract.js + harness/Settle.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { verify, composeScenario } from '../scenarios/Contract.js';
import { settleFinalizers, settleTracker } from '../harness/Settle.js';
import { createRafOrphanSpecimen, createRawFrSpecimen, createTimerOrphanSpecimen } from '../scenarios/Scenarios.js';

function minimalSpecimen(over) {
  return Object.assign({
    name: 'min',
    kernels: () => [],
    expectedLeaks: [], expectedWarnings: [], expectedFindings: [],
    needsSettle: false,
    inject: () => {},
    release: () => {},
  }, over || {});
}

describe('C1 verify: specimen reuse / idempotence', () => {
  it('C1.1 the same specimen instance verified twice gives the same verdict', async () => {
    const spec = createRafOrphanSpecimen();
    const a = await verify(spec);
    const b = await verify(spec);
    assert.equal(a.pass, true, 'first run passes');
    assert.equal(b.pass, true,
      'second run on the same instance: warnings=' + b.warnings.actual.length +
      ' findings=' + b.findings.actual.length +
      ' unexpectedW=' + b.warnings.unexpected.length +
      ' unexpectedF=' + b.findings.unexpected.length);
  });

  it('C1.2 raw-fr specimen reused twice', async () => {
    const spec = createRawFrSpecimen();
    const a = await verify(spec);
    const b = await verify(spec);
    assert.equal(a.pass, true);
    assert.equal(b.pass, true, 'second raw-fr run: leaks=' + b.leaks.actual.length);
  });
});

describe('C2 verify: hostile tags in the diff engine', () => {
  it('C2.1 cyclic tag does not blow the stack', async () => {
    const cyclic = { name: 'c' }; cyclic.self = cyclic;
    const spec = minimalSpecimen({
      name: 'cyclic',
      expectedFindings: [{ kind: 'k', tag: cyclic }],
      kernels: () => [{
        name: 'cyc-kernel', patchSurfaces: [], priority: 0,
        audit: (ctx) => { ctx.report({ kind: 'k', reason: 'r', tag: cyclic }); },
      }],
    });
    await verify(spec); // must not throw RangeError
  });

  it('C2.2 array tag must not match an object with the same keys', () => {
    // Exercised through the exported diff behaviour via verify.
    const spec = minimalSpecimen({
      name: 'arr-vs-obj',
      expectedFindings: [{ kind: 'k', tag: { 0: 'a', 1: 'b' } }],
      kernels: () => [{
        name: 'arr-kernel', patchSurfaces: [], priority: 0,
        audit: (ctx) => { ctx.report({ kind: 'k', reason: 'r', tag: ['a', 'b'] }); },
      }],
    });
    return verify(spec).then((r) => {
      assert.equal(r.pass, false,
        'an array actual must not satisfy an object expectation (structural type confusion)');
    });
  });
});

describe('C3 verify: malformed specimens', () => {
  it('C3.1 missing inject throws a useful error, not a bare TypeError', async () => {
    const spec = minimalSpecimen({ name: 'no-inject' });
    delete spec.inject;
    await assert.rejects(() => verify(spec), (e) => {
      assert.ok(/inject/.test(e.message), 'message names the missing hook, got: ' + e.message);
      return true;
    });
  });

  it('C3.2 missing release throws a useful error', async () => {
    const spec = minimalSpecimen({ name: 'no-release' });
    delete spec.release;
    await assert.rejects(() => verify(spec), (e) => {
      assert.ok(/release/.test(e.message), 'message names the missing hook, got: ' + e.message);
      return true;
    });
  });

  it('C3.3 null specimen', async () => {
    await assert.rejects(() => verify(null), (e) => {
      assert.ok(!/Cannot read properties of null/.test(e.message),
        'raw property-access TypeError leaked to the user: ' + e.message);
      return true;
    });
  });

  it('C3.4 inject that throws still tears down kernels', async () => {
    const before = globalThis.setTimeout;
    const spec = minimalSpecimen({
      name: 'throwing-inject',
      kernels: () => [],
      inject: () => { throw new Error('inject-boom'); },
    });
    await assert.rejects(() => verify(spec));
    assert.equal(globalThis.setTimeout, before);
  });

  it('C3.5 kernels() that throws', async () => {
    const spec = minimalSpecimen({ name: 'k-boom', kernels: () => { throw new Error('kboom'); } });
    await assert.rejects(() => verify(spec), /kboom/);
  });
});

describe('C4 composeScenario', () => {
  it('C4.1 a throwing specimen does not abort the whole scenario', async () => {
    const good = minimalSpecimen({ name: 'good' });
    const bad = minimalSpecimen({ name: 'bad', inject: () => { throw new Error('nope'); } });
    const good2 = minimalSpecimen({ name: 'good2' });
    const r = await composeScenario([good, bad, good2]);
    assert.equal(r.results.length, 3, 'all three specimens reported; got ' + r.results.length);
  });
});

describe('S1 settleFinalizers: hostile options', () => {
  it('S1.1 NaN maxRounds must not silently mean zero rounds', async () => {
    const r = await settleFinalizers({ check: () => 5, maxRounds: NaN });
    assert.notEqual(r.rounds, 0, 'NaN maxRounds ran ' + r.rounds + ' rounds');
  });

  it('S1.2 negative pressureKB must not throw', async () => {
    const r = await settleFinalizers({ check: () => 0, pressureKB: -1, maxRounds: 1 });
    assert.equal(r.settled, true);
  });

  it('S1.3 fractional pressureKB', async () => {
    const r = await settleFinalizers({ check: () => 0, pressureKB: 3.7, maxRounds: 1 });
    assert.equal(r.settled, true);
  });

  it('S1.4 absurd pressureKB is clamped rather than OOM/RangeError', async () => {
    const r = await settleFinalizers({ check: () => 0, pressureKB: 2 ** 31, maxRounds: 1 });
    assert.equal(r.settled, true);
  });

  it('S1.5 negative maxRounds returns rounds=0 without calling check twice oddly', async () => {
    let calls = 0;
    const r = await settleFinalizers({ check: () => { calls++; return 9; }, maxRounds: -5 });
    assert.equal(r.settled, false);
    assert.equal(r.rounds, 0);
  });

  it('S1.6 check() throwing propagates cleanly', async () => {
    await assert.rejects(() => settleFinalizers({ check: () => { throw new Error('chk'); } }), /chk/);
  });

  it('S1.7 check() returning a non-number is rejected, not silently compared', async () => {
    await assert.rejects(
      () => settleFinalizers({ check: () => 'zero', maxRounds: 1 }),
      /must return a number/);
  });

  it('S1.8 check() returning NaN is rejected', async () => {
    await assert.rejects(
      () => settleFinalizers({ check: () => NaN, maxRounds: 2 }),
      /must return a number/);
  });

  it('S1.9 settleTracker forwards options', async () => {
    const fake = { size: () => 0 };
    const r = await settleTracker(fake, { maxRounds: 1, pressureKB: 8 });
    assert.equal(r.settled, true);
    assert.equal(r.rounds, 1);
  });

  it('S1.10 default pressure cost per round is not pathological', async () => {
    globalThis.gc();
    const before = process.memoryUsage().heapUsed;
    await settleFinalizers({ check: () => 0, maxRounds: 1 });
    globalThis.gc();
    const after = process.memoryUsage().heapUsed;
    assert.ok((after - before) / 1048576 < 4,
      'residual after one default settle round: ' + ((after - before) / 1048576).toFixed(2) + ' MB');
  });
});

describe('S2 settle: many rounds soak', () => {
  it('S2.1 200 settle cycles do not accumulate heap', async () => {
    await settleFinalizers({ check: () => 0, maxRounds: 1, pressureKB: 8 });
    globalThis.gc();
    const start = process.memoryUsage().heapUsed;
    for (let i = 0; i < 200; i++) {
      await settleFinalizers({ check: () => 0, maxRounds: 1, pressureKB: 8 });
    }
    globalThis.gc();
    const growthMB = (process.memoryUsage().heapUsed - start) / 1048576;
    assert.ok(growthMB < 5, 'growth over 200 settles: ' + growthMB.toFixed(2) + ' MB');
  });
});

describe('S3 specimen soak', () => {
  it('S3.1 400 fresh raf-orphan verifies stay green and bounded', async () => {
    await verify(createRafOrphanSpecimen());
    globalThis.gc();
    const start = process.memoryUsage().heapUsed;
    for (let i = 0; i < 400; i++) {
      const r = await verify(createRafOrphanSpecimen());
      if (!r.pass) throw new Error('raf-orphan regressed at iteration ' + i);
    }
    globalThis.gc();
    const growthMB = (process.memoryUsage().heapUsed - start) / 1048576;
    assert.ok(growthMB < 8, 'growth over 400 verifies: ' + growthMB.toFixed(2) + ' MB');
  });

  it('S3.2 timer-orphan specimen 100x', async () => {
    for (let i = 0; i < 100; i++) {
      const r = await verify(createTimerOrphanSpecimen());
      if (!r.pass) throw new Error('timer-orphan regressed at iteration ' + i);
    }
  });
});
