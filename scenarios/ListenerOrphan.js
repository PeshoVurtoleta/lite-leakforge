/**
 * @zakkster/lite-leakforge -- scenarios/ListenerOrphan.js
 *
 * Specimen: addEventListener called outside any owner.
 *
 * The listener-orphan kernel patches EventTarget.prototype and emits
 * onWarning with reason 'no-owner-set' when addEventListener is called
 * outside any effect/computed body.
 *
 * Detection channel: warnings (real-time).
 * The kernel has no audit path (returns [] from audit()).
 *
 * Copyright (c) 2026 Zahary Shinikchiev <shinikchiev@yahoo.com>
 * MIT License
 */

import { createListenerOrphanKernel } from '@zakkster/lite-leak';

const SPECIMEN_NAME = 'listener-orphan';

/**
 * Create a listener-orphan specimen.
 * @returns {Specimen}
 */
export function createListenerOrphanSpecimen() {
  let target = null;
  let listener = null;

  return {
    name: SPECIMEN_NAME,

    kernels: function () {
      return [createListenerOrphanKernel({ warnOnNoOwner: true })];
    },

    expectedLeaks: [],
    expectedWarnings: [
      { kind: 'listener-orphan', reason: 'no-owner-set' },
    ],
    expectedFindings: [],

    needsSettle: false,

    inject: function (_tracker) {
      // Create an EventTarget and add a listener outside any owner.
      target = new EventTarget();
      listener = function orphanedHandler() {};
      target.addEventListener('click', listener);
    },

    release: function () {
      // Clean up so we don't leak test resources.
      if (target !== null && listener !== null) {
        target.removeEventListener('click', listener);
      }
      target = null;
      listener = null;
    },
  };
}
