/**
 * @zakkster/lite-leakforge -- test/dom.test.js
 *
 * Smoke tests for DashboardDOM against a minimal document shim.
 * Covers the sliding-window log (newest entries win), dirty-flag
 * throttled rendering, row selection -> inspector, and dispose.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

// -----------------------------------------------------------------
// Minimal DOM shim
// -----------------------------------------------------------------

const allElements = [];

class ShimClassList {
  constructor(el) { this._el = el; }
  add(c) {
    const parts = this._el.className.length > 0 ? this._el.className.split(' ') : [];
    if (parts.indexOf(c) === -1) { parts.push(c); this._el.className = parts.join(' '); }
  }
  remove(c) {
    const parts = this._el.className.length > 0 ? this._el.className.split(' ') : [];
    const i = parts.indexOf(c);
    if (i !== -1) { parts.splice(i, 1); this._el.className = parts.join(' '); }
  }
  contains(c) {
    return this._el.className.split(' ').indexOf(c) !== -1;
  }
}

class ShimElement {
  constructor(tag) {
    this.tagName = tag;
    this.id = '';
    this.className = '';
    this.textContent = '';
    this.style = { display: '' };
    this.children = [];
    this.parentNode = null;
    this.scrollTop = 0;
    this._listeners = Object.create(null);
    this.classList = new ShimClassList(this);
    allElements.push(this);
  }
  get firstChild() { return this.children.length > 0 ? this.children[0] : null; }
  get scrollHeight() { return this.children.length * 10; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  removeChild(c) {
    const i = this.children.indexOf(c);
    if (i !== -1) this.children.splice(i, 1);
    c.parentNode = null;
    return c;
  }
  addEventListener(type, fn) {
    (this._listeners[type] || (this._listeners[type] = [])).push(fn);
  }
  click() {
    const fns = this._listeners.click || [];
    for (let i = 0; i < fns.length; i++) fns[i].call(this);
  }
}

const shimDocument = {
  head: new ShimElement('head'),
  createElement(tag) { return new ShimElement(tag); },
  getElementById(id) {
    for (let i = 0; i < allElements.length; i++) {
      if (allElements[i].id === id) return allElements[i];
    }
    return null;
  },
};

let rafQueue = [];
function shimRaf(fn) { rafQueue.push(fn); return rafQueue.length; }
function pumpFrames(n) {
  for (let f = 0; f < n; f++) {
    const q = rafQueue;
    rafQueue = [];
    for (let i = 0; i < q.length; i++) q[i]();
  }
}

let savedDocument;
let savedRaf;

before(() => {
  savedDocument = globalThis.document;
  savedRaf = globalThis.requestAnimationFrame;
  globalThis.document = shimDocument;
  globalThis.requestAnimationFrame = shimRaf;
});

after(() => {
  globalThis.document = savedDocument;
  globalThis.requestAnimationFrame = savedRaf;
  rafQueue = [];
});

// Import AFTER shim types are defined (module body has no document
// access at import time, but keep the intent obvious).
const { createDashboardModel } = await import('../panels/DashboardModel.js');
const { createDashboard } = await import('../panels/DashboardDOM.js');

function mount(maxLogRows) {
  const container = new ShimElement('div');
  const model = createDashboardModel({ logCapacity: 32 });
  const dash = createDashboard({
    container: container,
    model: model,
    kernels: [],
    maxLogRows: maxLogRows,
  });
  return { container, model, dash };
}

// -----------------------------------------------------------------
// Tests
// -----------------------------------------------------------------

describe('DashboardDOM sliding window', () => {
  it('shows the NEWEST maxLogRows entries when count exceeds the pool', () => {
    const { model, dash } = mount(4);
    for (let i = 0; i < 6; i++) model.onLeak({ kind: 'k' + i });
    dash.flush();
    assert.equal(dash._visibleRows(), 4);
    assert.equal(dash._windowStart(), 2);
    assert.equal(dash._rowText(0), 'L k2');
    assert.equal(dash._rowText(3), 'L k5');
    dash.dispose();
  });

  it('fills partially when entries fit the pool', () => {
    const { model, dash } = mount(4);
    model.onWarning({ kind: 'w', reason: 'no-owner-set' });
    dash.flush();
    assert.equal(dash._visibleRows(), 1);
    assert.equal(dash._windowStart(), 0);
    assert.equal(dash._rowText(0), 'W w (no-owner-set)');
    dash.dispose();
  });

  it('re-windows over filtered entries', () => {
    const { model, dash } = mount(2);
    model.onLeak({ kind: 'a' });
    model.onLeak({ kind: 'b' });
    model.onLeak({ kind: 'a' });
    model.filterKind.set('a');
    dash.flush();
    assert.equal(dash._visibleRows(), 2);
    assert.equal(dash._rowText(0), 'L a');
    assert.equal(dash._rowText(1), 'L a');
    dash.dispose();
  });
});

describe('DashboardDOM throttled rendering', () => {
  it('renders via the rAF loop after events without an explicit flush', () => {
    const { model, dash } = mount(4);
    model.onLeak({ kind: 'x' });
    // Mask is 7 -- within 8 pumped frames the gated render must fire.
    pumpFrames(8);
    assert.equal(dash._visibleRows(), 1);
    assert.equal(dash._rowText(dash._visibleRows() - 1), 'L x');
    dash.dispose();
  });
});

describe('DashboardDOM selection', () => {
  it('clicking a pooled row inspects the windowed entry', () => {
    const { container, model, dash } = mount(2);
    model.onLeak({
      kind: 'owner-cascade-orphan',
      ownerPath: [{ id: 3, kind: 'effect' }],
    });
    model.onLeak({ kind: 'unknown' });
    dash.flush();
    const root = container.children[0];
    const logEl = root.children[2].children[2]; // section > title,filters,log
    logEl.children[0].click();
    const inspectorEl = root.children[3].children[1];
    assert.ok(inspectorEl.textContent.indexOf('kind: owner-cascade-orphan') !== -1);
    assert.ok(inspectorEl.textContent.indexOf('[3 effect]') !== -1);
    dash.dispose();
  });
});

describe('DashboardDOM dispose', () => {
  it('unmounts, stops the tick, and disposes the log effect', () => {
    const { container, model, dash } = mount(4);
    dash.dispose();
    assert.equal(container.children.length, 0);
    // Further events + frames must not render or throw.
    model.onLeak({ kind: 'after-dispose' });
    pumpFrames(16);
    assert.equal(dash._visibleRows(), 0);
  });
});
