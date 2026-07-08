/**
 * @zakkster/lite-leakforge -- scenarios/AsyncRetention.js
 *
 * Specimen: AbortController constructed outside any owner.
 *
 * The async-retention kernel patches the AbortController constructor
 * and emits onWarning at construction time when outside any owner.
 * audit() surfaces it as a pending controller with no owner.
 *
 * Detection channels: warning (no-owner-set) + finding (no-owner-pending).
 *
 * Copyright (c) 2026 Zahary Shinikchiev <shinikchiev@yahoo.com>
 * MIT License
 */

import { createAsyncRetentionKernel } from '@zakkster/lite-leak';

const SPECIMEN_NAME = 'async-retention';

/**
 * Create an async-retention specimen.
 * @returns {Specimen}
 */
export function createAsyncRetentionSpecimen() {
  let controller = null;

  return {
    name: SPECIMEN_NAME,

    kernels: function () {
      return [createAsyncRetentionKernel({ warnOnNoOwner: true })];
    },

    expectedLeaks: [],
    expectedWarnings: [
      { kind: 'async-retention', reason: 'no-owner-set' },
    ],
    expectedFindings: [
      { kind: 'async-retention', reason: 'no-owner-pending' },
    ],

    needsSettle: false,

    inject: function (_tracker) {
      // Construct outside any owner. The kernel patches the global
      // AbortController and detects no owner context.
      controller = new AbortController();
    },

    release: function () {
      // Abort so the kernel reaps.
      if (controller !== null) {
        controller.abort();
        controller = null;
      }
    },
  };
}
