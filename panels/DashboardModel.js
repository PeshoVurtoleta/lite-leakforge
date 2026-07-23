/**
 * @zakkster/lite-leakforge -- panels/DashboardModel.js
 *
 * Data model for the leak dashboard. Pure JS, no DOM dependency.
 * Consumes createProfilerSignalSink signals and maintains:
 *
 *   1. Event log ring buffer (pre-allocated, fixed capacity)
 *   2. Kernel registry snapshot (names, patch surfaces, priorities)
 *   3. Owner-path inspector (format + highlight broken frame)
 *   4. Kind-filter state
 *
 * Ghost-safe: creates a fixed number of signals at construction
 * (filterKind + logVersion). No signal churn per event.
 *
 * Copyright (c) 2026 Zahary Shinikchiev <shinikchiev@yahoo.com>
 * MIT License
 */

import { signal, batch } from '@zakkster/lite-signal';
import { formatOwnerPath, formatReport, formatFinding, formatWarning } from '../formatters/Format.js';

/**
 * Event log entry shape:
 *   { channel: 'leak'|'warning'|'finding'|'error',
 *     kind: string,
 *     reason: string|null,
 *     text: string,          -- LAZY: formatted ASCII, memoized on first read
 *     ownerPath: string,     -- LAZY: formatted owner path, memoized
 *     label: string,         -- LAZY: compact one-line label, memoized
 *     raw: object,           -- original event object
 *     ts: number }           -- performance.now()
 */

const CHANNEL_LEAK = 'leak';
const CHANNEL_WARNING = 'warning';
const CHANNEL_FINDING = 'finding';
const CHANNEL_ERROR = 'error';

export { CHANNEL_LEAK, CHANNEL_WARNING, CHANNEL_FINDING, CHANNEL_ERROR };

/**
 * Create the dashboard data model.
 *
 * @param {object} options
 * @param {number} [options.logCapacity=256]
 *   Max entries in the ring buffer. Power of 2 recommended.
 * @returns {DashboardModel}
 */
/**
 * Coerce a caller-supplied ring capacity to a safe positive integer, bounded so
 * a fractional value cannot RangeError and a huge one cannot OOM.
 * @private
 */
function normalizeCapacity(value, dflt, max) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return dflt;
  const n = Math.floor(value);
  if (n < 1) return dflt;
  return n > max ? max : n;
}

export function createDashboardModel(options) {
  const opts = options || {};
  // A fractional capacity reaches `new Array(2.5)` (RangeError); Infinity or a
  // huge value (5e8) aborts the process with OOM. Floor, bound, and fall back
  // to the default for anything non-finite. 2^20 entries is far past any real
  // dashboard need.
  const capacity = normalizeCapacity(opts.logCapacity, 256, 1048576);

  // -----------------------------------------------------------------
  // Ring buffer for event log (pre-allocated)
  // -----------------------------------------------------------------
  const ring = new Array(capacity);
  for (let i = 0; i < capacity; i++) ring[i] = null;
  let head = 0;
  let count = 0;

  // Ghost-safe signals: exactly 2 at construction, never more.
  // logVersion bumps on every push (subscribers re-read the buffer).
  // filterKind holds the active kind filter (null = show all).
  const logVersion = signal(0);
  const filterKind = signal(null);

  let versionCounter = 0;

  function pushEntry(channel, raw) {
    const kind = safeKind(raw);
    const reason = raw !== null && typeof raw === 'object' && typeof raw.reason === 'string'
      ? raw.reason : null;

    // Formatting is LAZY. The formatters are cold-path by design
    // ("never per-event in hot loops") -- eagerly building multi-line
    // strings here would put them on the event path during warning
    // storms. text / ownerPath / label are memoized getters: zero
    // string work per push, computed once on first read (render time),
    // then cached. All entries share one hidden class (same literal).
    const entry = {
      channel: channel,
      kind: kind,
      reason: reason,
      raw: raw,
      ts: typeof performance !== 'undefined' ? performance.now() : Date.now(),
      _text: null,
      _ownerPath: null,
      _label: null,
      get text() {
        if (this._text === null) this._text = formatEntryText(this.channel, this.raw);
        return this._text;
      },
      get ownerPath() {
        if (this._ownerPath === null) {
          const r = this.raw;
          this._ownerPath = r !== null && typeof r === 'object' && Array.isArray(r.ownerPath)
            ? formatOwnerPath(r.ownerPath, r.brokenAt)
            : '';
        }
        return this._ownerPath;
      },
      get label() {
        if (this._label === null) {
          this._label = this.channel.charAt(0).toUpperCase() + ' ' + this.kind +
            (this.reason !== null ? ' (' + this.reason + ')' : '');
        }
        return this._label;
      },
    };

    ring[head] = entry;
    head = (head + 1) % capacity;
    if (count < capacity) count++;

    versionCounter++;
    logVersion.set(versionCounter);

    return entry;
  }

  // -----------------------------------------------------------------
  // Sink callbacks (wire into tracker options)
  // -----------------------------------------------------------------

  function onLeak(report) { pushEntry(CHANNEL_LEAK, report); }
  function onWarning(warning) { pushEntry(CHANNEL_WARNING, warning); }
  function onFinding(finding) { pushEntry(CHANNEL_FINDING, finding); }
  function onError(err, tag) {
    const errorObj = {
      kind: 'error',
      message: err !== null && typeof err === 'object' ? err.message : String(err),
      tag: tag,
    };
    pushEntry(CHANNEL_ERROR, errorObj);
  }

  // -----------------------------------------------------------------
  // Log reading (oldest-first iteration)
  // -----------------------------------------------------------------

  /**
   * Return log entries as an array, oldest first.
   * Optionally filtered by the current filterKind signal.
   *
   * @param {object} [options]
   * @param {boolean} [options.applyFilter=true]
   * @returns {object[]}
   */
  function getEntries(options) {
    const apply = options === undefined || options.applyFilter !== false;
    const fk = apply ? filterKind.peek() : null;
    const result = [];
    if (count === 0) return result;
    const start = count < capacity ? 0 : head;
    for (let i = 0; i < count; i++) {
      const idx = (start + i) % capacity;
      const entry = ring[idx];
      if (entry === null) continue;
      if (fk !== null && entry.kind !== fk) continue;
      result.push(entry);
    }
    return result;
  }

  /**
   * Return the N most recent entries (newest first).
   */
  function getRecent(n, options) {
    const all = getEntries(options);
    const take = typeof n === 'number' && n > 0 ? n : all.length;
    const result = [];
    for (let i = all.length - 1; i >= 0 && result.length < take; i--) {
      result.push(all[i]);
    }
    return result;
  }

  // -----------------------------------------------------------------
  // Kernel registry snapshot
  // -----------------------------------------------------------------

  /**
   * Snapshot the tracker's registered kernels. Must be called with
   * access to the kernel list (via tracker introspection or manual
   * registration tracking). Returns an array of descriptors.
   *
   * @param {object[]} kernels - array of kernel objects
   * @returns {KernelDescriptor[]}
   *
   * @typedef {object} KernelDescriptor
   * @property {string} name
   * @property {string[]} patchSurfaces
   * @property {number} priority
   * @property {boolean} hasRefine
   * @property {boolean} hasAudit
   * @property {boolean} hasAdvise
   */
  function snapshotKernels(kernels) {
    if (!Array.isArray(kernels)) return [];
    const result = [];
    for (let i = 0; i < kernels.length; i++) {
      const k = kernels[i];
      result.push({
        name: typeof k.name === 'string' ? k.name : '?',
        patchSurfaces: Array.isArray(k.patchSurfaces) ? k.patchSurfaces.slice() : [],
        priority: typeof k.priority === 'number' ? k.priority : 0,
        hasRefine: typeof k.refine === 'function',
        hasAudit: typeof k.audit === 'function',
        hasAdvise: typeof k.advise === 'function',
      });
    }
    return result;
  }

  // -----------------------------------------------------------------
  // Owner-path inspector
  // -----------------------------------------------------------------

  /**
   * Inspect an owner path from a log entry's raw event.
   * Returns a structured description with formatted path and
   * broken-frame highlighting.
   *
   * @param {object} entry - log entry from getEntries()
   * @returns {OwnerInspection}
   *
   * @typedef {object} OwnerInspection
   * @property {string} formatted - ASCII-rendered path
   * @property {Array|null} path - raw path array
   * @property {number|undefined} brokenAt - broken frame index
   * @property {number} depth - path length
   * @property {string|null} kind - event kind
   */
  function inspectOwnerPath(entry) {
    if (entry === null || entry === undefined) {
      return { formatted: '(no entry)', path: null, brokenAt: undefined, depth: 0, kind: null };
    }
    const raw = entry.raw;
    const path = raw !== null && typeof raw === 'object' && Array.isArray(raw.ownerPath)
      ? raw.ownerPath : null;
    const brokenAt = raw !== null && typeof raw === 'object' ? raw.brokenAt : undefined;
    return {
      formatted: formatOwnerPath(path, brokenAt),
      path: path,
      brokenAt: brokenAt,
      depth: path !== null ? path.length : 0,
      kind: entry.kind,
    };
  }

  // -----------------------------------------------------------------
  // Ghost-safety introspection
  // -----------------------------------------------------------------

  /**
   * Return the count of signals this model owns.
   * Must be exactly 2 at all times (logVersion + filterKind).
   */
  function signalCount() { return 2; }

  // -----------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------

  return {
    // Sink callbacks
    onLeak: onLeak,
    onWarning: onWarning,
    onFinding: onFinding,
    onError: onError,

    // Log access
    getEntries: getEntries,
    getRecent: getRecent,
    logVersion: logVersion,
    filterKind: filterKind,

    // Kernel registry
    snapshotKernels: snapshotKernels,

    // Owner-path inspector
    inspectOwnerPath: inspectOwnerPath,

    // Ghost-safety
    signalCount: signalCount,

    // State
    get count() { return count; },
    get capacity() { return capacity; },

    // Reset
    reset: function () {
      for (let i = 0; i < capacity; i++) ring[i] = null;
      head = 0;
      count = 0;
      versionCounter = 0;
      batch(function () {
        logVersion.set(0);
        filterKind.set(null);
      });
    },
  };
}

// -----------------------------------------------------------------
// Internal helpers
// -----------------------------------------------------------------

function safeKind(x) {
  if (x !== null && typeof x === 'object' && typeof x.kind === 'string') return x.kind;
  return 'unknown';
}

/**
 * Route a raw event to its channel formatter. Cold path -- called at
 * most once per entry (memoized by the lazy `text` getter).
 * @private
 */
function formatEntryText(channel, raw) {
  if (channel === CHANNEL_LEAK) return formatReport(raw);
  if (channel === CHANNEL_WARNING) return formatWarning(raw);
  if (channel === CHANNEL_FINDING) return formatFinding(raw);
  return String(raw);
}
