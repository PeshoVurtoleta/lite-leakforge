/**
 * @zakkster/lite-leakforge -- bin/Cli.js
 *
 * Core of the `leakforge` CLI, split from the executable so it can be unit
 * tested without spawning processes or touching process.exit. Pure functions:
 * they take inputs (argv, a loaded suite object, specimen instances) and return
 * plain data (reports, rendered strings, JSON-ready objects). The thin wrapper
 * in leakforge.js does the I/O, the --expose-gc relaunch, and the exit.
 *
 * Two modes, both ending in the gate's exit-code vocabulary:
 *   0 = clean            1 = confirmed leak            3 = inconclusive
 *
 *   suite mode      -- run a user leak-suite file's checks under createLeakGate
 *                      and aggregate with evidence-wins precedence.
 *   --specimens     -- run the built-in specimens through verify() (kernel
 *                      acceptance): 0 all pass, 1 a specimen regressed, 3 an
 *                      environment error (e.g. a needsSettle specimen without
 *                      --expose-gc).
 *
 * Copyright (c) 2026 Zahary Shinikchiev <shinikchiev@yahoo.com>
 * MIT License
 */

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  createLeakGate,
  EXIT_CLEAN,
  EXIT_LEAK,
  EXIT_INCONCLUSIVE,
} from '../harness/Gate.js';
import { verify } from '../scenarios/Contract.js';
import { summarize, formatSummary, formatVerifyResult } from '../formatters/Format.js';
import { groupFindings } from '@zakkster/lite-leak';
import {
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

export { EXIT_CLEAN, EXIT_LEAK, EXIT_INCONCLUSIVE };

// Usage exit code, distinct from the gate's 0/1/3 leak vocabulary.
export const EXIT_USAGE = 2;

export const USAGE =
  'leakforge -- CI leak gate for @zakkster/lite-leak\n' +
  '\n' +
  'Usage:\n' +
  '  leakforge <suite-file> [--json <path>]   Run a leak-suite file\n' +
  '  leakforge --specimens [name...]          Run built-in specimens (kernel acceptance)\n' +
  '  leakforge --help | --version\n' +
  '\n' +
  'A suite file default-exports { name, checks:[{ name, run(tracker) }], options? }.\n' +
  'Each check runs under a shared leak gate; leaks/findings fail the run.\n' +
  '\n' +
  'Options:\n' +
  '  --json <path>   Write a machine-readable JSON artifact for CI\n' +
  '  --group         Collapse findings into clusters (count per kind/reason)\n' +
  '  --specimens     Verify the built-in specimens instead of a suite file\n' +
  '  -h, --help      Show this help\n' +
  '  -v, --version   Show version\n' +
  '\n' +
  'Exit codes:\n' +
  '  0  clean          no leaks\n' +
  '  1  leak           confirmed leak (report or audit finding) -- evidence wins\n' +
  '  3  inconclusive   FR did not settle with no evidence; recapture\n' +
  '  2  usage error\n' +
  '\n' +
  'Requires --expose-gc; the CLI re-execs itself with it automatically.';

/**
 * Registry of built-in specimen factories, keyed by specimen name.
 * @private
 */
const BUILTIN = {
  'raw-fr': createRawFrSpecimen,
  'timer-orphan': createTimerOrphanSpecimen,
  'listener-orphan': createListenerOrphanSpecimen,
  'observer-orphan': createObserverOrphanSpecimen,
  'detached-dom': createDetachedDomSpecimen,
  'async-retention': createAsyncRetentionSpecimen,
  'raf-orphan': createRafOrphanSpecimen,
  'worker-orphan': createWorkerOrphanSpecimen,
  'audio-node': createAudioNodeSpecimen,
  'socket-orphan': createSocketOrphanSpecimen,
  'gl-resource-orphan': createGlResourceOrphanSpecimen,
};

/**
 * Resolve built-in specimen instances by name (all if names is empty).
 * @param {string[]} [names]
 * @returns {object[]}
 */
export function builtinSpecimens(names) {
  if (!Array.isArray(names) || names.length === 0) {
    const keys = Object.keys(BUILTIN);
    const out = [];
    for (let i = 0; i < keys.length; i++) out.push(BUILTIN[keys[i]]());
    return out;
  }
  const out = [];
  for (let i = 0; i < names.length; i++) {
    const factory = BUILTIN[names[i]];
    if (factory === undefined) {
      throw new Error('unknown specimen: ' + names[i] +
        ' (known: ' + Object.keys(BUILTIN).join(', ') + ')');
    }
    out.push(factory());
  }
  return out;
}

/**
 * Parse argv (already sliced past node + script).
 * @param {string[]} argv
 * @returns {{mode:string, suite:(string|null), specimens:string[], json:(string|null), help:boolean, version:boolean, error:(string|null)}}
 */
export function parseArgs(argv) {
  const out = {
    mode: 'suite', suite: null, specimens: [], json: null,
    group: false, help: false, version: false, error: null,
  };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--version' || a === '-v') out.version = true;
    else if (a === '--specimens') out.mode = 'specimens';
    else if (a === '--group') out.group = true;
    else if (a === '--json') {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('-')) {
        if (out.error === null) out.error = '--json requires a path';
      } else { out.json = next; i++; }
    } else if (a.startsWith('--json=')) {
      out.json = a.slice('--json='.length);
    } else if (a.startsWith('-')) {
      if (out.error === null) out.error = 'unknown option: ' + a;
    } else {
      rest.push(a);
    }
  }
  if (out.mode === 'specimens') out.specimens = rest;
  else out.suite = rest.length > 0 ? rest[0] : null;
  return out;
}

/**
 * Dynamically import a suite file and validate its shape.
 * @param {string} path
 * @returns {Promise<object>}
 */
export async function loadSuite(path) {
  const url = pathToFileURL(resolve(path)).href;
  const mod = await import(url);
  const suite = mod.default;
  if (suite === null || typeof suite !== 'object') {
    throw new Error('suite file must default-export an object { name, checks }');
  }
  if (!Array.isArray(suite.checks)) {
    throw new Error('suite.checks must be an array of { name, run(tracker) }');
  }
  return suite;
}

/**
 * Run a loaded suite object's checks under one gate. Aggregates the exit code
 * with evidence-wins precedence across checks.
 * @param {object} suite - { name?, options?, checks: Array<{name?, run}|Function> }
 * @param {object} [options] - forwarded to createLeakGate (overrides suite.options)
 * @returns {Promise<object>} SuiteReport
 */
export async function runSuite(suite, options) {
  const gateOpts = Object.assign(
    { name: suite.name || 'leakforge' },
    suite.options || {},
    options || {}
  );
  // Clustering by call site is the only thing --group offers over the existing
  // Summary line, and a call site needs a captured stack. Without this, --group
  // would print exactly what Summary already prints.
  if (options !== undefined && options !== null && options.group === true) {
    gateOpts.captureStacks = true;
  }
  const gate = createLeakGate(gateOpts);
  const checks = suite.checks;
  const results = [];
  const evidence = [];
  let anyLeak = false;
  let anyInconclusive = false;

  for (let i = 0; i < checks.length; i++) {
    const c = checks[i];
    const fn = typeof c === 'function' ? c : c.run;
    const name = (c && c.name) || ('check ' + (i + 1));
    const r = await gate.run(fn);
    results.push({
      name: name,
      exitCode: r.exitCode,
      clean: r.clean,
      leaks: r.leaks,
      warnings: r.warnings,
      findings: r.findings,
      settle: r.settleResult,
    });
    if (r.exitCode === EXIT_LEAK) anyLeak = true;
    else if (r.exitCode === EXIT_INCONCLUSIVE) anyInconclusive = true;
    for (let j = 0; j < r.leaks.length; j++) evidence.push(r.leaks[j]);
    for (let j = 0; j < r.findings.length; j++) evidence.push(r.findings[j]);
  }

  const exitCode = anyLeak
    ? EXIT_LEAK
    : (anyInconclusive ? EXIT_INCONCLUSIVE : EXIT_CLEAN);
  return {
    suite: suite.name || 'suite',
    checks: results,
    exitCode: exitCode,
    clean: exitCode === EXIT_CLEAN,
    summary: summarize(evidence),
  };
}

/**
 * Run specimen instances through verify() (kernel acceptance mode).
 * @param {object[]} specimens
 * @param {object} [options] - forwarded to verify()
 * @returns {Promise<object>} SpecimenReport
 */
export async function runSpecimens(specimens, options) {
  const results = [];
  const evidence = [];
  let failed = 0;
  let errored = 0;

  for (let i = 0; i < specimens.length; i++) {
    const spec = specimens[i];
    let r;
    try {
      r = await verify(spec, options);
    } catch (e) {
      errored++;
      results.push({ specimen: spec.name, pass: false, error: e.message });
      continue;
    }
    results.push(r);
    if (!r.pass) failed++;
    for (let j = 0; j < r.warnings.actual.length; j++) evidence.push(r.warnings.actual[j]);
    for (let j = 0; j < r.findings.actual.length; j++) evidence.push(r.findings.actual[j]);
    for (let j = 0; j < r.leaks.actual.length; j++) evidence.push(r.leaks.actual[j]);
  }

  const exitCode = errored > 0
    ? EXIT_INCONCLUSIVE
    : (failed > 0 ? EXIT_LEAK : EXIT_CLEAN);
  return {
    results: results,
    failed: failed,
    errored: errored,
    exitCode: exitCode,
    clean: exitCode === EXIT_CLEAN,
    summary: summarize(evidence),
  };
}

// -----------------------------------------------------------------
// Rendering
// -----------------------------------------------------------------

/**
 * Map a gate exit code to its label.
 * @private
 */
function label(code) {
  if (code === EXIT_LEAK) return 'LEAK';
  if (code === EXIT_INCONCLUSIVE) return 'INCONCLUSIVE';
  return 'CLEAN';
}

/**
 * @param {number} n
 * @param {string} noun
 * @private
 */
function count(n, noun) {
  return n + ' ' + noun + (n === 1 ? '' : 's');
}

/**
 * Render a SuiteReport as ASCII.
 * @param {object} report
 * @returns {string}
 */
/**
 * First stack frame that is not inside the instrumentation itself. The captured
 * origin starts inside the kernel's patched wrapper, which is never the line the
 * reader needs.
 * @private
 */
function firstUserFrame(origin) {
  const lines = origin.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (l.indexOf('at ') !== 0) continue;
    // Skip instrumentation frames by PATH, not by the substring 'lite-leak':
    // a user's own suite file may well live under a directory of that name.
    if (l.indexOf('node:') !== -1) continue;
    if (l.indexOf('@zakkster/lite-leak') !== -1) continue;
    if (l.indexOf('/kernels/') !== -1) continue;
    if (l.indexOf('/harness/Gate.js') !== -1) continue;
    if (l.indexOf('/Leak.js') !== -1) continue;
    return l.slice(3);
  }
  return null;
}

export function renderSuiteReport(report, options) {
  const lines = [];
  lines.push('=== leakforge: ' + report.suite + ' ===');
  for (let i = 0; i < report.checks.length; i++) {
    const c = report.checks[i];
    let line = '[' + label(c.exitCode) + '] ' + c.name;
    const bits = [];
    if (c.leaks.length > 0) bits.push(count(c.leaks.length, 'leak'));
    if (c.findings.length > 0) bits.push(count(c.findings.length, 'finding'));
    if (c.exitCode === EXIT_INCONCLUSIVE && c.settle !== null && c.settle !== undefined) {
      bits.push('FR unsettled, ' + c.settle.remaining + ' remaining');
    }
    if (bits.length > 0) line = line + '  -- ' + bits.join(', ');
    lines.push(line);
  }
  if (options !== undefined && options !== null && options.group === true) {
    const all = [];
    for (let i = 0; i < report.checks.length; i++) {
      const f = report.checks[i].findings;
      for (let j = 0; j < f.length; j++) all.push(f[j]);
    }
    const groups = groupFindings(all);
    if (groups.length > 0) {
      lines.push('');
      lines.push('Findings by cluster (' + groups.length +
        ' of ' + all.length + ' findings):');
      for (let i = 0; i < groups.length; i++) {
        const g = groups[i];
        lines.push('  ' + String(g.count).padStart(6) + ' x  ' + g.kind + ' / ' + g.reason);
        if (g.origin !== null) {
          const site = firstUserFrame(g.origin);
          if (site !== null) lines.push('           at ' + site);
        }
      }
    }
  }
  lines.push('');
  lines.push('Summary:');
  lines.push(report.summary.length > 0 ? formatSummary(report.summary) : '(no leaks)');
  lines.push('');
  lines.push('Verdict: ' + label(report.exitCode) + ' (exit ' + report.exitCode + ')');
  return lines.join('\n');
}

/**
 * Render a SpecimenReport as ASCII.
 * @param {object} report
 * @returns {string}
 */
export function renderSpecimenReport(report) {
  const lines = [];
  lines.push('=== leakforge specimens ===');
  for (let i = 0; i < report.results.length; i++) {
    const r = report.results[i];
    if (r.error !== undefined) {
      lines.push('=== ' + r.specimen + ' === ERROR');
      lines.push('  ' + r.error);
      continue;
    }
    lines.push(formatVerifyResult(r));
  }
  lines.push('');
  const total = report.results.length;
  const passed = total - report.failed - report.errored;
  let tally = 'Passed ' + passed + '/' + total;
  if (report.failed > 0) tally = tally + ', ' + report.failed + ' failed';
  if (report.errored > 0) tally = tally + ', ' + report.errored + ' errored';
  lines.push(tally);
  lines.push('Verdict: ' + label(report.exitCode) + ' (exit ' + report.exitCode + ')');
  return lines.join('\n');
}

// -----------------------------------------------------------------
// JSON artifacts
// -----------------------------------------------------------------

/**
 * Slim an event to the fields worth diffing in CI (no stacks).
 * @private
 */
function slimEvent(e) {
  return {
    kind: e.kind || null,
    reason: e.reason !== undefined ? e.reason : null,
    tag: e.tag !== undefined ? e.tag : null,
  };
}

/**
 * @private
 */
function slimSettle(s) {
  if (s === null || s === undefined) return null;
  return { settled: s.settled, rounds: s.rounds, remaining: s.remaining };
}

/**
 * @private
 */
function slimSummary(groups) {
  const out = [];
  for (let i = 0; i < groups.length; i++) {
    out.push({ kind: groups[i].kind, reason: groups[i].reason, count: groups[i].count });
  }
  return out;
}

/**
 * @param {object} report - SuiteReport
 * @param {string} [version]
 * @returns {object}
 */
export function suiteReportToJson(report, version) {
  const checks = [];
  for (let i = 0; i < report.checks.length; i++) {
    const c = report.checks[i];
    checks.push({
      name: c.name,
      exitCode: c.exitCode,
      clean: c.clean,
      leaks: c.leaks.map(slimEvent),
      findings: c.findings.map(slimEvent),
      warnings: c.warnings.map(slimEvent),
      settle: slimSettle(c.settle),
    });
  }
  return {
    tool: 'leakforge',
    version: version || null,
    mode: 'suite',
    suite: report.suite,
    exitCode: report.exitCode,
    clean: report.clean,
    checks: checks,
    summary: slimSummary(report.summary),
  };
}

/**
 * @param {object} report - SpecimenReport
 * @param {string} [version]
 * @returns {object}
 */
export function specimenReportToJson(report, version) {
  const results = [];
  for (let i = 0; i < report.results.length; i++) {
    const r = report.results[i];
    if (r.error !== undefined) {
      results.push({ specimen: r.specimen, pass: false, error: r.error });
      continue;
    }
    results.push({
      specimen: r.specimen,
      pass: r.pass,
      warnings: r.warnings.actual.map(slimEvent),
      findings: r.findings.actual.map(slimEvent),
      leaks: r.leaks.actual.map(slimEvent),
      missing: {
        leaks: r.leaks.missing.map(slimEvent),
        warnings: r.warnings.missing.map(slimEvent),
        findings: r.findings.missing.map(slimEvent),
      },
    });
  }
  return {
    tool: 'leakforge',
    version: version || null,
    mode: 'specimens',
    exitCode: report.exitCode,
    clean: report.clean,
    passed: report.results.length - report.failed - report.errored,
    failed: report.failed,
    errored: report.errored,
    results: results,
    summary: slimSummary(report.summary),
  };
}
