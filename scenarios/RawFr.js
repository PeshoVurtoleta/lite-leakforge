/**
 * @zakkster/lite-leakforge -- scenarios/RawFr.js
 *
 * Specimen: raw FinalizationRegistry leak, no kernel classification.
 *
 * Demonstrates the base lite-leak detection path: a target is tracked
 * manually (outside any owner), then made unreachable without untrack.
 * FR fires, onLeak reports kind 'unknown' (no kernel refines it).
 *
 * This is the most fundamental leak path -- everything else builds on it.
 *
 * Copyright (c) 2026 Zahary Shinikchiev <shinikchiev@yahoo.com>
 * MIT License
 */

const SPECIMEN_NAME = 'raw-fr';

/**
 * Create a raw-FR specimen.
 * @returns {Specimen}
 */
export function createRawFrSpecimen() {
  // The leaked target. Held here so release() can null it.
  // This closure IS the leak: the target is reachable only through
  // this variable. When release() nulls it, the target becomes
  // unreachable and FR fires.
  let target = null;

  return {
    name: SPECIMEN_NAME,

    // No kernels -- testing the raw tracker path.
    kernels: function () { return []; },

    expectedLeaks: [
      { kind: 'unknown' },
    ],
    expectedWarnings: [],
    expectedFindings: [],

    inject: function (tracker) {
      // Create a fresh object as the FR target.
      // Tracked outside any owner, so no auto-untrack.
      target = { resource: 'raw-fr-payload' };
      tracker.track(target, function () {
        // Cleanup runs on FR path. Does NOT close over target
        // (that would prevent GC -- the held-value contract).
      }, SPECIMEN_NAME);
    },

    release: function () {
      // Make the target unreachable. FR should fire.
      target = null;
    },
  };
}
