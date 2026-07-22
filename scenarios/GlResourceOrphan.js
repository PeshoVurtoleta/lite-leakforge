/**
 * @zakkster/lite-leakforge -- scenarios/GlResourceOrphan.js
 *
 * Specimen: WebGL resources created outside any owner and never deleted.
 *
 * Acceptance test for lite-leak's gl-resource-orphan kernel (shipped in
 * lite-leak 1.3.0). It exercises the two pre-FR channels:
 *   1. onWarning at create-time with reason 'no-owner-create'
 *   2. audit() finding with reason 'no-owner-resource-live'
 *
 * Node has no WebGL, so the host is specimen-local: a mock context whose
 * factories return distinct objects and whose delete methods record the
 * pairing. That is enough, because the kernel never touches the GPU -- it
 * observes the create/delete lifecycle, which is exactly the thing that leaks.
 *
 * The specimen allocates two different resource kinds (a buffer and a texture)
 * from one injection, because the finding carries `resourceKind` and a kernel
 * that collapsed every GPU object into one bucket would still pass a
 * single-resource specimen.
 *
 * needsSettle is false: pre-FR channels only, like the other resource
 * specimens.
 *
 * Copyright (c) 2026 Zahary Shinikchiev <shinikchiev@yahoo.com>
 * MIT License
 */

import { createGlResourceOrphanKernel } from '@zakkster/lite-leak';

const SPECIMEN_NAME = 'gl-resource-orphan';

/**
 * Minimal deterministic WebGL context. `isContextLost()` stays false so the
 * resources remain reportable -- a lost context is the kernel's documented
 * "already reclaimed, not a leak" case and is covered by its own unit test.
 * @private
 */
function createGlHost() {
  const gl = { isContextLost: function () { return false; } };
  const kinds = ['Buffer', 'Texture', 'Framebuffer', 'Renderbuffer', 'Shader', 'Program'];
  for (let i = 0; i < kinds.length; i++) {
    const kind = kinds[i].toLowerCase();
    gl['create' + kinds[i]] = function () { return { __glKind: kind, deleted: false }; };
    gl['delete' + kinds[i]] = function (resource) {
      if (resource !== null && typeof resource === 'object') resource.deleted = true;
    };
  }
  return gl;
}

/**
 * Create a gl-resource-orphan specimen.
 * @returns {Specimen}
 */
export function createGlResourceOrphanSpecimen() {
  const gl = createGlHost();
  let buffer = null;
  let texture = null;

  return {
    name: SPECIMEN_NAME,

    kernels: function () {
      return [createGlResourceOrphanKernel({
        gl: gl, label: 'specimen', warnOnNoOwner: true,
      })];
    },

    expectedLeaks: [],
    expectedWarnings: [
      { kind: 'gl-resource-orphan', reason: 'no-owner-create' },
      { kind: 'gl-resource-orphan', reason: 'no-owner-create' },
    ],
    expectedFindings: [
      { kind: 'gl-resource-orphan', reason: 'no-owner-resource-live' },
      { kind: 'gl-resource-orphan', reason: 'no-owner-resource-live' },
    ],

    needsSettle: false,

    inject: function (_tracker) {
      // Allocate at module scope: nothing owns these, so nothing will delete
      // them. The kernel warns per resource at create time; audit() then finds
      // both still allocated on a live context.
      buffer = gl.createBuffer();
      texture = gl.createTexture();
    },

    release: function () {
      // audit() has already run (verify audits before release). Delete so the
      // specimen leaves no resource registered behind it.
      if (buffer !== null) { gl.deleteBuffer(buffer); buffer = null; }
      if (texture !== null) { gl.deleteTexture(texture); texture = null; }
    },
  };
}
