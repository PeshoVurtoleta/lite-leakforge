# Changelog

All notable changes to `@zakkster/lite-leakforge` are documented here.

## 1.0.0 (2026-07-08)

Initial stable release. Leak specimens, CI harness, ASCII formatters,
dashboard data model, and 5-scene oscilloscope demo for
`@zakkster/lite-leak` v1.0.0.

### Harness

- `settleFinalizers(options)` -- bounded-retry FR settlement loop
  requiring `--expose-gc`. Allocation pressure + `gc()` + double
  `setImmediate` tick per round.
- `settleTracker(tracker, options)` -- convenience wrapper for
  lite-leak trackers.
- `createLeakGate(options)` -- reusable CI gate with exit-code
  semantics: 0 clean, 1 confirmed leak, 3 inconclusive (recapture).
  Precedence: confirmed evidence (leak report OR audit finding) is
  exit 1 even when FR did not settle; exit 3 is reserved for
  evidence-free unsettled runs. Installs timer-orphan,
  listener-orphan, and async-retention kernels by default.
  `captureStacks` option (default true) passes through to the tracker.
  Kernel teardown is exception-safe: patched globals are restored even
  when the gated function throws.
- `assertNoLeaks(fn, options)` -- one-shot assertion. Throws on leak
  or inconclusive.
- `leakSuite(describe, it, name, fn, options)` -- `node:test`-native
  wrapper with `measure()` callback for individual leak tests.

### Specimens

Six specimens covering all patchable kernels plus the raw FR path:

| Specimen | Kernel | Channels tested |
|---|---|---|
| `raw-fr` | *(none)* | FR leak report (`kind: 'unknown'`) |
| `timer-orphan` | `timer-orphan` | warning + finding |
| `listener-orphan` | `listener-orphan` | warning |
| `observer-orphan` | `observer-orphan` | warning + finding |
| `detached-dom` | `detached-dom` | finding |
| `async-retention` | `async-retention` | warning + finding |

- `verify(specimen, options)` -- 3-channel contract: diffs expected vs
  actual across leak reports, warnings, and findings independently.
  Runs audit before release so pending resources are visible to
  audit-time kernels. Throws for `needsSettle` specimens without
  `--expose-gc` (environment error, not a bogus detection FAIL).
  Kernel teardown is exception-safe across a throwing inject/release.
- `composeScenario(specimens, options)` -- aggregate runner.

### Formatters

ASCII-only output (no box-drawing characters).

- `formatOwnerPath(path, brokenAt?)` -- `[3 effect] -> [1 computed] *BROKEN*`
- `formatReport(report)` -- multi-line FR leak report
- `formatFinding(finding)` -- audit finding
- `formatWarning(warning)` -- real-time warning
- `summarize(events)` -- group/dedupe by kind+reason, sorted by count
- `formatSummary(groups)` -- `3x timer-orphan (no-owner-set)`
- `formatVerifyResult(result)` -- full verify() output with all channels

### Panels

- `createDashboardModel(options)` -- data layer for leak dashboards.
  Pre-allocated ring buffer event log, kernel registry snapshot,
  owner-path inspector, kind-filter signal. Ghost-safe: exactly 2
  signals at construction (`logVersion`, `filterKind`), zero graph
  churn per event. Entry formatting is LAZY: `text`, `ownerPath`, and
  `label` are memoized getters computed on first read, so event storms
  pay zero formatting cost.
- `createDashboard(options)` -- browser-only DOM rendering. Counter bar,
  kernel registry panel, rolling log with kind-filter buttons and a
  pre-allocated row pool (textContent-only updates). Model changes flip
  a dirty flag; rendering runs behind a power-of-2 frame mask, so an
  event storm costs one render. The log is a sliding window over the
  NEWEST `maxLogRows` entries. The internal effect is disposed on
  `dispose()`; `flush()` forces an immediate render for tests.

### Packaging

- Subpath exports (`/harness`, `/formatters`, `/scenarios`, `/panels`)
  ship their own `.d.ts` files; `types` resolves for deep imports.

### Demo

Six-scene oscilloscope-themed HTML demo (`demo/index.html`, never in
`files[]`). Phosphor green oklch theme (hex fallbacks first), CRT grid,
multi-scene tabs, zero-allocation hot paths (pooled log rows,
Float64Array scope rings, frame-mask throttles, cached DOM refs).
Scenes: tracker primitive with abandon + gc pressure, kernel gallery
with scene-scoped install/uninstall and an owned-vs-orphan contrast,
specimen lab running verify()/composeScenario in-browser, audit console
with remediate() + summarize(), the packaged createDashboard() fed a
500-event storm, and a 4096-cycle allocation-clean stress run. The
importmap pins lite-leak with `?external=@zakkster/lite-signal` so the
demo and the kernels share ONE lite-signal instance.
