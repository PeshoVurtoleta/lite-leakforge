/**
 * @zakkster/lite-leakforge -- formatters/Format.js
 *
 * Cold-path ASCII formatters for leak reports, kernel findings, owner
 * paths, and event summaries. ASCII-only output (no box-drawing chars).
 * Designed for 10Hz-throttled or on-demand use, never per-event in hot
 * loops.
 *
 * Copyright (c) 2026 Zahary Shinikchiev <shinikchiev@yahoo.com>
 * MIT License
 */

/**
 * Render an ownerPath array as an ASCII tree.
 *
 * Input: [{ id: 3, kind: 'effect' }, { id: 1, kind: 'computed' }]
 * Output:
 *   [3 effect] -> [1 computed]
 *
 * When brokenAt is provided, the frame at that depth is marked:
 *   [3 effect] -> [1 computed *BROKEN*]
 *
 * @param {Array<{id: number, kind: string}>} path
 * @param {number} [brokenAt] - depth index of the broken frame
 * @returns {string}
 */
export function formatOwnerPath(path, brokenAt) {
  if (path === null || path === undefined || path.length === 0) {
    return '(no owner)';
  }
  const parts = [];
  for (let i = 0; i < path.length; i++) {
    const frame = path[i];
    const id = frame.id !== undefined ? frame.id : '?';
    const kind = frame.kind || '?';
    let label = '[' + id + ' ' + kind + ']';
    if (brokenAt !== undefined && i === brokenAt) {
      label = label + ' *BROKEN*';
    }
    parts.push(label);
  }
  return parts.join(' -> ');
}

/**
 * Format a single leak report (from onLeak / FR path).
 *
 * @param {object} report
 * @returns {string}
 */
export function formatReport(report) {
  if (report === null || report === undefined) return '(null report)';
  const lines = [];
  lines.push('LEAK: kind=' + (report.kind || 'unknown'));
  if (report.tag !== null && report.tag !== undefined) {
    lines.push('  tag: ' + formatTag(report.tag));
  }
  if (report.ownerPath !== null && report.ownerPath !== undefined) {
    lines.push('  owner: ' + formatOwnerPath(report.ownerPath, report.brokenAt));
  }
  if (report.collectedAt !== undefined) {
    lines.push('  collected: ' + formatMs(report.collectedAt));
  }
  // Kernel-specific fields
  if (report.timerKind !== undefined) {
    lines.push('  timer: ' + report.timerKind + ' id=' + report.timerId);
  }
  if (report.listenerType !== undefined) {
    lines.push('  listener: ' + report.listenerType);
  }
  if (report.observerKind !== undefined) {
    lines.push('  observer: ' + report.observerKind);
  }
  if (report.userTag !== undefined) {
    lines.push('  userTag: ' + formatTag(report.userTag));
  }
  if (report.origin !== null && report.origin !== undefined) {
    lines.push('  origin: ' + trimStack(report.origin));
  }
  return lines.join('\n');
}

/**
 * Format a single kernel finding (from audit / onFinding).
 *
 * @param {object} finding
 * @returns {string}
 */
export function formatFinding(finding) {
  if (finding === null || finding === undefined) return '(null finding)';
  const lines = [];
  lines.push('FINDING: kind=' + (finding.kind || '?') +
    ' reason=' + (finding.reason || '?'));
  if (finding.tag !== null && finding.tag !== undefined) {
    lines.push('  tag: ' + formatTag(finding.tag));
  }
  if (finding.ownerPath !== null && finding.ownerPath !== undefined) {
    lines.push('  owner: ' + formatOwnerPath(finding.ownerPath, finding.brokenAt));
  }
  // Kernel-specific fields
  if (finding.timerKind !== undefined) {
    lines.push('  timer: ' + finding.timerKind +
      (finding.timerId !== undefined ? ' id=' + finding.timerId : ''));
  }
  if (finding.observerKind !== undefined) {
    lines.push('  observer: ' + finding.observerKind);
  }
  if (finding.origin !== null && finding.origin !== undefined) {
    lines.push('  origin: ' + trimStack(finding.origin));
  }
  return lines.join('\n');
}

/**
 * Format a single warning (from onWarning).
 * Same shape as formatFinding -- warnings are structurally identical.
 *
 * @param {object} warning
 * @returns {string}
 */
export function formatWarning(warning) {
  if (warning === null || warning === undefined) return '(null warning)';
  const lines = [];
  lines.push('WARNING: kind=' + (warning.kind || '?') +
    ' reason=' + (warning.reason || '?'));
  if (warning.type !== undefined) {
    lines.push('  type: ' + warning.type);
  }
  if (warning.timerKind !== undefined) {
    lines.push('  timer: ' + warning.timerKind +
      (warning.timerId !== undefined ? ' id=' + warning.timerId : ''));
  }
  if (warning.observerKind !== undefined) {
    lines.push('  observer: ' + warning.observerKind);
  }
  if (warning.origin !== null && warning.origin !== undefined) {
    lines.push('  origin: ' + trimStack(warning.origin));
  }
  return lines.join('\n');
}

/**
 * Summarize an array of events (reports, findings, or warnings) by
 * grouping on kind + reason. Returns an array of group objects sorted
 * by count descending.
 *
 * @param {object[]} events
 * @returns {SummaryGroup[]}
 *
 * @typedef {object} SummaryGroup
 * @property {string} kind
 * @property {string|null} reason
 * @property {number} count
 * @property {object} first - first event in the group
 */
export function summarize(events) {
  if (!Array.isArray(events) || events.length === 0) return [];
  const groups = new Map();
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const kind = e.kind || 'unknown';
    const reason = e.reason || null;
    const key = kind + '\x00' + (reason || '');
    let g = groups.get(key);
    if (g === undefined) {
      g = { kind: kind, reason: reason, count: 0, first: e };
      groups.set(key, g);
    }
    g.count++;
  }
  const result = [];
  for (const g of groups.values()) result.push(g);
  result.sort(function (a, b) { return b.count - a.count; });
  return result;
}

/**
 * Format a summarize() result as a multi-line ASCII table.
 *
 * @param {SummaryGroup[]} groups
 * @returns {string}
 */
export function formatSummary(groups) {
  if (groups.length === 0) return '(no events)';
  const lines = [];
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    let line = '' + g.count + 'x ' + g.kind;
    if (g.reason !== null) line = line + ' (' + g.reason + ')';
    lines.push(line);
  }
  return lines.join('\n');
}

/**
 * Format a full verify() result as a human-readable report.
 *
 * @param {object} result - verify() return value
 * @returns {string}
 */
export function formatVerifyResult(result) {
  const lines = [];
  lines.push('=== ' + result.specimen + ' === ' + (result.pass ? 'PASS' : 'FAIL'));
  if (result.leaks.actual.length > 0) {
    lines.push('');
    lines.push('Leaks (' + result.leaks.actual.length + '):');
    for (let i = 0; i < result.leaks.actual.length; i++) {
      lines.push('  ' + formatReport(result.leaks.actual[i]).replace(/\n/g, '\n  '));
    }
  }
  if (result.leaks.missing.length > 0) {
    lines.push('  MISSING: ' + result.leaks.missing.map(
      function (e) { return e.kind; }).join(', '));
  }
  if (result.warnings.actual.length > 0) {
    lines.push('');
    lines.push('Warnings (' + result.warnings.actual.length + '):');
    for (let i = 0; i < result.warnings.actual.length; i++) {
      lines.push('  ' + formatWarning(result.warnings.actual[i]).replace(/\n/g, '\n  '));
    }
  }
  if (result.warnings.missing.length > 0) {
    lines.push('  MISSING: ' + result.warnings.missing.map(
      function (e) { return e.kind; }).join(', '));
  }
  if (result.findings.actual.length > 0) {
    lines.push('');
    lines.push('Findings (' + result.findings.actual.length + '):');
    for (let i = 0; i < result.findings.actual.length; i++) {
      lines.push('  ' + formatFinding(result.findings.actual[i]).replace(/\n/g, '\n  '));
    }
  }
  if (result.findings.missing.length > 0) {
    lines.push('  MISSING: ' + result.findings.missing.map(
      function (e) { return e.kind; }).join(', '));
  }
  if (result.settleResult !== null) {
    const s = result.settleResult;
    lines.push('');
    lines.push('Settle: ' + (s.settled ? 'OK' : 'INCOMPLETE') +
      ' rounds=' + s.rounds + ' remaining=' + s.remaining);
  }
  return lines.join('\n');
}

// -----------------------------------------------------------------
// Internal helpers
// -----------------------------------------------------------------

/**
 * Format a tag for display. Objects get JSON, strings pass through.
 * @private
 */
function formatTag(tag) {
  if (typeof tag === 'string') return tag;
  if (tag === null) return 'null';
  if (tag === undefined) return 'undefined';
  try { return JSON.stringify(tag); }
  catch (_e) { return String(tag); }
}

/**
 * Format milliseconds as seconds with 1 decimal.
 * @private
 */
function formatMs(ms) {
  if (typeof ms !== 'number') return '?';
  return (ms / 1000).toFixed(1) + 's';
}

/**
 * Trim a stack trace to the first 3 non-Error lines.
 * @private
 */
function trimStack(stack) {
  if (typeof stack !== 'string') return '?';
  const lines = stack.split('\n');
  const meaningful = [];
  for (let i = 0; i < lines.length && meaningful.length < 3; i++) {
    const line = lines[i].trim();
    if (line.length === 0) continue;
    if (line.startsWith('Error')) continue;
    meaningful.push(line);
  }
  return meaningful.join(' << ');
}
