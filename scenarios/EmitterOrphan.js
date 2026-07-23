/**
 * @zakkster/lite-leakforge -- scenarios/EmitterOrphan.js
 *
 * Specimen: a Node EventEmitter listener added outside any owner.
 *
 * Acceptance test for lite-leak's emitter-orphan kernel (shipped in lite-leak
 * 1.7.0). Unlike the browser kernels, emitter-orphan defaults `warnOnNoOwner`
 * to false, so this specimen opts in to exercise the pre-FR warning channel:
 *   - onWarning at add with reason 'no-owner-add'
 *
 * There is no audit finding for an ownerless add -- a finding
 * (`owner-disposed-listener-live`) requires an owner that was disposed while the
 * listener stayed attached, which is the broken-cleanup safety net rather than
 * something a module-scope specimen can stage. So expectedFindings is empty and
 * this specimen validates the warning channel only.
 *
 * The EventEmitter is specimen-local (a subclass), so patching its prototype
 * never touches the EventEmitter the runtime and the CLI itself depend on.
 *
 * needsSettle is false: pre-FR channel only.
 *
 * Copyright (c) 2026 Zahary Shinikchiev <shinikchiev@yahoo.com>
 * MIT License
 */

import { EventEmitter } from 'node:events';
import { createEmitterOrphanKernel } from '@zakkster/lite-leak';

const SPECIMEN_NAME = 'emitter-orphan';

/**
 * Create an emitter-orphan specimen.
 * @returns {Specimen}
 */
export function createEmitterOrphanSpecimen() {
  // Subclass so the kernel patches this prototype, not the global EventEmitter.
  class Bus extends EventEmitter {}
  let bus = null;
  const listener = function onData() {};

  return {
    name: SPECIMEN_NAME,

    kernels: function () {
      return [createEmitterOrphanKernel({ EventEmitter: Bus, warnOnNoOwner: true })];
    },

    expectedLeaks: [],
    expectedWarnings: [
      { kind: 'emitter-orphan', reason: 'no-owner-add' },
    ],
    expectedFindings: [],

    needsSettle: false,

    inject: function (_tracker) {
      // Added at module scope: nothing owns the listener, so nothing removes it.
      // With warnOnNoOwner:true the kernel warns at the add.
      bus = new Bus();
      bus.on('data', listener);
    },

    release: function () {
      // Remove so the specimen leaves no attached listener behind.
      if (bus !== null) {
        bus.removeListener('data', listener);
        bus = null;
      }
    },
  };
}
