/**
 * @zakkster/lite-leakforge -- test/cli.test.js
 *
 * Tests for the `leakforge` CLI core (bin/Cli.js). Pure-function tests need no
 * GC; the end-to-end gate run is skipped without --expose-gc.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  parseArgs,
  builtinSpecimens,
  runSpecimens,
  renderSpecimenReport,
  specimenReportToJson,
  runSuite,
  loadSuite,
  renderSuiteReport,
  suiteReportToJson,
  EXIT_CLEAN,
  EXIT_LEAK,
  EXIT_INCONCLUSIVE,
} from '../bin/Cli.js';
import { createRafOrphanSpecimen } from '../scenarios/Scenarios.js';

const HAS_GC = typeof globalThis.gc === 'function';

// -----------------------------------------------------------------
// parseArgs
// -----------------------------------------------------------------

describe('parseArgs', () => {
  it('parses a suite path', () => {
    const a = parseArgs(['suite.js']);
    assert.equal(a.mode, 'suite');
    assert.equal(a.suite, 'suite.js');
    assert.equal(a.json, null);
    assert.equal(a.error, null);
  });

  it('parses --json <path> and --json=<path>', () => {
    assert.equal(parseArgs(['s.js', '--json', 'out.json']).json, 'out.json');
    assert.equal(parseArgs(['s.js', '--json=out.json']).json, 'out.json');
  });

  it('errors when --json has no path', () => {
    assert.equal(parseArgs(['s.js', '--json']).error, '--json requires a path');
    assert.equal(parseArgs(['s.js', '--json', '--other']).error, '--json requires a path');
  });

  it('parses --specimens with names', () => {
    const a = parseArgs(['--specimens', 'raf-orphan', 'timer-orphan']);
    assert.equal(a.mode, 'specimens');
    assert.deepEqual(a.specimens, ['raf-orphan', 'timer-orphan']);
  });

  it('flags help/version', () => {
    assert.equal(parseArgs(['--help']).help, true);
    assert.equal(parseArgs(['-h']).help, true);
    assert.equal(parseArgs(['--version']).version, true);
    assert.equal(parseArgs(['-v']).version, true);
  });

  it('errors on unknown option', () => {
    assert.equal(parseArgs(['--bogus']).error, 'unknown option: --bogus');
  });
});

// -----------------------------------------------------------------
// builtinSpecimens
// -----------------------------------------------------------------

describe('builtinSpecimens', () => {
  it('returns all when no names given', () => {
    const all = builtinSpecimens();
    assert.ok(all.length >= 7, 'at least 7 built-in specimens');
        assert.ok(all.some((s) => s.name === 'raf-orphan'), 'includes raf-orphan');
  });

  it('returns the named subset', () => {
    const s = builtinSpecimens(['raf-orphan']);
    assert.equal(s.length, 1);
    assert.equal(s[0].name, 'raf-orphan');
  });

  it('throws on an unknown name', () => {
    assert.throws(() => builtinSpecimens(['nope']), /unknown specimen/);
  });
});

// -----------------------------------------------------------------
// runSpecimens (kernel acceptance)
// -----------------------------------------------------------------

describe('runSpecimens', () => {
  it('passes raf-orphan without --expose-gc', async () => {
    const report = await runSpecimens([createRafOrphanSpecimen()]);
    assert.equal(report.exitCode, EXIT_CLEAN);
    assert.equal(report.clean, true);
    assert.equal(report.failed, 0);
    assert.equal(report.errored, 0);
    assert.ok(report.summary.length >= 1);
  });

  it('reports EXIT_LEAK when a specimen regresses', async () => {
    const bogus = {
      name: 'bogus',
      kernels: () => [],
      expectedWarnings: [{ kind: 'never' }],
      needsSettle: false,
      inject() {},
      release() {},
    };
    const report = await runSpecimens([bogus]);
    assert.equal(report.exitCode, EXIT_LEAK);
    assert.equal(report.failed, 1);
  });

  it('reports EXIT_INCONCLUSIVE when verify throws (environment error)', async () => {
    const orig = globalThis.gc;
    globalThis.gc = undefined;
    try {
      const needsGc = {
        name: 'needs-gc',
        kernels: () => [],
        expectedLeaks: [],
        inject() {},
        release() {},
      };
      const report = await runSpecimens([needsGc]);
      assert.equal(report.exitCode, EXIT_INCONCLUSIVE);
      assert.equal(report.errored, 1);
      assert.ok(report.results[0].error !== undefined);
    } finally {
      globalThis.gc = orig;
    }
  });

  it('renders and serializes a specimen report', () => {
    const report = {
      results: [{
        specimen: 'x',
        pass: true,
        leaks: { actual: [], missing: [] },
        warnings: { actual: [{ kind: 'k', reason: 'r' }], missing: [] },
        findings: { actual: [], missing: [] },
        settleResult: null,
      }],
      failed: 0,
      errored: 0,
      exitCode: EXIT_CLEAN,
      clean: true,
      summary: [{ kind: 'k', reason: 'r', count: 1 }],
    };
    const text = renderSpecimenReport(report);
    assert.match(text, /leakforge specimens/);
    assert.match(text, /Verdict: CLEAN \(exit 0\)/);
    const json = specimenReportToJson(report, '1.1.0');
    assert.equal(json.tool, 'leakforge');
    assert.equal(json.mode, 'specimens');
    assert.equal(json.exitCode, 0);
    assert.equal(json.results[0].warnings[0].kind, 'k');
  });
});

// -----------------------------------------------------------------
// suite rendering + JSON (no GC needed)
// -----------------------------------------------------------------

describe('renderSuiteReport + suiteReportToJson', () => {
  it('renders labels and verdict, serializes to JSON', () => {
    const report = {
      suite: 'demo',
      checks: [
        { name: 'ok', exitCode: EXIT_CLEAN, clean: true, leaks: [], warnings: [], findings: [], settle: { settled: true, rounds: 1, remaining: 0 } },
        { name: 'bad', exitCode: EXIT_LEAK, clean: false, leaks: [{ kind: 'unknown' }], warnings: [], findings: [{ kind: 'timer-orphan', reason: 'no-owner-pending' }], settle: { settled: true, rounds: 1, remaining: 0 } },
      ],
      exitCode: EXIT_LEAK,
      clean: false,
      summary: [
        { kind: 'timer-orphan', reason: 'no-owner-pending', count: 1 },
        { kind: 'unknown', reason: null, count: 1 },
      ],
    };
    const text = renderSuiteReport(report);
    assert.match(text, /\[CLEAN\] ok/);
    assert.match(text, /\[LEAK\] bad/);
    assert.match(text, /Verdict: LEAK \(exit 1\)/);

    const json = suiteReportToJson(report, '1.1.0');
    assert.equal(json.mode, 'suite');
    assert.equal(json.exitCode, 1);
    assert.equal(json.checks[1].findings[0].reason, 'no-owner-pending');
    assert.equal(json.summary.length, 2);
  });

  it('shows INCONCLUSIVE with remaining count', () => {
    const report = {
      suite: 'inc',
      checks: [{ name: 'unsettled', exitCode: EXIT_INCONCLUSIVE, clean: false, leaks: [], warnings: [], findings: [], settle: { settled: false, rounds: 10, remaining: 2 } }],
      exitCode: EXIT_INCONCLUSIVE,
      clean: false,
      summary: [],
    };
    const text = renderSuiteReport(report);
    assert.match(text, /\[INCONCLUSIVE\] unsettled  -- FR unsettled, 2 remaining/);
    assert.match(text, /Verdict: INCONCLUSIVE \(exit 3\)/);
  });
});

// -----------------------------------------------------------------
// End-to-end gate run (requires --expose-gc)
// -----------------------------------------------------------------

describe('runSuite end-to-end', { skip: !HAS_GC && 'requires --expose-gc' }, () => {
  it('CLEAN suite exits 0; leaky suite exits 1 (evidence wins)', async () => {
    const clean = { name: 'clean-suite', checks: [{ name: 'noop', run: () => {} }] };
    const cr = await runSuite(clean);
    assert.equal(cr.exitCode, EXIT_CLEAN);
    assert.equal(cr.clean, true);

    const leaky = {
      name: 'leaky-suite',
      checks: [
        { name: 'noop', run: () => {} },
        { name: 'raw-leak', run: (tracker) => { tracker.track({}, function () {}, 'cli-leak'); } },
      ],
    };
    const lr = await runSuite(leaky);
    assert.equal(lr.exitCode, EXIT_LEAK);
    assert.equal(lr.checks[0].exitCode, EXIT_CLEAN);
    assert.equal(lr.checks[1].exitCode, EXIT_LEAK);
    assert.ok(lr.summary.length >= 1);
  });

  it('loadSuite imports a file suite and runs it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lf-'));
    const p = join(dir, 'suite.mjs');
    writeFileSync(p, 'export default { name: "file-suite", checks: [{ name: "ok", run: () => {} }] };\n');
    try {
      const suite = await loadSuite(p);
      const r = await runSuite(suite);
      assert.equal(r.exitCode, EXIT_CLEAN);
      assert.equal(r.suite, 'file-suite');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
