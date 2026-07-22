/**
 * @zakkster/lite-leakforge -- scenarios/SocketOrphan.js
 *
 * Specimen: a WebSocket opened outside any owner and never closed.
 *
 * Acceptance test for lite-leak's socket-orphan kernel (shipped in lite-leak
 * 1.2.0). It exercises the two pre-FR channels:
 *   1. onWarning at construction with reason 'no-owner-open'
 *   2. audit() finding with reason 'no-owner-socket-open'
 *
 * The host is specimen-local: a mock socket carrying the DOM `readyState`
 * constants, so the kernel's "a connection the peer already closed is not a
 * leak" rule is exercised by real state rather than bookkeeping. The specimen
 * leaves the socket OPEN, which is the reportable case.
 *
 * needsSettle is false: pre-FR channels only.
 *
 * Copyright (c) 2026 Zahary Shinikchiev <shinikchiev@yahoo.com>
 * MIT License
 */

import { createSocketOrphanKernel } from '@zakkster/lite-leak';

const SPECIMEN_NAME = 'socket-orphan';

/**
 * Minimal deterministic socket host. No network is touched; only readyState
 * transitions matter to the kernel.
 * @private
 */
function createSocketHost() {
  class MockSocket {
    constructor(url) { this.url = url; this.readyState = 1; }   // OPEN
    close() { this.readyState = 3; }                            // CLOSED
  }
  return {
    WebSocket: class WebSocket extends MockSocket {},
    EventSource: class EventSource extends MockSocket {},
  };
}

/**
 * Create a socket-orphan specimen.
 * @returns {Specimen}
 */
export function createSocketOrphanSpecimen() {
  const host = createSocketHost();
  let socket = null;

  return {
    name: SPECIMEN_NAME,

    kernels: function () {
      return [createSocketOrphanKernel({ target: host, warnOnNoOwner: true })];
    },

    expectedLeaks: [],
    expectedWarnings: [
      { kind: 'socket-orphan', reason: 'no-owner-open' },
    ],
    expectedFindings: [
      { kind: 'socket-orphan', reason: 'no-owner-socket-open' },
    ],

    needsSettle: false,

    inject: function (_tracker) {
      // Open at module scope: nothing owns the connection, so nothing will
      // close it. The kernel warns at construction; audit() then finds it OPEN.
      socket = new host.WebSocket('wss://leakforge.invalid/specimen');
    },

    release: function () {
      // audit() has already run. Close so the specimen leaves no open socket.
      if (socket !== null) {
        socket.close();
        socket = null;
      }
    },
  };
}
