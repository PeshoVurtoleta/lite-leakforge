/**
 * @zakkster/lite-leakforge -- test/format.test.js
 *
 * Tests for the ASCII formatters.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatOwnerPath,
  formatReport,
  formatFinding,
  formatWarning,
  formatSummary,
  formatVerifyResult,
  summarize,
} from '../formatters/Format.js';

// -----------------------------------------------------------------
// formatOwnerPath
// -----------------------------------------------------------------

describe('formatOwnerPath', () => {
  it('returns (no owner) for null', () => {
    assert.equal(formatOwnerPath(null), '(no owner)');
  });

  it('returns (no owner) for empty array', () => {
    assert.equal(formatOwnerPath([]), '(no owner)');
  });

  it('renders a single frame', () => {
    const path = [{ id: 3, kind: 'effect' }];
    assert.equal(formatOwnerPath(path), '[3 effect]');
  });

  it('renders multiple frames with arrows', () => {
    const path = [
      { id: 3, kind: 'effect' },
      { id: 1, kind: 'computed' },
    ];
    assert.equal(formatOwnerPath(path), '[3 effect] -> [1 computed]');
  });

  it('marks brokenAt frame', () => {
    const path = [
      { id: 3, kind: 'effect' },
      { id: 1, kind: 'computed' },
    ];
    assert.equal(
      formatOwnerPath(path, 1),
      '[3 effect] -> [1 computed] *BROKEN*'
    );
  });

  it('marks brokenAt at depth 0', () => {
    const path = [{ id: 5, kind: 'effect' }];
    assert.equal(formatOwnerPath(path, 0), '[5 effect] *BROKEN*');
  });

  it('uses ASCII only (no box-drawing)', () => {
    const path = [
      { id: 1, kind: 'effect' },
      { id: 2, kind: 'computed' },
      { id: 3, kind: 'signal' },
    ];
    const result = formatOwnerPath(path);
    // No unicode box-drawing chars
    assert.ok(!/[\u2500-\u257F]/.test(result));
    assert.ok(result.includes('->'));
  });
});

// -----------------------------------------------------------------
// formatReport
// -----------------------------------------------------------------

describe('formatReport', () => {
  it('handles null', () => {
    assert.equal(formatReport(null), '(null report)');
  });

  it('formats a minimal report', () => {
    const r = { kind: 'unknown', tag: 'test-tag' };
    const out = formatReport(r);
    assert.ok(out.startsWith('LEAK: kind=unknown'));
    assert.ok(out.includes('tag: test-tag'));
  });

  it('includes ownerPath', () => {
    const r = {
      kind: 'timer-orphan',
      ownerPath: [{ id: 1, kind: 'effect' }],
      timerKind: 'setTimeout',
      timerId: 42,
    };
    const out = formatReport(r);
    assert.ok(out.includes('owner: [1 effect]'));
    assert.ok(out.includes('timer: setTimeout id=42'));
  });

  it('formats object tags as JSON', () => {
    const r = { kind: 'unknown', tag: { kind: 'observer', type: 'click' } };
    const out = formatReport(r);
    assert.ok(out.includes('"kind":"observer"'));
  });

  it('trims origin stacks', () => {
    const r = {
      kind: 'unknown',
      origin: 'Error\n    at foo (/a.js:1)\n    at bar (/b.js:2)\n    at baz (/c.js:3)\n    at qux (/d.js:4)',
    };
    const out = formatReport(r);
    assert.ok(out.includes('origin:'));
    // Should have at most 3 non-Error lines
    assert.ok(!out.includes('qux'));
  });
});

// -----------------------------------------------------------------
// formatFinding
// -----------------------------------------------------------------

describe('formatFinding', () => {
  it('handles null', () => {
    assert.equal(formatFinding(null), '(null finding)');
  });

  it('formats a finding with kind and reason', () => {
    const f = { kind: 'timer-orphan', reason: 'no-owner-pending' };
    const out = formatFinding(f);
    assert.ok(out.startsWith('FINDING:'));
    assert.ok(out.includes('kind=timer-orphan'));
    assert.ok(out.includes('reason=no-owner-pending'));
  });
});

// -----------------------------------------------------------------
// formatWarning
// -----------------------------------------------------------------

describe('formatWarning', () => {
  it('formats a warning', () => {
    const w = { kind: 'listener-orphan', reason: 'no-owner-set', type: 'click' };
    const out = formatWarning(w);
    assert.ok(out.startsWith('WARNING:'));
    assert.ok(out.includes('kind=listener-orphan'));
    assert.ok(out.includes('type: click'));
  });
});

// -----------------------------------------------------------------
// summarize
// -----------------------------------------------------------------

describe('summarize', () => {
  it('returns empty for empty input', () => {
    assert.deepEqual(summarize([]), []);
    assert.deepEqual(summarize(null), []);
  });

  it('groups by kind+reason', () => {
    const events = [
      { kind: 'timer-orphan', reason: 'no-owner-set' },
      { kind: 'timer-orphan', reason: 'no-owner-set' },
      { kind: 'timer-orphan', reason: 'no-owner-pending' },
      { kind: 'listener-orphan', reason: 'no-owner-set' },
    ];
    const groups = summarize(events);
    assert.equal(groups.length, 3);
    // Sorted by count descending
    assert.equal(groups[0].kind, 'timer-orphan');
    assert.equal(groups[0].reason, 'no-owner-set');
    assert.equal(groups[0].count, 2);
    assert.equal(groups[1].count, 1);
    assert.equal(groups[2].count, 1);
  });

  it('preserves first event reference', () => {
    const e1 = { kind: 'a', reason: 'x', extra: 'first' };
    const e2 = { kind: 'a', reason: 'x', extra: 'second' };
    const groups = summarize([e1, e2]);
    assert.equal(groups[0].first, e1);
  });
});

// -----------------------------------------------------------------
// formatSummary
// -----------------------------------------------------------------

describe('formatSummary', () => {
  it('returns (no events) for empty', () => {
    assert.equal(formatSummary([]), '(no events)');
  });

  it('formats groups as count x kind (reason)', () => {
    const groups = [
      { kind: 'timer-orphan', reason: 'no-owner-set', count: 3, first: {} },
      { kind: 'unknown', reason: null, count: 1, first: {} },
    ];
    const out = formatSummary(groups);
    assert.ok(out.includes('3x timer-orphan (no-owner-set)'));
    assert.ok(out.includes('1x unknown'));
    // No reason appended for null
    assert.ok(!out.includes('1x unknown ('));
  });
});

// -----------------------------------------------------------------
// formatVerifyResult
// -----------------------------------------------------------------

describe('formatVerifyResult', () => {
  it('formats a passing result', () => {
    const result = {
      pass: true,
      specimen: 'test-spec',
      leaks: { actual: [], missing: [], unexpected: [] },
      warnings: { actual: [], missing: [], unexpected: [] },
      findings: { actual: [], missing: [], unexpected: [] },
      settleResult: null,
    };
    const out = formatVerifyResult(result);
    assert.ok(out.includes('=== test-spec === PASS'));
  });

  it('formats a failing result with missing leaks', () => {
    const result = {
      pass: false,
      specimen: 'broken',
      leaks: {
        actual: [{ kind: 'unknown', tag: 'x' }],
        missing: [{ kind: 'timer-orphan' }],
        unexpected: [],
      },
      warnings: { actual: [], missing: [], unexpected: [] },
      findings: { actual: [], missing: [], unexpected: [] },
      settleResult: { settled: true, rounds: 2, remaining: 0 },
    };
    const out = formatVerifyResult(result);
    assert.ok(out.includes('=== broken === FAIL'));
    assert.ok(out.includes('LEAK: kind=unknown'));
    assert.ok(out.includes('MISSING: timer-orphan'));
    assert.ok(out.includes('Settle: OK rounds=2'));
  });
});
