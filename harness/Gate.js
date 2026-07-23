/**
 * @zakkster/lite-leakforge -- harness/Gate.js
 *
 * CI gate for leak detection. Mirrors @zakkster/lite-perf-gate's
 * exit-code semantics:
 *   0 = clean (no leaks)
 *   1 = confirmed leak
 *   3 = inconclusive (FR did not settle -- recapture)
 *
 * Provides:
 *   - createLeakGate(options) -- factory for reusable gate instances
 *   - leakSuite(name, fn) -- node:test-native wrapper
 *   - assertNoLeaks(fn, options) -- one-shot assertion
 *
 * All three require --expose-gc.
 *
 * Copyright (c) 2026 Zahary Shinikchiev <shinikchiev@yahoo.com>
 * MIT License
 */

import {
  createLeakTracker,
  createTimerOrphanKernel,
  createListenerOrphanKernel,
  createAsyncRetentionKernel,
} from '@zakkster/lite-leak';
import { settleFinalizers } from './Settle.js';

const EXIT_CLEAN = 0;
const EXIT_LEAK = 1;
const EXIT_INCONCLUSIVE = 3;

export { EXIT_CLEAN, EXIT_LEAK, EXIT_INCONCLUSIVE };

/**
 * Create a reusable leak gate.
 *
 * @param {object} [options]
 * @param {string} [options.name='leakforge-gate']
 * @param {boolean} [options.installTimerKernel=true]
 * @param {boolean} [options.installListenerKernel=true]
 * @param {boolean} [options.installAsyncKernel=true]
 * @param {object[]} [options.extraKernels=[]]
 * @param {number} [options.maxRounds=10]
 * @param {number} [options.pressureKB=1024]
 * @param {boolean} [options.captureStacks=true]
 *   Pass-through to createLeakTracker. Stack capture allocates an
 *   Error per track(); disable for allocation-sensitive gate runs.
 * @returns {LeakGate}
 *
 * @typedef {object} LeakGate
 * @property {(fn: () => void) => Promise<GateResult>} run
 * @property {number} EXIT_CLEAN
 * @property {number} EXIT_LEAK
 * @property {number} EXIT_INCONCLUSIVE
 */
export function createLeakGate(options) {
  const opts = options || {};
  const name = opts.name || 'leakforge-gate';
  const maxRounds = typeof opts.maxRounds === 'number' ? opts.maxRounds : 10;
  const pressureKB = typeof opts.pressureKB === 'number' ? opts.pressureKB : 1024;
  const captureStacks = opts.captureStacks !== false;

  /**
   * Run a function under the gate. The function receives the tracker
   * so it can call track()/untrack() if needed. After the function
   * returns, targets created inside it should be eligible for GC.
   *
   * @param {(tracker: object) => void} fn
   * @returns {Promise<GateResult>}
   *
   * @typedef {object} GateResult
   * @property {number} exitCode - 0, 1, or 3
   * @property {boolean} clean
   * @property {object[]} leaks - FR-path reports
   * @property {object[]} warnings
   * @property {object[]} findings
   * @property {object} settleResult
   */
  async function run(fn) {
    if (typeof globalThis.gc !== 'function') {
      throw new Error('leakGate requires --expose-gc');
    }
    const leaks = [];
    const warnings = [];
    const findings = [];

    const tracker = createLeakTracker({
      name: name,
      captureStacks: captureStacks,
      onLeak: function (r) { leaks.push(r); },
      onWarning: function (w) { warnings.push(w); },
      onFinding: function (f) { findings.push(f); },
    });

    // Install default kernels. captureStacks must reach the KERNELS, not only
    // the tracker: `origin` is captured at the moment a resource is created,
    // inside the kernel, so a gate that forwarded it only to the tracker
    // produced findings with origin:null however it was configured -- and
    // clustering by call site silently degraded to clustering by reason.
    const offs = [];
    if (opts.installTimerKernel !== false) {
      offs.push(tracker.registerKernel(createTimerOrphanKernel({ warnOnNoOwner: false, captureStacks: captureStacks })));
    }
    if (opts.installListenerKernel !== false) {
      offs.push(tracker.registerKernel(createListenerOrphanKernel({ warnOnNoOwner: false, captureStacks: captureStacks })));
    }
    if (opts.installAsyncKernel !== false) {
      offs.push(tracker.registerKernel(createAsyncRetentionKernel({ warnOnNoOwner: false })));
    }
    if (Array.isArray(opts.extraKernels)) {
      for (let i = 0; i < opts.extraKernels.length; i++) {
        offs.push(tracker.registerKernel(opts.extraKernels[i]));
      }
    }

    // Run the user's code, audit, and settle under try/finally.
    // Kernels patch GLOBAL surfaces (setTimeout, EventTarget.prototype,
    // AbortController); if fn() throws and teardown is skipped, the
    // patches leak into every subsequent test in the process.
    let settleResult;
    try {
      fn(tracker);

      // Run audit before settle (same ordering as verify contract).
      tracker.audit();

      // Settle.
      settleResult = await settleFinalizers({
        check: function () { return tracker.size(); },
        target: 0,
        maxRounds: maxRounds,
        pressureKB: pressureKB,
      });
    } finally {
      // Tear down kernels unconditionally.
      for (let i = 0; i < offs.length; i++) offs[i]();
    }

    // Determine exit code. Precedence: confirmed evidence first.
    // A leak report or audit finding is a CONFIRMED leak regardless of
    // FR settlement state -- an unsettled FR must not downgrade hard
    // evidence to "recapture". Only an evidence-free unsettled run is
    // inconclusive.
    let exitCode;
    if (leaks.length > 0 || findings.length > 0) {
      exitCode = EXIT_LEAK;
    } else if (!settleResult.settled) {
      exitCode = EXIT_INCONCLUSIVE;
    } else {
      exitCode = EXIT_CLEAN;
    }

    return {
      exitCode: exitCode,
      clean: exitCode === EXIT_CLEAN,
      leaks: leaks,
      warnings: warnings,
      findings: findings,
      settleResult: settleResult,
    };
  }

  return {
    run: run,
    EXIT_CLEAN: EXIT_CLEAN,
    EXIT_LEAK: EXIT_LEAK,
    EXIT_INCONCLUSIVE: EXIT_INCONCLUSIVE,
  };
}

/**
 * One-shot assertion: run fn, assert zero leaks.
 * Throws on confirmed leak. Returns the GateResult.
 *
 * @param {(tracker: object) => void} fn
 * @param {object} [options] - same as createLeakGate options
 * @returns {Promise<GateResult>}
 */
export async function assertNoLeaks(fn, options) {
  const gate = createLeakGate(options);
  const result = await gate.run(fn);
  if (result.exitCode === EXIT_LEAK) {
    const msg = 'assertNoLeaks: confirmed leak. ' +
      result.leaks.length + ' leak(s), ' +
      result.findings.length + ' finding(s).';
    const err = new Error(msg);
    err.gateResult = result;
    throw err;
  }
  if (result.exitCode === EXIT_INCONCLUSIVE) {
    const msg = 'assertNoLeaks: inconclusive. FR did not settle after ' +
      result.settleResult.rounds + ' rounds, ' +
      result.settleResult.remaining + ' remaining.';
    const err = new Error(msg);
    err.code = 'RECAPTURE';
    err.gateResult = result;
    throw err;
  }
  return result;
}

/**
 * node:test-native leak suite. Wraps describe() + it() from node:test.
 *
 * Usage:
 *   import { describe, it } from 'node:test';
 *   import { leakSuite } from '@zakkster/lite-leakforge/harness';
 *
 *   leakSuite(describe, it, 'my-module', (measure) => {
 *     measure('creates and disposes cleanly', (tracker) => {
 *       const target = { x: 1 };
 *       tracker.track(target, () => {}, 'test');
 *       tracker.untrack(...);
 *     });
 *   });
 *
 * @param {Function} describe - from node:test
 * @param {Function} it - from node:test
 * @param {string} name
 * @param {(measure: (name: string, fn: (tracker) => void) => void) => void} fn
 * @param {object} [options] - same as createLeakGate options
 */
export function leakSuite(describe, it, name, fn, options) {
  const gate = createLeakGate(options);

  describe('leakSuite: ' + name, function () {
    function measure(testName, testFn) {
      it(testName, async function () {
        const result = await gate.run(testFn);
        if (result.exitCode === EXIT_LEAK) {
          throw new Error(
            'Leak detected: ' + result.leaks.length + ' leak(s), ' +
            result.findings.length + ' finding(s).'
          );
        }
        if (result.exitCode === EXIT_INCONCLUSIVE) {
          throw new Error(
            'Inconclusive: FR did not settle (' +
            result.settleResult.remaining + ' remaining). Recapture.'
          );
        }
      });
    }

    fn(measure);
  });
}

