/**
 * @zakkster/lite-leakforge -- test/panels.test.js
 *
 * Tests for the dashboard data model.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDashboardModel,
  CHANNEL_LEAK,
  CHANNEL_WARNING,
  CHANNEL_FINDING,
  CHANNEL_ERROR,
} from '../panels/Panels.js';

// -----------------------------------------------------------------
// Ghost safety
// -----------------------------------------------------------------

describe('ghost safety', () => {
  it('creates exactly 2 signals', () => {
    const model = createDashboardModel();
    assert.equal(model.signalCount(), 2);
  });

  it('signal count is stable after events', () => {
    const model = createDashboardModel();
    model.onLeak({ kind: 'a' });
    model.onWarning({ kind: 'b' });
    model.onFinding({ kind: 'c' });
    model.onError(new Error('x'), 'y');
    assert.equal(model.signalCount(), 2);
  });
});

// -----------------------------------------------------------------
// Lazy entry fields
// -----------------------------------------------------------------

describe('lazy entry formatting', () => {
  it('text is formatted on first read and memoized', () => {
    const model = createDashboardModel();
    model.onLeak({ kind: 'timer-orphan', tag: 'x' });
    const entry = model.getEntries()[0];
    assert.equal(entry._text, null, 'no formatting cost on push');
    const first = entry.text;
    assert.ok(first.startsWith('LEAK: kind=timer-orphan'));
    assert.equal(entry._text, first, 'memoized after first read');
    assert.equal(entry.text, first, 'stable on re-read');
  });

  it('ownerPath is lazy and formats broken frames', () => {
    const model = createDashboardModel();
    model.onLeak({
      kind: 'owner-cascade-orphan',
      ownerPath: [{ id: 3, kind: 'effect' }, { id: 1, kind: 'computed' }],
      brokenAt: 1,
    });
    const entry = model.getEntries()[0];
    assert.equal(entry._ownerPath, null);
    assert.equal(entry.ownerPath, '[3 effect] -> [1 computed] *BROKEN*');
  });

  it('label is a compact channel + kind + reason line', () => {
    const model = createDashboardModel();
    model.onWarning({ kind: 'timer-orphan', reason: 'no-owner-set' });
    model.onLeak({ kind: 'unknown' });
    const entries = model.getEntries();
    assert.equal(entries[0].label, 'W timer-orphan (no-owner-set)');
    assert.equal(entries[1].label, 'L unknown');
  });
});

// -----------------------------------------------------------------
// Ring buffer
// -----------------------------------------------------------------

describe('event log ring buffer', () => {
  it('starts empty', () => {
    const model = createDashboardModel();
    assert.equal(model.count, 0);
    assert.deepEqual(model.getEntries(), []);
  });

  it('pushes leak entries', () => {
    const model = createDashboardModel();
    model.onLeak({ kind: 'timer-orphan', tag: 'x' });
    assert.equal(model.count, 1);
    const entries = model.getEntries();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].channel, CHANNEL_LEAK);
    assert.equal(entries[0].kind, 'timer-orphan');
  });

  it('pushes all channel types', () => {
    const model = createDashboardModel();
    model.onLeak({ kind: 'leak-kind' });
    model.onWarning({ kind: 'warn-kind', reason: 'no-owner-set' });
    model.onFinding({ kind: 'find-kind', reason: 'stale' });
    model.onError(new Error('boom'), 'tag');
    assert.equal(model.count, 4);
    const entries = model.getEntries();
    assert.equal(entries[0].channel, CHANNEL_LEAK);
    assert.equal(entries[1].channel, CHANNEL_WARNING);
    assert.equal(entries[1].reason, 'no-owner-set');
    assert.equal(entries[2].channel, CHANNEL_FINDING);
    assert.equal(entries[3].channel, CHANNEL_ERROR);
  });

  it('wraps around at capacity', () => {
    const model = createDashboardModel({ logCapacity: 4 });
    for (let i = 0; i < 6; i++) {
      model.onLeak({ kind: 'k' + i });
    }
    assert.equal(model.count, 4);
    assert.equal(model.capacity, 4);
    const entries = model.getEntries();
    assert.equal(entries.length, 4);
    // Oldest surviving is k2
    assert.equal(entries[0].kind, 'k2');
    assert.equal(entries[3].kind, 'k5');
  });

  it('getRecent returns newest first', () => {
    const model = createDashboardModel();
    model.onLeak({ kind: 'a' });
    model.onLeak({ kind: 'b' });
    model.onLeak({ kind: 'c' });
    const recent = model.getRecent(2);
    assert.equal(recent.length, 2);
    assert.equal(recent[0].kind, 'c');
    assert.equal(recent[1].kind, 'b');
  });
});

// -----------------------------------------------------------------
// logVersion signal
// -----------------------------------------------------------------

describe('logVersion signal', () => {
  it('bumps on each push', () => {
    const model = createDashboardModel();
    assert.equal(model.logVersion.peek(), 0);
    model.onLeak({ kind: 'a' });
    assert.equal(model.logVersion.peek(), 1);
    model.onWarning({ kind: 'b' });
    assert.equal(model.logVersion.peek(), 2);
  });
});

// -----------------------------------------------------------------
// Kind filter
// -----------------------------------------------------------------

describe('filterKind', () => {
  it('defaults to null (show all)', () => {
    assert.equal(createDashboardModel().filterKind.peek(), null);
  });

  it('filters entries by kind', () => {
    const model = createDashboardModel();
    model.onLeak({ kind: 'timer-orphan' });
    model.onLeak({ kind: 'listener-orphan' });
    model.onLeak({ kind: 'timer-orphan' });

    model.filterKind.set('timer-orphan');
    const filtered = model.getEntries();
    assert.equal(filtered.length, 2);
    assert.equal(filtered[0].kind, 'timer-orphan');
    assert.equal(filtered[1].kind, 'timer-orphan');
  });

  it('shows all when filter is null', () => {
    const model = createDashboardModel();
    model.onLeak({ kind: 'a' });
    model.onLeak({ kind: 'b' });
    model.filterKind.set(null);
    assert.equal(model.getEntries().length, 2);
  });

  it('getEntries with applyFilter:false ignores filter', () => {
    const model = createDashboardModel();
    model.onLeak({ kind: 'a' });
    model.onLeak({ kind: 'b' });
    model.filterKind.set('a');
    assert.equal(model.getEntries().length, 1);
    assert.equal(model.getEntries({ applyFilter: false }).length, 2);
  });
});

// -----------------------------------------------------------------
// Kernel registry snapshot
// -----------------------------------------------------------------

describe('snapshotKernels', () => {
  it('snapshots kernel descriptors', () => {
    const model = createDashboardModel();
    const kernels = [
      {
        name: 'timer-orphan',
        patchSurfaces: ['setTimeout', 'setInterval'],
        priority: 0,
        refine: function () {},
        audit: function () { return []; },
      },
      {
        name: 'async-retention',
        patchSurfaces: ['AbortController'],
        priority: 5,
        refine: function () {},
        audit: function () { return []; },
        advise: function () {},
      },
    ];
    const snap = model.snapshotKernels(kernels);
    assert.equal(snap.length, 2);
    assert.equal(snap[0].name, 'timer-orphan');
    assert.deepEqual(snap[0].patchSurfaces, ['setTimeout', 'setInterval']);
    assert.equal(snap[0].priority, 0);
    assert.equal(snap[0].hasRefine, true);
    assert.equal(snap[0].hasAudit, true);
    assert.equal(snap[0].hasAdvise, false);
    assert.equal(snap[1].name, 'async-retention');
    assert.equal(snap[1].priority, 5);
    assert.equal(snap[1].hasAdvise, true);
  });

  it('handles empty array', () => {
    const model = createDashboardModel();
    assert.deepEqual(model.snapshotKernels([]), []);
  });
});

// -----------------------------------------------------------------
// Owner-path inspector
// -----------------------------------------------------------------

describe('inspectOwnerPath', () => {
  it('inspects a leak entry with ownerPath', () => {
    const model = createDashboardModel();
    model.onLeak({
      kind: 'owner-cascade-orphan',
      ownerPath: [{ id: 3, kind: 'effect' }, { id: 1, kind: 'computed' }],
      brokenAt: 1,
    });
    const entries = model.getEntries();
    const inspection = model.inspectOwnerPath(entries[0]);
    assert.equal(inspection.depth, 2);
    assert.equal(inspection.brokenAt, 1);
    assert.ok(inspection.formatted.includes('[3 effect]'));
    assert.ok(inspection.formatted.includes('*BROKEN*'));
    assert.equal(inspection.kind, 'owner-cascade-orphan');
  });

  it('handles entry with no ownerPath', () => {
    const model = createDashboardModel();
    model.onWarning({ kind: 'timer-orphan', reason: 'no-owner-set' });
    const entries = model.getEntries();
    const inspection = model.inspectOwnerPath(entries[0]);
    assert.equal(inspection.depth, 0);
    assert.equal(inspection.formatted, '(no owner)');
  });

  it('handles null entry', () => {
    const model = createDashboardModel();
    const inspection = model.inspectOwnerPath(null);
    assert.equal(inspection.formatted, '(no entry)');
  });
});

// -----------------------------------------------------------------
// Reset
// -----------------------------------------------------------------

describe('reset', () => {
  it('clears all state', () => {
    const model = createDashboardModel();
    model.onLeak({ kind: 'a' });
    model.onWarning({ kind: 'b' });
    model.filterKind.set('a');
    model.reset();
    assert.equal(model.count, 0);
    assert.equal(model.logVersion.peek(), 0);
    assert.equal(model.filterKind.peek(), null);
    assert.deepEqual(model.getEntries(), []);
  });
});
