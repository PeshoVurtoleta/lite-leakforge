/**
 * @zakkster/lite-leakforge -- panels/DashboardDOM.js
 *
 * Browser-only DOM rendering for the leak dashboard. Consumes a
 * DashboardModel and mounts a live panel with:
 *
 *   1. Counter bar (leaks, warnings, findings, errors)
 *   2. Kernel registry panel
 *   3. Rolling log with kind-filter buttons and pre-allocated row pool
 *   4. Owner-path inspector (click a log row to inspect)
 *
 * All hot-path DOM updates use textContent only (no innerHTML).
 * Model changes mark the panel dirty; the actual render runs inside a
 * single rAF loop gated by a power-of-2 frame mask (~7.5Hz at 60fps),
 * so event storms cost one boolean write per event, not one render.
 * The log shows the NEWEST maxLogRows entries (sliding window).
 *
 * Copyright (c) 2026 Zahary Shinikchiev <shinikchiev@yahoo.com>
 * MIT License
 */

import { effect } from '@zakkster/lite-signal';

const THROTTLE_MASK = 7; // render every 8th rAF ~ 7.5Hz at 60fps

/**
 * Create and mount the dashboard DOM.
 *
 * @param {object} options
 * @param {HTMLElement} options.container - mount target
 * @param {import('./DashboardModel.js').DashboardModel} options.model
 * @param {object} [options.sink] - createProfilerSignalSink() return
 * @param {object[]} [options.kernels] - kernel objects for registry panel
 * @param {number} [options.maxLogRows=60] - pre-allocated row pool size
 * @param {string} [options.className='lf-dashboard'] - root class
 * @returns {DashboardDOM}
 */
export function createDashboard(options) {
  const container = options.container;
  const model = options.model;
  const sink = options.sink || null;
  const kernels = options.kernels || [];
  const maxLogRows = typeof options.maxLogRows === 'number' ? options.maxLogRows : 60;
  const rootClass = options.className || 'lf-dashboard';

  // -----------------------------------------------------------------
  // Style injection (once per document PER root class -- a second
  // dashboard with a different className gets its own style block)
  // -----------------------------------------------------------------

  const styleId = 'lf-dash-style-' + rootClass;
  if (typeof document !== 'undefined' && document.getElementById(styleId) === null) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = [
      '.' + rootClass + ' { font: 12px/1.5 ui-monospace, "SF Mono", Menlo, monospace; color: inherit; }',
      '.' + rootClass + ' .lf-counters { display: flex; gap: 12px; padding: 6px 0; }',
      '.' + rootClass + ' .lf-ctr { display: flex; flex-direction: column; align-items: center; min-width: 48px; }',
      '.' + rootClass + ' .lf-ctr-val { font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; }',
      '.' + rootClass + ' .lf-ctr-lbl { font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.5; }',
      '.' + rootClass + ' .lf-section { margin-top: 8px; }',
      '.' + rootClass + ' .lf-section-title { font-size: 9px; text-transform: uppercase; letter-spacing: 0.1em; opacity: 0.4; margin-bottom: 4px; }',
      '.' + rootClass + ' .lf-filters { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 4px; }',
      '.' + rootClass + ' .lf-filter-btn { background: none; border: 1px solid currentColor; color: inherit; font: inherit; font-size: 10px; padding: 1px 6px; border-radius: 2px; cursor: pointer; opacity: 0.4; }',
      '.' + rootClass + ' .lf-filter-btn.active { opacity: 1; }',
      '.' + rootClass + ' .lf-log { max-height: 200px; overflow-y: auto; }',
      '.' + rootClass + ' .lf-row { padding: 1px 0; cursor: pointer; white-space: pre-wrap; word-break: break-all; }',
      '.' + rootClass + ' .lf-row.selected { outline: 1px solid currentColor; outline-offset: -1px; }',
      '.' + rootClass + ' .lf-kernels { display: flex; flex-direction: column; gap: 4px; }',
      '.' + rootClass + ' .lf-kernel { border: 1px solid; border-radius: 2px; padding: 4px 6px; font-size: 11px; opacity: 0.6; }',
      '.' + rootClass + ' .lf-kernel .kn { font-weight: 600; }',
      '.' + rootClass + ' .lf-kernel .kd { font-size: 10px; opacity: 0.6; }',
      '.' + rootClass + ' .lf-inspector { padding: 6px; border: 1px solid; border-radius: 2px; font-size: 11px; white-space: pre-wrap; min-height: 2em; opacity: 0.7; }',
    ].join('\n');
    document.head.appendChild(style);
  }

  // -----------------------------------------------------------------
  // DOM construction
  // -----------------------------------------------------------------

  const root = document.createElement('div');
  root.className = rootClass;

  // Counters
  const countersEl = document.createElement('div');
  countersEl.className = 'lf-counters';
  const ctrLeaks = makeCtr('leaks');
  const ctrWarnings = makeCtr('warnings');
  const ctrFindings = makeCtr('findings');
  const ctrErrors = makeCtr('errors');
  countersEl.appendChild(ctrLeaks.el);
  countersEl.appendChild(ctrWarnings.el);
  countersEl.appendChild(ctrFindings.el);
  countersEl.appendChild(ctrErrors.el);
  root.appendChild(countersEl);

  // Kernel registry
  const kernelSection = makeSection('kernels');
  const kernelList = document.createElement('div');
  kernelList.className = 'lf-kernels';
  kernelSection.appendChild(kernelList);
  root.appendChild(kernelSection);
  renderKernels(kernelList, kernels);

  // Filters
  const logSection = makeSection('event log');
  const filtersEl = document.createElement('div');
  filtersEl.className = 'lf-filters';
  logSection.appendChild(filtersEl);

  const filterKinds = ['all', 'leak', 'warning', 'finding', 'error'];
  const filterBtns = [];
  for (let i = 0; i < filterKinds.length; i++) {
    const btn = document.createElement('button');
    btn.className = 'lf-filter-btn' + (i === 0 ? ' active' : '');
    btn.textContent = filterKinds[i];
    btn.addEventListener('click', makeFilterHandler(i));
    filterBtns.push(btn);
    filtersEl.appendChild(btn);
  }

  function makeFilterHandler(i) {
    return function () {
      for (let j = 0; j < filterBtns.length; j++) filterBtns[j].classList.remove('active');
      filterBtns[i].classList.add('active');
      model.filterKind.set(filterKinds[i] === 'all' ? null : filterKinds[i]);
    };
  }

  // Log (pre-allocated row pool; no dataset churn -- each row's click
  // handler closes over its pool index at init and resolves the entry
  // through the current window offset)
  const logEl = document.createElement('div');
  logEl.className = 'lf-log';
  logSection.appendChild(logEl);
  root.appendChild(logSection);

  const rowPool = new Array(maxLogRows);
  for (let i = 0; i < maxLogRows; i++) {
    const row = document.createElement('div');
    row.className = 'lf-row';
    row.style.display = 'none';
    row.addEventListener('click', makeRowHandler(i));
    rowPool[i] = row;
    logEl.appendChild(row);
  }

  function makeRowHandler(poolIdx) {
    return function () { selectRow(windowStart + poolIdx); };
  }

  // Owner-path inspector
  const inspectorSection = makeSection('owner-path inspector');
  const inspectorEl = document.createElement('div');
  inspectorEl.className = 'lf-inspector';
  inspectorEl.textContent = '(click a log row to inspect)';
  inspectorSection.appendChild(inspectorEl);
  root.appendChild(inspectorSection);

  container.appendChild(root);

  // -----------------------------------------------------------------
  // State
  // -----------------------------------------------------------------

  let windowStart = 0;      // entry index of rowPool[0] in current window
  // Selection is held by entry IDENTITY, not by index. The window slides on
  // every new event, so an index into the filtered array silently points at a
  // different entry after the next event -- the highlight moves and the
  // inspector desyncs from the highlighted row. The object reference stays
  // correct until the entry falls out of the ring.
  let selectedEntry = null;
  let frameCount = 0;
  let disposed = false;
  let logDirty = true;      // initial render on first gated frame

  // -----------------------------------------------------------------
  // Rendering
  // -----------------------------------------------------------------

  function selectRow(entryIdx) {
    const entries = model.getEntries();
    if (entryIdx >= 0 && entryIdx < entries.length) {
      selectedEntry = entries[entryIdx];
      const inspection = model.inspectOwnerPath(selectedEntry);
      inspectorEl.textContent =
        'kind: ' + (inspection.kind || '?') +
        '\ndepth: ' + inspection.depth +
        '\npath: ' + inspection.formatted;
    } else {
      selectedEntry = null;
      inspectorEl.textContent = '(click a log row to inspect)';
    }
    applySelection(entries);
  }

  function applySelection(entries) {
    for (let i = 0; i < maxLogRows; i++) {
      const entryIdx = windowStart + i;
      if (selectedEntry !== null && entryIdx < entries.length &&
          entries[entryIdx] === selectedEntry) {
        rowPool[i].classList.add('selected');
      } else {
        rowPool[i].classList.remove('selected');
      }
    }
  }

  function renderLog() {
    const entries = model.getEntries();
    // Sliding window: show the NEWEST maxLogRows entries. Rendering
    // entries[0..pool) would freeze the panel on the oldest events
    // once the model outgrows the pool.
    windowStart = entries.length > maxLogRows ? entries.length - maxLogRows : 0;
    for (let i = 0; i < maxLogRows; i++) {
      const row = rowPool[i];
      const entryIdx = windowStart + i;
      if (entryIdx < entries.length) {
        // entry.label is memoized in the model -- no per-render concat.
        row.textContent = entries[entryIdx].label;
        row.style.display = '';
      } else {
        row.style.display = 'none';
        row.textContent = '';
      }
    }
    applySelection(entries);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function renderCounters() {
    if (sink !== null) {
      ctrLeaks.val.textContent = '' + sink.leakCount.peek();
      ctrWarnings.val.textContent = '' + sink.warningCount.peek();
      ctrFindings.val.textContent = '' + sink.findingCount.peek();
      ctrErrors.val.textContent = '' + sink.errorCount.peek();
    } else {
      const entries = model.getEntries({ applyFilter: false });
      let l = 0, w = 0, fi = 0, e = 0;
      for (let i = 0; i < entries.length; i++) {
        const ch = entries[i].channel;
        if (ch === 'leak') l++;
        else if (ch === 'warning') w++;
        else if (ch === 'finding') fi++;
        else if (ch === 'error') e++;
      }
      ctrLeaks.val.textContent = '' + l;
      ctrWarnings.val.textContent = '' + w;
      ctrFindings.val.textContent = '' + fi;
      ctrErrors.val.textContent = '' + e;
    }
  }

  // Throttled render loop. Model changes only flip logDirty (one
  // boolean write per event); the gated frame does the real work.
  let rafId = 0;
  function tick() {
    if (disposed) return;
    frameCount++;
    if ((frameCount & THROTTLE_MASK) === 0 && logDirty) {
      logDirty = false;
      renderLog();
      renderCounters();
    }
    rafId = requestAnimationFrame(tick);
  }

  // Effect: mark dirty when logVersion or filterKind changes.
  // effect() returns its disposer; held so dispose() can tear it down
  // (an undisposed effect here would be a leak in the leak dashboard).
  const disposeLogEffect = effect(function () {
    model.logVersion();
    model.filterKind();
    logDirty = true;
  });

  rafId = requestAnimationFrame(tick);

  // -----------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------

  return {
    /** Update the kernel registry panel. */
    updateKernels: function (newKernels) {
      renderKernels(kernelList, newKernels);
    },

    /** Force an immediate render outside the throttle (test/debug). */
    flush: function () {
      logDirty = false;
      renderLog();
      renderCounters();
    },

    /** Unmount and stop rendering. */
    dispose: function () {
      if (disposed) return;
      disposed = true;
      disposeLogEffect();
      // Cancel the pending frame instead of relying on the disposed flag to
      // no-op it. This package ships a raf-orphan specimen describing exactly
      // this shape; the dashboard should not exhibit it. Guarded by typeof
      // because the DOM tests stub requestAnimationFrame without its counterpart.
      if (typeof cancelAnimationFrame === 'function' && rafId !== 0) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      if (root.parentNode !== null) root.parentNode.removeChild(root);
    },

    /** Test-only: row pool size. */
    _poolSize: function () { return maxLogRows; },

    /** Test-only: visible row count. */
    _visibleRows: function () {
      let count = 0;
      for (let i = 0; i < maxLogRows; i++) {
        if (rowPool[i].style.display !== 'none') count++;
      }
      return count;
    },

    /** Test-only: current window start index. */
    _windowStart: function () { return windowStart; },

    /** Test-only: text of a pooled row. */
    _rowText: function (i) { return rowPool[i].textContent; },
  };
}

// -----------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------

function makeCtr(label) {
  const el = document.createElement('div');
  el.className = 'lf-ctr';
  const val = document.createElement('span');
  val.className = 'lf-ctr-val';
  val.textContent = '0';
  const lbl = document.createElement('span');
  lbl.className = 'lf-ctr-lbl';
  lbl.textContent = label;
  el.appendChild(val);
  el.appendChild(lbl);
  return { el: el, val: val };
}

function makeSection(title) {
  const sec = document.createElement('div');
  sec.className = 'lf-section';
  const t = document.createElement('div');
  t.className = 'lf-section-title';
  t.textContent = title;
  sec.appendChild(t);
  return sec;
}

function renderKernels(listEl, kernels) {
  // Cold path (mount / explicit updateKernels only).
  while (listEl.firstChild !== null) listEl.removeChild(listEl.firstChild);
  for (let i = 0; i < kernels.length; i++) {
    const k = kernels[i];
    const card = document.createElement('div');
    card.className = 'lf-kernel';
    const name = document.createElement('span');
    name.className = 'kn';
    name.textContent = k.name || '?';
    card.appendChild(name);
    const detail = document.createElement('div');
    detail.className = 'kd';
    const patches = Array.isArray(k.patchSurfaces) ? k.patchSurfaces.join(', ') : '';
    const pri = typeof k.priority === 'number' ? k.priority : 0;
    detail.textContent = 'patches: ' + patches + ' | priority: ' + pri;
    card.appendChild(detail);
    listEl.appendChild(card);
  }
  if (kernels.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'kd';
    empty.textContent = '(no kernels registered)';
    listEl.appendChild(empty);
  }
}
