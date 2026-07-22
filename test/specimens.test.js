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
  createWorkerOrphanSpecimen,
  createAudioNodeSpecimen,
  createSocketOrphanSpecimen,
  createGlResourceOrphanSpecimen,
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
// Specimen: worker-orphan (1.2.0)
// -----------------------------------------------------------------

describe('worker-orphan specimen', () => {
  it('fires warning + findings for an ownerless worker with an unrevoked blob URL', async () => {
    const specimen = createWorkerOrphanSpecimen();
    const result = await verify(specimen);
    assert.equal(result.pass, true, formatFailure(result));
    assert.equal(result.warnings.actual.length, 1);
    assert.equal(result.warnings.actual[0].kind, 'worker-orphan');
    assert.equal(result.warnings.actual[0].reason, 'no-owner-set');
    // Two findings: the live worker, and its object URL never revoked.
    const reasons = result.findings.actual.map((f) => f.reason).sort();
    assert.deepEqual(reasons, ['blob-url-unrevoked', 'no-owner-worker-live']);
    assert.equal(result.leaks.actual.length, 0);
    assert.equal(result.settleResult, null);
  });
});

// -----------------------------------------------------------------
// Specimen: audio-node (1.2.0)
// -----------------------------------------------------------------

describe('audio-node specimen', () => {
  it('fires warning + findings for a connected, started, ownerless source', async () => {
    const specimen = createAudioNodeSpecimen();
    const result = await verify(specimen);
    assert.equal(result.pass, true, formatFailure(result));
    assert.equal(result.warnings.actual.length, 1);
    assert.equal(result.warnings.actual[0].kind, 'audio-node');
    assert.equal(result.warnings.actual[0].reason, 'no-owner-connect');
    // Both halves of an audio leak: still in the graph, still audible.
    const reasons = result.findings.actual.map((f) => f.reason).sort();
    assert.deepEqual(reasons, ['no-owner-node-connected', 'source-started-not-stopped']);
    assert.equal(result.leaks.actual.length, 0);
  });
});

// -----------------------------------------------------------------
// Specimen: socket-orphan (1.2.0)
// -----------------------------------------------------------------

describe('socket-orphan specimen', () => {
  it('fires warning + finding for an ownerless open socket', async () => {
    const specimen = createSocketOrphanSpecimen();
    const result = await verify(specimen);
    assert.equal(result.pass, true, formatFailure(result));
    assert.equal(result.warnings.actual.length, 1);
    assert.equal(result.warnings.actual[0].reason, 'no-owner-open');
    assert.equal(result.findings.actual.length, 1);
    assert.equal(result.findings.actual[0].kind, 'socket-orphan');
    assert.equal(result.findings.actual[0].reason, 'no-owner-socket-open');
    assert.equal(result.leaks.actual.length, 0);
  });
});

// -----------------------------------------------------------------
// Specimen: gl-resource-orphan (1.3.0)
// -----------------------------------------------------------------

describe('gl-resource-orphan specimen', () => {
  it('fires warnings + findings for undeleted GPU resources', async () => {
    const specimen = createGlResourceOrphanSpecimen();
    const result = await verify(specimen);
    assert.equal(result.pass, true, formatFailure(result));
    // One warning per resource created outside an owner.
    assert.equal(result.warnings.actual.length, 2);
    for (const w of result.warnings.actual) {
      assert.equal(w.kind, 'gl-resource-orphan');
      assert.equal(w.reason, 'no-owner-create');
    }
    // Both resources still allocated on a live context, reported by kind.
    assert.equal(result.findings.actual.length, 2);
    const kinds = result.findings.actual.map((f) => f.resourceKind).sort();
    assert.deepEqual(kinds, ['buffer', 'texture'],
      'resourceKind must distinguish GPU object types');
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
      createWorkerOrphanSpecimen(),
      createAudioNodeSpecimen(),
      createSocketOrphanSpecimen(),
      createGlResourceOrphanSpecimen(),
    ]);
    assert.equal(result.pass, true, formatCompose(result));
    assert.equal(result.passed, 10);
    assert.equal(result.failed, 0);
  });

  it('runs all 11 specimens including raw-fr', { skip: !HAS_GC && 'requires --expose-gc' }, async () => {
    const result = await composeScenario([
      createRawFrSpecimen(),
      createTimerOrphanSpecimen(),
      createListenerOrphanSpecimen(),
      createObserverOrphanSpecimen(),
      createDetachedDomSpecimen(),
      createAsyncRetentionSpecimen(),
      createRafOrphanSpecimen(),
      createWorkerOrphanSpecimen(),
      createAudioNodeSpecimen(),
      createSocketOrphanSpecimen(),
      createGlResourceOrphanSpecimen(),
    ]);
    assert.equal(result.pass, true, formatCompose(result));
    assert.equal(result.passed, 11);
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
