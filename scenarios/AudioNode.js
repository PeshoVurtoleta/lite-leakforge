/**
 * @zakkster/lite-leakforge -- scenarios/AudioNode.js
 *
 * Specimen: an AudioNode source connected to the graph outside any owner,
 * started and never stopped, never disconnected.
 *
 * Acceptance test for lite-leak's audio-node kernel (shipped in lite-leak
 * 1.2.0). It exercises the two pre-FR channels:
 *   1. onWarning at connect-time with reason 'no-owner-connect'
 *   2. audit() findings with reasons 'no-owner-node-connected' and
 *      'source-started-not-stopped'
 *
 * Node has no WebAudio, so the host is specimen-local: an AudioNode base with
 * connect/disconnect and a scheduled-source subclass with start/stop. The
 * kernel patches those prototypes in place, never a shared global.
 *
 * The specimen connects *and* starts, because the two halves of an audio leak
 * are separable: a connected-but-silent node wastes graph, a started-and-
 * forgotten source stays audible. Both findings must fire from one injection.
 *
 * needsSettle is false: pre-FR channels only.
 *
 * Copyright (c) 2026 Zahary Shinikchiev <shinikchiev@yahoo.com>
 * MIT License
 */

import { createAudioNodeKernel } from '@zakkster/lite-leak';

const SPECIMEN_NAME = 'audio-node';

/**
 * Minimal deterministic WebAudio host. `disconnect()` with no arguments severs
 * every output, mirroring the spec distinction the kernel relies on.
 * @private
 */
function createAudioHost() {
  class AudioNode {
    constructor() { this.outputs = []; this.playing = false; }
    connect(destination) { this.outputs.push(destination); return destination; }
    disconnect(destination) {
      if (destination === undefined) { this.outputs.length = 0; return; }
      const i = this.outputs.indexOf(destination);
      if (i >= 0) this.outputs.splice(i, 1);
    }
  }
  class AudioScheduledSourceNode extends AudioNode {
    start() { this.playing = true; }
    stop() { this.playing = false; }
  }
  return {
    AudioNode: AudioNode,
    AudioScheduledSourceNode: AudioScheduledSourceNode,
    destination: new AudioNode(),
  };
}

/**
 * Create an audio-node specimen.
 * @returns {Specimen}
 */
export function createAudioNodeSpecimen() {
  const host = createAudioHost();
  let source = null;

  return {
    name: SPECIMEN_NAME,

    kernels: function () {
      return [createAudioNodeKernel({ target: host, warnOnNoOwner: true, trackSources: true })];
    },

    expectedLeaks: [],
    expectedWarnings: [
      { kind: 'audio-node', reason: 'no-owner-connect' },
    ],
    expectedFindings: [
      { kind: 'audio-node', reason: 'no-owner-node-connected' },
      { kind: 'audio-node', reason: 'source-started-not-stopped' },
    ],

    needsSettle: false,

    inject: function (_tracker) {
      // Join the graph at module scope: no owner to disconnect it. The kernel
      // warns at connect-time; audit() then finds it connected and audible.
      source = new host.AudioScheduledSourceNode();
      source.connect(host.destination);
      source.start();
    },

    release: function () {
      // audit() has already run. Stop and fully disconnect so the specimen
      // leaves no node registered.
      if (source !== null) {
        source.stop();
        source.disconnect();
        source = null;
      }
    },
  };
}
