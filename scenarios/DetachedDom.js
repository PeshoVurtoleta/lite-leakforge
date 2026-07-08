/**
 * @zakkster/lite-leakforge -- scenarios/DetachedDom.js
 *
 * Specimen: a watched DOM node that becomes detached.
 *
 * Node.js has no document or MutationObserver. The detached-dom kernel
 * checks node.isConnected during audit(), so we provide a mock node
 * whose isConnected property we control. The MutationObserver path
 * (live-removal detection) is not tested here -- that requires a real
 * DOM. This specimen covers the audit-time detection path.
 *
 * Detection channel: findings (audit, reason 'detached-at-audit').
 *
 * Copyright (c) 2026 Zahary Shinikchiev <shinikchiev@yahoo.com>
 * MIT License
 */

import { createDetachedDomKernel } from '@zakkster/lite-leak';

const SPECIMEN_NAME = 'detached-dom';

/**
 * Create a detached-dom specimen.
 * @returns {Specimen}
 */
export function createDetachedDomSpecimen() {
  let kernel = null;
  let mockNode = null;

  return {
    name: SPECIMEN_NAME,

    kernels: function () {
      // Pass root: null so the kernel skips MutationObserver setup
      // (no document available in Node.js).
      kernel = createDetachedDomKernel({ root: null, warnOnDetach: true });
      return [kernel];
    },

    expectedLeaks: [],
    expectedWarnings: [],
    expectedFindings: [
      { kind: 'detached-dom', reason: 'detached-at-audit' },
    ],

    needsSettle: false,

    inject: function (_tracker) {
      // Create a mock node that starts connected, watch it,
      // then detach it. audit() will see isConnected === false.
      mockNode = { isConnected: true, childNodes: [] };
      kernel.watch(mockNode, 'test-node');
      // Simulate detachment -- the node was removed from the DOM
      // but nobody untracked it. This is the leak.
      mockNode.isConnected = false;
    },

    release: function () {
      mockNode = null;
    },
  };
}
