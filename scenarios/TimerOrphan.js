/**
 * @zakkster/lite-leakforge -- scenarios/TimerOrphan.js
 *
 * Specimen: setTimeout set outside any owner.
 *
 * The timer-orphan kernel emits:
 *   1. onWarning at set-time with reason 'no-owner-set'
 *   2. audit() finding with reason 'no-owner-pending'
 *
 * This specimen tests the two pre-FR detection channels. The timer
 * is cleared during release(), so no FR-path leak report is expected.
 * The value is in early detection: the warning fires immediately when
 * the dangerous pattern occurs, the finding catches it on-demand.
 *
 * Copyright (c) 2026 Zahary Shinikchiev <shinikchiev@yahoo.com>
 * MIT License
 */

import { createTimerOrphanKernel } from '@zakkster/lite-leak';

const SPECIMEN_NAME = 'timer-orphan';

/**
 * Create a timer-orphan specimen.
 * @returns {Specimen}
 */
export function createTimerOrphanSpecimen() {
  let timerId = null;

  return {
    name: SPECIMEN_NAME,

    kernels: function () {
      return [createTimerOrphanKernel({ warnOnNoOwner: true })];
    },

    expectedLeaks: [],
    expectedWarnings: [
      { kind: 'timer-orphan', reason: 'no-owner-set' },
    ],
    expectedFindings: [
      { kind: 'timer-orphan', reason: 'no-owner-pending' },
    ],

    // No FR settlement needed -- this specimen tests pre-FR channels.
    needsSettle: false,

    inject: function (_tracker) {
      // Set a timer outside any owner. The kernel patches
      // globalThis.setTimeout and detects no owner context.
      timerId = setTimeout(function orphanedCallback() {
        // Never fires during the test.
      }, 999999);
    },

    release: function () {
      // Clear the timer. audit() has already run (verify calls audit
      // before release), so the kernel has seen the pending timer.
      // Clearing prevents the 999999ms timer from blocking Node exit.
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
    },
  };
}
