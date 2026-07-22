/**
 * @zakkster/lite-leakforge -- scenarios/WorkerOrphan.js
 *
 * Specimen: a Worker constructed outside any owner, never terminated, from a
 * blob: URL that is never revoked.
 *
 * Acceptance test for lite-leak's worker-orphan kernel (shipped in lite-leak
 * 1.2.0). It exercises the two pre-FR channels:
 *   1. onWarning at construction with reason 'no-owner-set'
 *   2. audit() findings with reasons 'no-owner-worker-live' and
 *      'blob-url-unrevoked'
 *
 * Node has no DOM Worker, and a specimen must never patch a global it shares
 * with the test runner, so the host is specimen-local: a mock Worker recording
 * termination, plus a local object-URL registry. The kernel patches this object
 * in place.
 *
 * The blob URL is deliberately left un-revoked. Note the inverse case is the
 * one @zakkster/lite-worker actually implements -- it revokes on the line after
 * construction, which is correct because the worker script is fetched during
 * construction -- so this specimen pins the *failure* of a pattern the
 * ecosystem already gets right.
 *
 * needsSettle is false: pre-FR channels only, mirroring the other resource
 * specimens.
 *
 * Copyright (c) 2026 Zahary Shinikchiev <shinikchiev@yahoo.com>
 * MIT License
 */

import { createWorkerOrphanKernel } from '@zakkster/lite-leak';

const SPECIMEN_NAME = 'worker-orphan';

/**
 * Minimal deterministic Worker host. No thread is ever started; the specimen
 * only needs construction and termination to be observable.
 * @private
 */
function createWorkerHost() {
  let seq = 0;
  const host = {
    Worker: class MockWorker {
      constructor(url) { this.url = url; this.alive = true; }
      terminate() { this.alive = false; }
    },
    URL: {
      createObjectURL: function () { return 'blob:leakforge/' + (++seq); },
      revokeObjectURL: function () {},
    },
  };
  return host;
}

/**
 * Create a worker-orphan specimen.
 * @returns {Specimen}
 */
export function createWorkerOrphanSpecimen() {
  const host = createWorkerHost();
  let worker = null;

  return {
    name: SPECIMEN_NAME,

    kernels: function () {
      return [createWorkerOrphanKernel({ target: host, warnOnNoOwner: true })];
    },

    expectedLeaks: [],
    expectedWarnings: [
      { kind: 'worker-orphan', reason: 'no-owner-set' },
    ],
    expectedFindings: [
      { kind: 'worker-orphan', reason: 'no-owner-worker-live' },
      { kind: 'worker-orphan', reason: 'blob-url-unrevoked' },
    ],

    needsSettle: false,

    inject: function (_tracker) {
      // Mint an object URL, spawn from it at module scope, revoke nothing.
      // No owner is active, so the kernel warns at construction and audit()
      // then finds the worker still live with its URL still held.
      const url = host.URL.createObjectURL({});
      worker = new host.Worker(url);
    },

    release: function () {
      // audit() has already run (verify audits before release). Terminate so
      // no mock worker is left registered behind the specimen.
      if (worker !== null) {
        worker.terminate();
        worker = null;
      }
    },
  };
}
