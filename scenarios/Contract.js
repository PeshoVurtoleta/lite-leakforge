/**
 * @zakkster/lite-leakforge -- scenarios/Contract.js
 *
 * Specimen verification contract. Each specimen declares expected
 * events across THREE detection channels:
 *
 *   1. expectedLeaks    -- FR-path reports (target GCd without untrack)
 *   2. expectedWarnings -- real-time warnings (kernel emits at set-time)
 *   3. expectedFindings -- audit() results (pre-FR, on-demand scan)
 *
 * Specimen shape:
 *   {
 *     name:             string,
 *     kernels:          () => kernel[],
 *     expectedLeaks:    ExpectedEvent[],    // default []
 *     expectedWarnings: ExpectedEvent[],    // default []
 *     expectedFindings: ExpectedEvent[],    // default []
 *     inject:           (tracker) => void,
 *     release:          () => void,
 *     needsSettle:      boolean,            // default true
 *   }
 *
 * ExpectedEvent:
 *   { kind: string, reason?: string, tag?: unknown }
 *   -- kind matches the event's kind field.
 *   -- reason, if present, is strict-equality-checked.
 *   -- tag, if present, is deep-equality-checked.
 *
 * verify() returns:
 *   {
 *     pass:       boolean,
 *     specimen:   string,
 *     leaks:      ChannelResult,
 *     warnings:   ChannelResult,
 *     findings:   ChannelResult,
 *     settleResult: SettleResult | null,
 *   }
 *
 * composeScenario() runs N specimens in sequence (each in its own
 * tracker) and returns the aggregate diff.
 *
 * Copyright (c) 2026 Zahary Shinikchiev <shinikchiev@yahoo.com>
 * MIT License
 */

import {
  createLeakTracker,
} from '@zakkster/lite-leak';
import { settleFinalizers } from '../harness/Settle.js';

// -----------------------------------------------------------------
// Diffing helpers
// -----------------------------------------------------------------

/**
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 * @private
 */
function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (let i = 0; i < aKeys.length; i++) {
    const k = aKeys[i];
    if (!deepEqual(a[k], b[k])) return false;
  }
  return true;
}

/**
 * Match actual events against expected declarations.
 * Greedy: each expected matches the first unmatched actual with
 * the same kind (and reason + tag, if declared). Order-independent.
 * @private
 */
function diffEvents(expected, actual) {
  const used = new Uint8Array(actual.length);
  const missing = [];
  for (let i = 0; i < expected.length; i++) {
    const exp = expected[i];
    let matched = false;
    for (let j = 0; j < actual.length; j++) {
      if (used[j]) continue;
      if (actual[j].kind !== exp.kind) continue;
      if (exp.reason !== undefined && actual[j].reason !== exp.reason) continue;
      if (exp.tag !== undefined && !deepEqual(actual[j].tag, exp.tag)) continue;
      used[j] = 1;
      matched = true;
      break;
    }
    if (!matched) missing.push(exp);
  }
  const unexpected = [];
  for (let j = 0; j < actual.length; j++) {
    if (!used[j]) unexpected.push(actual[j]);
  }
  return { missing: missing, unexpected: unexpected };
}

/**
 * Build a channel result from expected + actual.
 * @private
 */
function channelResult(expected, actual) {
  const diff = diffEvents(expected, actual);
  return {
    pass: diff.missing.length === 0 && diff.unexpected.length === 0,
    expected: expected,
    actual: actual,
    missing: diff.missing,
    unexpected: diff.unexpected,
  };
}

// -----------------------------------------------------------------
// Public API
// -----------------------------------------------------------------

/**
 * Run a single specimen against a fresh tracker, settle FR if needed,
 * run audit(), and diff all three channels.
 *
 * @param {object} specimen
 * @param {object} [options]
 * @param {number} [options.maxRounds=10]
 * @param {number} [options.pressureKB=1024]
 * @returns {Promise<VerifyResult>}
 */
export async function verify(specimen, options) {
  const opts = options || {};
  const leakReports = [];
  const warningEvents = [];
  const findingEvents = [];

  const tracker = createLeakTracker({
    name: 'leakforge-verify-' + specimen.name,
    captureStacks: true,
    onLeak: function (r) { leakReports.push(r); },
    onWarning: function (w) { warningEvents.push(w); },
    onFinding: function (f) { findingEvents.push(f); },
  });

  // A needsSettle specimen without --expose-gc cannot exercise its FR
  // channel. Failing loudly here beats the silent alternative: skipping
  // settle would report the expected leak as "missing" -- a bogus
  // detection FAIL that is really an environment error. Matches
  // settleFinalizers' own contract.
  const needsSettle = specimen.needsSettle !== false;
  if (needsSettle && typeof globalThis.gc !== 'function') {
    throw new Error(
      'verify: specimen "' + specimen.name + '" needs FR settlement ' +
      'and requires --expose-gc. Run with: node --expose-gc'
    );
  }

  // Install specimen-declared kernels.
  const kernels = typeof specimen.kernels === 'function'
    ? specimen.kernels()
    : [];
  const offs = [];
  for (let i = 0; i < kernels.length; i++) {
    offs.push(tracker.registerKernel(kernels[i]));
  }

  // Kernels patch GLOBAL surfaces; teardown must survive a throwing
  // inject()/release() or the patches leak into subsequent specimens.
  let settleResult = null;
  try {
    // Inject the leak.
    specimen.inject(tracker);

    // Run audit() FIRST -- audit examines live pending resources (timers,
    // listeners) and must run BEFORE release() removes them. Findings
    // arrive via onFinding callback.
    tracker.audit();

    // Release targets so they become GC-eligible.
    specimen.release();

    // Settle FR callbacks (skipped for warning/finding-only specimens).
    if (needsSettle) {
      settleResult = await settleFinalizers({
        check: function () { return tracker.size(); },
        target: 0,
        maxRounds: typeof opts.maxRounds === 'number' ? opts.maxRounds : 10,
        pressureKB: typeof opts.pressureKB === 'number' ? opts.pressureKB : 1024,
      });
    }
  } finally {
    // Tear down kernels unconditionally.
    for (let i = 0; i < offs.length; i++) offs[i]();
  }

  // Diff all three channels.
  const expLeaks = specimen.expectedLeaks || [];
  const expWarnings = specimen.expectedWarnings || [];
  const expFindings = specimen.expectedFindings || [];

  const leaks = channelResult(expLeaks, leakReports);
  const warnings = channelResult(expWarnings, warningEvents);
  const findings = channelResult(expFindings, findingEvents);

  return {
    pass: leaks.pass && warnings.pass && findings.pass,
    specimen: specimen.name,
    leaks: leaks,
    warnings: warnings,
    findings: findings,
    settleResult: settleResult,
  };
}

/**
 * Run N specimens (each in its own tracker) and return the aggregate.
 *
 * @param {object[]} specimens
 * @param {object} [options]
 * @returns {Promise<ComposeResult>}
 *
 * @typedef {object} ComposeResult
 * @property {boolean} pass - true if all specimens passed
 * @property {VerifyResult[]} results
 * @property {number} passed
 * @property {number} failed
 */
export async function composeScenario(specimens, options) {
  const results = [];
  let passed = 0;
  let failed = 0;
  for (let i = 0; i < specimens.length; i++) {
    const r = await verify(specimens[i], options);
    results.push(r);
    if (r.pass) passed++;
    else failed++;
  }
  return {
    pass: failed === 0,
    results: results,
    passed: passed,
    failed: failed,
  };
}
