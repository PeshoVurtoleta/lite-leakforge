/**
 * @zakkster/lite-leakforge -- scenarios/ObserverOrphan.js
 *
 * Specimen: MutationObserver constructed outside any owner.
 *
 * Node.js has no native MutationObserver. The kernel accepts
 * options.target, so we provide a mock target with a minimal
 * MutationObserver class that the kernel can patch.
 *
 * Detection channels: warning (no-owner-set) + finding (no-owner-pending).
 *
 * Copyright (c) 2026 Zahary Shinikchiev <shinikchiev@yahoo.com>
 * MIT License
 */

import { createObserverOrphanKernel } from '@zakkster/lite-leak';

const SPECIMEN_NAME = 'observer-orphan';

/**
 * Minimal MutationObserver mock. The kernel calls Reflect.construct,
 * so the mock must be a proper constructor. It needs observe(),
 * disconnect(), and nothing else.
 * @private
 */
class MockMutationObserver {
  constructor(cb) {
    this._cb = cb;
    this._disconnected = false;
  }
  observe() {}
  disconnect() { this._disconnected = true; }
}

/**
 * Create an observer-orphan specimen.
 * @returns {Specimen}
 */
export function createObserverOrphanSpecimen() {
  let instance = null;
  // Build the mock target with the kernel's expected constructor.
  const mockTarget = { MutationObserver: MockMutationObserver };

  return {
    name: SPECIMEN_NAME,

    kernels: function () {
      return [createObserverOrphanKernel({
        target: mockTarget,
        warnOnNoOwner: true,
      })];
    },

    expectedLeaks: [],
    expectedWarnings: [
      { kind: 'observer-orphan', reason: 'no-owner-set' },
    ],
    expectedFindings: [
      { kind: 'observer-orphan', reason: 'no-owner-pending' },
    ],

    needsSettle: false,

    inject: function (_tracker) {
      // Construct outside any owner -- kernel patches mockTarget's
      // MutationObserver constructor and detects no owner context.
      instance = new mockTarget.MutationObserver(function () {});
    },

    release: function () {
      // Disconnect so the kernel reaps.
      if (instance !== null) {
        instance.disconnect();
        instance = null;
      }
    },
  };
}
