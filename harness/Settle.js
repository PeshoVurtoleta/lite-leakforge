/**
 * @zakkster/lite-leakforge -- harness/Settle.js
 *
 * Bounded-retry settlement loop for FinalizationRegistry callbacks.
 * FR timing is non-deterministic; this module does its best to flush
 * pending callbacks by alternating GC pressure, explicit gc(), and
 * event-loop ticks. Requires --expose-gc.
 *
 * Design constraints:
 *   - The caller MUST ensure targets are truly unreachable before
 *     calling settleFinalizers(). If a reference survives, FR will
 *     correctly never fire -- that is not "inconclusive," it is a
 *     real leak (or a test bug).
 *   - settleFinalizers() returns a SettleResult, not an exit code.
 *     The verify() contract in scenarios/ maps results to exit codes.
 *   - Allocation pressure is the only reliable technique to encourage
 *     FR draining on V8. gc() alone does not guarantee FR dispatch;
 *     the event-loop tick (setImmediate) is mandatory for callback
 *     delivery.
 *
 * Copyright (c) 2026 Zahary Shinikchiev <shinikchiev@yahoo.com>
 * MIT License
 */

/**
 * Settle outstanding FinalizationRegistry callbacks by applying
 * GC pressure in a bounded retry loop.
 *
 * @param {object} options
 * @param {() => number} options.check
 *   Called after each round. Returns the number of outstanding
 *   items still pending. Settlement succeeds when check() returns 0
 *   (or <= options.target if provided).
 * @param {number} [options.target=0]
 *   Target value for check(). Settlement succeeds when
 *   check() <= target.
 * @param {number} [options.maxRounds=10]
 *   Maximum number of gc + tick rounds before giving up.
 * @param {number} [options.pressureKB=1024]
 *   Kilobytes of allocation pressure per round.
 * @returns {Promise<SettleResult>}
 *
 * @typedef {object} SettleResult
 * @property {boolean} settled - true if check() reached target.
 * @property {number} rounds - number of rounds executed.
 * @property {number} remaining - final check() value.
 */
/**
 * Coerce a user-supplied count to a safe non-negative integer. Rejects
 * NaN/Infinity/negative/fractional inputs by falling back to `dflt` rather than
 * letting them reach `new Array(n)` (RangeError) or silently degrade the loop
 * to zero rounds. `maxRounds: NaN` used to run zero rounds and report
 * settled:false with no indication an option was misspelled -- the costliest
 * failure here to diagnose.
 * @private
 */
function safeCount(value, dflt, max) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return dflt;
  const n = Math.floor(value);
  if (n < 0) return 0;
  return n > max ? max : n;
}

// 256 MB of pressure per round is already past the point of diminishing
// returns; beyond it the round costs more than the GC it is trying to provoke.
const MAX_PRESSURE_KB = 262144;
const MAX_ROUNDS = 1000;

export async function settleFinalizers(options) {
  if (typeof globalThis.gc !== 'function') {
    throw new Error(
      'settleFinalizers requires --expose-gc. ' +
      'Run with: node --expose-gc'
    );
  }
  const check = options.check;
  if (typeof check !== 'function') {
    throw new TypeError('settleFinalizers: options.check must be a function');
  }
  const target = typeof options.target === 'number' && Number.isFinite(options.target)
    ? options.target : 0;
  const maxRounds = safeCount(options.maxRounds, 10, MAX_ROUNDS);
  const pressureSlots = safeCount(options.pressureKB, 1024, MAX_PRESSURE_KB);

  let rounds = 0;

  while (rounds < maxRounds) {
    // 1. Allocation pressure -- fill V8's new space to trigger
    //    minor GC and FR candidate identification.
    const junk = new Array(pressureSlots);
    for (let i = 0; i < pressureSlots; i++) junk[i] = new ArrayBuffer(1024);

    // 2. Explicit full GC.
    globalThis.gc();

    // 3. Yield to the event loop so FR callbacks can drain.
    //    Double-tick: setImmediate fires after I/O callbacks but before
    //    timers; a second tick ensures any FR callbacks that enqueued
    //    further microtasks have fully resolved.
    await new Promise(function (r) { setImmediate(r); });
    await new Promise(function (r) { setImmediate(r); });

    rounds++;

    const remaining = check();
    // A check() that returns a non-number makes `remaining <= target` a
    // meaningless comparison and puts a string into the report's `remaining`.
    // Fail loudly instead of settling on garbage.
    if (typeof remaining !== 'number' || !Number.isFinite(remaining)) {
      throw new TypeError(
        'settleFinalizers: check() must return a number (finite), got ' +
        (typeof remaining === 'number' ? String(remaining) : typeof remaining)
      );
    }
    if (remaining <= target) {
      return { settled: true, rounds: rounds, remaining: remaining };
    }
  }

  const finalRemaining = check();
  if (typeof finalRemaining !== 'number' || !Number.isFinite(finalRemaining)) {
    throw new TypeError(
      'settleFinalizers: check() must return a number (finite), got ' +
      (typeof finalRemaining === 'number' ? String(finalRemaining) : typeof finalRemaining)
    );
  }
  return { settled: false, rounds: rounds, remaining: finalRemaining };
}

/**
 * Convenience: settle against a lite-leak tracker's size().
 *
 * @param {object} tracker - createLeakTracker() return value
 * @param {object} [options]
 * @param {number} [options.expectedSize=0]
 * @param {number} [options.maxRounds=10]
 * @param {number} [options.pressureKB=1024]
 * @returns {Promise<SettleResult>}
 */
export async function settleTracker(tracker, options) {
  const opts = options || {};
  return settleFinalizers({
    check: function () { return tracker.size(); },
    target: typeof opts.expectedSize === 'number' ? opts.expectedSize : 0,
    maxRounds: opts.maxRounds,
    pressureKB: opts.pressureKB,
  });
}
