/**
 * @zakkster/lite-leakforge -- test/specimens.test.js
 *
 * Tests for the specimen verify() contract and all F0 specimens.
 * GC-dependent tests (raw-fr) skip gracefully without --expose-gc.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  verify,
  composeScenario,
  createRawFrSpecimen,
  createTimerOrphanSpecimen,
  createListenerOrphanSpecimen,
  createObserverOrphanSpecimen,
  createDetachedDomSpecimen,
  createAsyncRetentionSpecimen,
  createRafOrphanSpecimen,
} from '../scenarios/Scenarios.js';

const HAS_GC = typeof globalThis.gc === 'function';

// -----------------------------------------------------------------
// Contract unit tests
// -----------------------------------------------------------------

describe('verify contract', () => {
  it('passes a trivial specimen with no expected events', async () => {
    const specimen = {
      name: 'trivial',
      kernels: () => [],
      expectedLeaks: [],
      expectedWarnings: [],
      expectedFindings: [],
      needsSettle: false,
      inject(_tracker) {},
      release() {},
    };
    const result = await verify(specimen);
    assert.equal(result.pass, true);
    assert.equal(result.specimen, 'trivial');
    assert.equal(result.leaks.pass, true);
    assert.equal(result.warnings.pass, true);
    assert.equal(result.findings.pass, true);
  });

  it('fails when expected leak is missing', async () => {
    const specimen = {
      name: 'missing-leak',
      kernels: () => [],
      expectedLeaks: [{ kind: 'unknown' }],
      expectedWarnings: [],
      expectedFindings: [],
      needsSettle: false,
      inject(_tracker) {},
      release() {},
    };
    const result = await verify(specimen);
    assert.equal(result.pass, false);
    assert.equal(result.leaks.pass, false);
    assert.equal(result.leaks.missing.length, 1);
    assert.equal(result.leaks.missing[0].kind, 'unknown');
  });
});

describe('verify environment contract', () => {
  it('throws for a needsSettle specimen without --expose-gc', async () => {
    // Silently skipping settle would report the expected leak as
    // "missing" -- a bogus detection FAIL masking an environment error.
    const orig = globalThis.gc;
    globalThis.gc = undefined;
    try {
      await assert.rejects(
        () => verify(createRawFrSpecimen()),
        { message: /--expose-gc/ }
      );
    } finally {
      globalThis.gc = orig;
    }
  });

  it('tears down kernels when inject throws', async () => {
    const origSetTimeout = globalThis.setTimeout;
    const { createTimerOrphanKernel } = await import('@zakkster/lite-leak');
    const specimen = {
      name: 'exploding',
      kernels: () => [createTimerOrphanKernel({ warnOnNoOwner: true })],
      needsSettle: false,
      inject() { throw new Error('inject exploded'); },
      release() {},
    };
    await assert.rejects(() => verify(specimen), { message: 'inject exploded' });
    assert.equal(globalThis.setTimeout, origSetTimeout,
      'setTimeout patch must be removed after inject throw');
  });
});

// -----------------------------------------------------------------
// Specimen: raw-fr
// -----------------------------------------------------------------

describe('raw-fr specimen', () => {
  it('produces kind=unknown leak via FR path', { skip: !HAS_GC && 'requires --expose-gc' }, async () => {
    const specimen = createRawFrSpecimen();
    const result = await verify(specimen);
    assert.equal(result.pass, true, formatFailure(result));
    assert.equal(result.leaks.actual.length, 1);
    assert.equal(result.leaks.actual[0].kind, 'unknown');
    assert.ok(result.settleResult !== null, 'should have settled');
    assert.equal(result.settleResult.settled, true);
  });
});

// -----------------------------------------------------------------
// Specimen: timer-orphan
// -----------------------------------------------------------------

describe('timer-orphan specimen', () => {
  it('fires warning at set-time and finding at audit-time', async () => {
    const specimen = createTimerOrphanSpecimen();
    const result = await verify(specimen);
    assert.equal(result.pass, true, formatFailure(result));
    // Warning channel
    assert.equal(result.warnings.actual.length, 1);
    assert.equal(result.warnings.actual[0].kind, 'timer-orphan');
    assert.equal(result.warnings.actual[0].reason, 'no-owner-set');
    // Finding channel
    assert.equal(result.findings.actual.length, 1);
    assert.equal(result.findings.actual[0].kind, 'timer-orphan');
    assert.equal(result.findings.actual[0].reason, 'no-owner-pending');
  });
});

// -----------------------------------------------------------------
// Specimen: listener-orphan
// -----------------------------------------------------------------

describe('listener-orphan specimen', () => {
  it('fires warning at addEventListener-time', async () => {
    const specimen = createListenerOrphanSpecimen();
    const result = await verify(specimen);
    assert.equal(result.pass, true, formatFailure(result));
    assert.equal(result.warnings.actual.length, 1);
    assert.equal(result.warnings.actual[0].kind, 'listener-orphan');
    assert.equal(result.warnings.actual[0].reason, 'no-owner-set');
  });
});

// -----------------------------------------------------------------
// Specimen: observer-orphan
// -----------------------------------------------------------------

describe('observer-orphan specimen', () => {
  it('fires warning + finding for MutationObserver without owner', async () => {
    const specimen = createObserverOrphanSpecimen();
    const result = await verify(specimen);
    assert.equal(result.pass, true, formatFailure(result));
    // Warning channel
    assert.equal(result.warnings.actual.length, 1);
    assert.equal(result.warnings.actual[0].kind, 'observer-orphan');
    assert.equal(result.warnings.actual[0].reason, 'no-owner-set');
    // Finding channel
    assert.equal(result.findings.actual.length, 1);
    assert.equal(result.findings.actual[0].kind, 'observer-orphan');
    assert.equal(result.findings.actual[0].reason, 'no-owner-pending');
  });
});

// -----------------------------------------------------------------
// Specimen: detached-dom
// -----------------------------------------------------------------

describe('detached-dom specimen', () => {
  it('produces finding at audit-time for detached node', async () => {
    const specimen = createDetachedDomSpecimen();
    const result = await verify(specimen);
    assert.equal(result.pass, true, formatFailure(result));
    assert.equal(result.findings.actual.length, 1);
    assert.equal(result.findings.actual[0].kind, 'detached-dom');
    assert.equal(result.findings.actual[0].reason, 'detached-at-audit');
  });
});

// -----------------------------------------------------------------
// Specimen: async-retention
// -----------------------------------------------------------------

describe('async-retention specimen', () => {
  it('fires warning + finding for AbortController without owner', async () => {
    const specimen = createAsyncRetentionSpecimen();
    const result = await verify(specimen);
    assert.equal(result.pass, true, formatFailure(result));
    // Warning channel
    assert.equal(result.warnings.actual.length, 1);
    assert.equal(result.warnings.actual[0].kind, 'async-retention');
    assert.equal(result.warnings.actual[0].reason, 'no-owner-set');
    // Finding channel
    assert.equal(result.findings.actual.length, 1);
    assert.equal(result.findings.actual[0].kind, 'async-retention');
    assert.equal(result.findings.actual[0].reason, 'no-owner-pending');
  });
});

// -----------------------------------------------------------------
// Specimen: raf-orphan
// -----------------------------------------------------------------

describe('raf-orphan specimen', () => {
  it('fires warning + finding for an ownerless rAF loop', async () => {
    const specimen = createRafOrphanSpecimen();
    const result = await verify(specimen);
    assert.equal(result.pass, true, formatFailure(result));
    // Warning channel: one no-owner-set at schedule time (not per frame).
    assert.equal(result.warnings.actual.length, 1);
    assert.equal(result.warnings.actual[0].kind, 'raf-orphan');
    assert.equal(result.warnings.actual[0].reason, 'no-owner-set');
    // Finding channel: the armed, ownerless loop surfaced at audit time.
    assert.equal(result.findings.actual.length, 1);
    assert.equal(result.findings.actual[0].kind, 'raf-orphan');
    assert.equal(result.findings.actual[0].reason, 'no-owner-loop-armed');
    // No FR settlement for this pre-FR specimen.
    assert.equal(result.leaks.actual.length, 0);
    assert.equal(result.settleResult, null);
  });
});


// -----------------------------------------------------------------
// composeScenario
// -----------------------------------------------------------------

describe('composeScenario', () => {
  it('runs non-GC specimens', async () => {
    const result = await composeScenario([
      createTimerOrphanSpecimen(),
      createListenerOrphanSpecimen(),
      createObserverOrphanSpecimen(),
      createDetachedDomSpecimen(),
      createAsyncRetentionSpecimen(),
      createRafOrphanSpecimen(),
    ]);
    assert.equal(result.pass, true, formatCompose(result));
    assert.equal(result.passed, 6);
    assert.equal(result.failed, 0);
  });

  it('runs all 7 specimens including raw-fr', { skip: !HAS_GC && 'requires --expose-gc' }, async () => {
    const result = await composeScenario([
      createRawFrSpecimen(),
      createTimerOrphanSpecimen(),
      createListenerOrphanSpecimen(),
      createObserverOrphanSpecimen(),
      createDetachedDomSpecimen(),
      createAsyncRetentionSpecimen(),
      createRafOrphanSpecimen(),
    ]);
    assert.equal(result.pass, true, formatCompose(result));
    assert.equal(result.passed, 7);
    assert.equal(result.failed, 0);
  });
});

// -----------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------

function formatFailure(result) {
  const parts = [];
  if (!result.leaks.pass) {
    parts.push('leaks: missing=' + JSON.stringify(result.leaks.missing) +
      ' unexpected=' + JSON.stringify(result.leaks.unexpected));
  }
  if (!result.warnings.pass) {
    parts.push('warnings: missing=' + JSON.stringify(result.warnings.missing) +
      ' unexpected=' + JSON.stringify(result.warnings.unexpected));
  }
  if (!result.findings.pass) {
    parts.push('findings: missing=' + JSON.stringify(result.findings.missing) +
      ' unexpected=' + JSON.stringify(result.findings.unexpected));
  }
  return result.specimen + ': ' + parts.join('; ');
}

function formatCompose(result) {
  return result.results.map(r => r.specimen + ': ' + (r.pass ? 'PASS' : 'FAIL')).join(', ');
}
