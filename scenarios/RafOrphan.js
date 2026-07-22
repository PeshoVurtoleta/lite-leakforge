/**
 * @zakkster/lite-leakforge -- scenarios/RafOrphan.js
 *
 * Specimen: a requestAnimationFrame loop started outside any owner.
 *
 * This specimen is the acceptance test for lite-leak's raf-orphan kernel
 * (shipped in lite-leak 1.1.0). It exercises the two pre-FR channels:
 *   1. onWarning at schedule-time with reason 'no-owner-set'
 *   2. audit() finding with reason 'no-owner-loop-armed'
 *
 * Node has no global requestAnimationFrame, and -- more importantly -- a
 * specimen must never patch a global it shares with the test runner. So the
 * specimen owns a tiny deterministic rAF host and installs the kernel against
 * it (createRafOrphanKernel patches the methods on the target object in
 * place). inject() schedules ONE frame with no owner: the kernel captures the
 * missing owner at set-time (warning) and, because the frame is still armed
 * when verify() runs audit(), surfaces the loop (finding). The frame is never
 * fired, so the loop never reschedules -- exactly one event per channel, the
 * clean orphan signature. release() cancels the armed frame.
 *
 * needsSettle is false: this specimen tests the pre-FR channels only, mirroring
 * the timer-orphan and async-retention specimens.
 *
 * Copyright (c) 2026 Zahary Shinikchiev <shinikchiev@yahoo.com>
 * MIT License
 */

import { createRafOrphanKernel } from '@zakkster/lite-leak';

const SPECIMEN_NAME = 'raf-orphan';

/**
 * A minimal, deterministic requestAnimationFrame host. Frames are queued but
 * never fired by the specimen -- the point is a loop left armed with no owner,
 * not a running animation. Kept specimen-local so the kernel patches this
 * object rather than any global.
 * @private
 */
function createRafHost() {
  let seq = 0;
  const pending = new Map();
  return {
    requestAnimationFrame: function (cb) {
      const id = ++seq;
      pending.set(id, cb);
      return id;
    },
    cancelAnimationFrame: function (id) {
      pending.delete(id);
    },
    _pendingCount: function () { return pending.size; },
  };
}

/**
 * Create a raf-orphan specimen.
 * @returns {Specimen}
 */
export function createRafOrphanSpecimen() {
  const host = createRafHost();
  let armedId = 0;

  return {
    name: SPECIMEN_NAME,

    kernels: function () {
      return [createRafOrphanKernel({ target: host, warnOnNoOwner: true })];
    },

    expectedLeaks: [],
    expectedWarnings: [
      { kind: 'raf-orphan', reason: 'no-owner-set' },
    ],
    expectedFindings: [
      { kind: 'raf-orphan', reason: 'no-owner-loop-armed' },
    ],

    // Pre-FR channels only -- no FR settlement needed.
    needsSettle: false,

    inject: function (_tracker) {
      // Begin a loop at module scope: no owner to hold it. The kernel warns
      // 'no-owner-set' at schedule time. The self-reschedule inside loop() is
      // never reached (the frame is not fired), so no continuation is created.
      armedId = host.requestAnimationFrame(function loop() {
        armedId = host.requestAnimationFrame(loop);
      });
    },

    release: function () {
      // audit() has already run (verify audits before release), so the kernel
      // has seen the armed, ownerless loop. Cancel the frame to leave no
      // pending callback behind.
      if (armedId !== 0) {
        host.cancelAnimationFrame(armedId);
        armedId = 0;
      }
    },
  };
}
