/**
 * --baseline (1.5.0): fail only on findings new since a saved baseline.
 *
 * The point of the feature is adoption: a codebase that already leaks can add
 * the gate without fixing everything first, and CI fails only when a NEW leak
 * appears or an existing one gets worse. These tests pin the comparison rules,
 * because a baseline that silently passes a real regression is worse than no
 * baseline at all.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseArgs, buildBaseline, compareBaseline, renderBaselineReport,
} from '../bin/Cli.js';

/** A minimal suite report with the given flat findings on one check. */
function reportWith(findings) {
  return { suite: 'demo', checks: [{ findings }] };
}
const F = (kind, reason) => ({ kind, reason });

// --- arg parsing ---

test('--baseline <path> and --update-baseline parse', () => {
  const a = parseArgs(['suite.mjs', '--baseline', 'b.json']);
  assert.equal(a.baseline, 'b.json');
  assert.equal(a.updateBaseline, false);

  const b = parseArgs(['suite.mjs', '--baseline', 'b.json', '--update-baseline']);
  assert.equal(b.baseline, 'b.json');
  assert.equal(b.updateBaseline, true);

  const c = parseArgs(['suite.mjs', '--baseline=b.json']);
  assert.equal(c.baseline, 'b.json');
});

test('--baseline without a path is a usage error', () => {
  assert.match(parseArgs(['s.mjs', '--baseline']).error, /--baseline requires a path/);
  assert.match(parseArgs(['s.mjs', '--baseline=']).error, /--baseline= requires a non-empty path/);
  assert.match(parseArgs(['s.mjs', '--baseline', '--group']).error, /--baseline requires a path/);
});

// --- buildBaseline ---

test('buildBaseline records cluster counts keyed by kind:reason', () => {
  const b = buildBaseline(reportWith([
    F('timer-orphan', 'no-owner-pending'),
    F('timer-orphan', 'no-owner-pending'),
    F('socket-orphan', 'no-owner-open'),
  ]), '1.5.0');
  assert.equal(b.baselineFormat, 1);
  assert.equal(b.clusters['timer-orphan:no-owner-pending'], 2);
  assert.equal(b.clusters['socket-orphan:no-owner-open'], 1);
  assert.equal(typeof b.createdAt, 'string');
});

test('baseline keys ignore origin, so they survive code edits', () => {
  // Same kind/reason from two different stacks must collapse to one cluster --
  // a baseline keyed on stack lines would break on every edit.
  const b = buildBaseline(reportWith([
    { kind: 'timer-orphan', reason: 'no-owner-pending', origin: 'at a.js:1:1' },
    { kind: 'timer-orphan', reason: 'no-owner-pending', origin: 'at b.js:9:9' },
  ]));
  assert.equal(b.clusters['timer-orphan:no-owner-pending'], 2);
  assert.equal(Object.keys(b.clusters).length, 1);
});

// --- compareBaseline ---

test('an identical run does not regress', () => {
  const baseline = buildBaseline(reportWith([
    F('timer-orphan', 'no-owner-pending'), F('timer-orphan', 'no-owner-pending'),
  ]));
  const c = compareBaseline(reportWith([
    F('timer-orphan', 'no-owner-pending'), F('timer-orphan', 'no-owner-pending'),
  ]), baseline);
  assert.equal(c.regressed, false);
  assert.equal(c.baselinedFindings, 2);
  assert.deepEqual(c.added, []);
  assert.deepEqual(c.increased, []);
});

test('a new cluster is a regression', () => {
  const baseline = buildBaseline(reportWith([F('timer-orphan', 'no-owner-pending')]));
  const c = compareBaseline(reportWith([
    F('timer-orphan', 'no-owner-pending'),
    F('socket-orphan', 'no-owner-open'),
  ]), baseline);
  assert.equal(c.regressed, true);
  assert.equal(c.added.length, 1);
  assert.equal(c.added[0].key, 'socket-orphan:no-owner-open');
});

test('a higher count on a known cluster is a regression', () => {
  const baseline = buildBaseline(reportWith([
    F('timer-orphan', 'no-owner-pending'), F('timer-orphan', 'no-owner-pending'),
  ]));
  const c = compareBaseline(reportWith([
    F('timer-orphan', 'no-owner-pending'), F('timer-orphan', 'no-owner-pending'),
    F('timer-orphan', 'no-owner-pending'),
  ]), baseline);
  assert.equal(c.regressed, true);
  assert.equal(c.increased.length, 1);
  assert.equal(c.increased[0].from, 2);
  assert.equal(c.increased[0].to, 3);
});

test('a lower count is an improvement, never a regression', () => {
  const baseline = buildBaseline(reportWith([
    F('timer-orphan', 'no-owner-pending'), F('timer-orphan', 'no-owner-pending'),
    F('timer-orphan', 'no-owner-pending'),
  ]));
  const c = compareBaseline(reportWith([F('timer-orphan', 'no-owner-pending')]), baseline);
  assert.equal(c.regressed, false);
  assert.equal(c.baselinedFindings, 1, 'only the current count is baselined, not the old higher one');
});

test('a cluster that vanished is reported as resolved, not a regression', () => {
  const baseline = buildBaseline(reportWith([
    F('timer-orphan', 'no-owner-pending'),
    F('socket-orphan', 'no-owner-open'),
  ]));
  const c = compareBaseline(reportWith([F('timer-orphan', 'no-owner-pending')]), baseline);
  assert.equal(c.regressed, false);
  assert.equal(c.resolved.length, 1);
  assert.equal(c.resolved[0].key, 'socket-orphan:no-owner-open');
});

test('a clean run against a clean baseline is clean', () => {
  const c = compareBaseline(reportWith([]), buildBaseline(reportWith([])));
  assert.equal(c.regressed, false);
  assert.deepEqual(c.added, []);
});

// --- fail-closed on bad baselines ---

test('a malformed baseline throws rather than silently passing', () => {
  assert.throws(() => compareBaseline(reportWith([]), null), /malformed/);
  assert.throws(() => compareBaseline(reportWith([]), {}), /malformed/);
  assert.throws(() => compareBaseline(reportWith([]), { clusters: 'nope' }), /malformed/);
});

test('an unsupported baseline format throws with a regenerate hint', () => {
  assert.throws(
    () => compareBaseline(reportWith([]), { baselineFormat: 99, clusters: {} }),
    /format 99 is not supported.*--update-baseline/s
  );
});

// --- rendering ---

test('the report shows new, increased, and resolved clusters', () => {
  const baseline = buildBaseline(reportWith([
    F('timer-orphan', 'no-owner-pending'),
    F('detached-dom', 'orphaned-subtree'),
  ]));
  const current = reportWith([
    F('timer-orphan', 'no-owner-pending'), F('timer-orphan', 'no-owner-pending'),
    F('socket-orphan', 'no-owner-open'),
  ]);
  const text = renderBaselineReport(current, compareBaseline(current, baseline));
  assert.match(text, /NEW leak clusters/);
  assert.match(text, /socket-orphan \/ no-owner-open/);
  assert.match(text, /INCREASED past baseline/);
  assert.match(text, /timer-orphan \/ no-owner-pending {2}1 -> 2/);
  assert.match(text, /Resolved since baseline/);
  assert.match(text, /LEAK \(exit 1\)/);
});

test('a clean comparison renders a clean verdict', () => {
  const baseline = buildBaseline(reportWith([F('timer-orphan', 'no-owner-pending')]));
  const text = renderBaselineReport(
    reportWith([F('timer-orphan', 'no-owner-pending')]),
    compareBaseline(reportWith([F('timer-orphan', 'no-owner-pending')]), baseline)
  );
  assert.match(text, /No new leaks against baseline/);
  assert.match(text, /CLEAN \(exit 0\)/);
});

test('a baseline survives a JSON round-trip', () => {
  // The baseline is written to disk as JSON and read back; the comparison must
  // behave identically after serialization.
  const built = buildBaseline(reportWith([
    F('timer-orphan', 'no-owner-pending'), F('timer-orphan', 'no-owner-pending'),
  ]), '1.5.0');
  const roundTripped = JSON.parse(JSON.stringify(built));
  const c = compareBaseline(reportWith([
    F('timer-orphan', 'no-owner-pending'), F('timer-orphan', 'no-owner-pending'),
  ]), roundTripped);
  assert.equal(c.regressed, false);
});
