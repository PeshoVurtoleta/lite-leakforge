# Changelog

All notable changes to `@zakkster/lite-leakforge` are documented here.

## 1.4.0 (2026-07-21)

**Clustered reporting.** `--group` collapses findings into clusters and names
the call site each one came from.

### Added

- **`--group`** -- pairs with lite-leak 1.5.0's `groupFindings`. Prints one line
  per cluster with a count, plus the first non-instrumentation stack frame:

  ```
  Findings by cluster (2 of 190 findings):
       150 x  timer-orphan / no-owner-pending
             at run (app/panel.js:5:51)
        40 x  timer-orphan / no-owner-pending
             at run (app/chart.js:8:50)
  ```

  The existing `Summary` line already grouped by `kind`/`reason`, so clustering
  by **call site** is the only thing this adds over it. That is also why
  `--group` now implies `captureStacks` -- without a stack there is no call
  site, and the flag would print what `Summary` already prints.

### Fixed

- **`captureStacks` never reached the kernels.** `createLeakGate({ captureStacks:
  true })` forwarded the option to the tracker but constructed
  `timer-orphan` and `listener-orphan` without it. `origin` is captured inside
  the kernel at the moment a resource is created, so every gate finding carried
  `origin: null` however the gate was configured -- silently disabling call-site
  attribution, `--group` clustering, and any consumer reading `finding.origin`.

### Changed

- Requires `@zakkster/lite-leak` `^1.5.0`.

## 1.3.0 (2026-07-21)

**GPU-resource specimen.** Acceptance coverage for lite-leak 1.3.0's
`gl-resource-orphan` kernel. Kernel and specimen ship together.

### Added

- **`createGlResourceOrphanSpecimen()`** -- a buffer and a texture allocated at
  module scope on a live mock context and never deleted. Asserts two
  `no-owner-create` warnings and two `no-owner-resource-live` findings, and
  pins that the findings carry distinct `resourceKind` values: a kernel that
  collapsed every GPU object into one bucket would still pass a
  single-resource specimen.
- Registered as a CLI built-in (`--specimens gl-resource-orphan`).
  `leakforge --specimens` now runs 11/11.

The mock context keeps `isContextLost()` false so the resources stay
reportable; the lost-context path is the kernel's documented "already
reclaimed, not a leak" case and is covered by its own unit test.

### Changed

- Requires `@zakkster/lite-leak` `^1.3.0`.

## 1.2.0 (2026-07-19)

**Three resource specimens.** Acceptance coverage for lite-leak 1.2.0's
`worker-orphan`, `audio-node` and `socket-orphan` kernels. Kernel and specimen
ship together: a kernel without an acceptance specimen is an untested claim.

### Added

- **`createWorkerOrphanSpecimen()`** -- a Worker constructed at module scope
  from a `blob:` URL that is never revoked. Asserts one `no-owner-set` warning
  and two findings (`no-owner-worker-live`, `blob-url-unrevoked`). It pins the
  *failure* of a pattern the ecosystem already gets right: `@zakkster/lite-worker`
  revokes on the line after construction, which is correct.
- **`createAudioNodeSpecimen()`** -- a scheduled source connected to the graph
  and started at module scope. Asserts one `no-owner-connect` warning and both
  halves of an audio leak from a single injection
  (`no-owner-node-connected`, `source-started-not-stopped`).
- **`createSocketOrphanSpecimen()`** -- a WebSocket left OPEN with no owner.
  Asserts `no-owner-open` and `no-owner-socket-open`. The mock carries real
  `readyState` constants, so the kernel's "a connection the peer already closed
  is not a leak" rule is exercised by state rather than bookkeeping.
- All three registered as CLI built-ins (`--specimens worker-orphan`, etc.).
  `leakforge --specimens` now runs 10/10.

Every host is specimen-local: Node has no Worker, WebAudio or WebSocket, and a
specimen must never patch a global it shares with the test runner.

### Changed

- Requires `@zakkster/lite-leak` `^1.2.0`.

## 1.1.0 (2026-07-15)

CLI + raf-orphan specimen. Pairs with `@zakkster/lite-leak` v1.1.0
(raf-orphan kernel) and completes the CLI trilogy alongside litecap and
gc-profiler.

### CLI

- `npx leakforge <suite-file>` -- run a leak-suite file's checks under a
  single `createLeakGate`, print an ASCII report, and exit with the gate
  codes (0 clean, 1 leak, 3 inconclusive). A suite file default-exports
  `{ name, checks: [{ name, run(tracker) }], options? }`. The exit code is
  aggregated across checks with the gate's evidence-wins precedence: any
  confirmed leak -> 1; else any evidence-free unsettled run -> 3; else 0.
- `npx leakforge --specimens [name...]` -- verify the built-in specimens
  (kernel acceptance): 0 all pass, 1 a specimen regressed, 3 an
  environment error (e.g. a `needsSettle` specimen without `--expose-gc`).
- `--json <path>` -- write a machine-readable CI artifact: slim events
  (kind/reason/tag), per-check exit codes, settle state, and a summary.
  No stacks, so it diffs cleanly across runs.
- The gate needs manual GC, so the executable re-execs itself once with
  `--expose-gc` (env-guarded against loops); `npx leakforge` just works.
  `--help`/`--version` skip the relaunch. Usage errors exit 2.
- Core logic lives in `bin/Cli.js` (pure, unit-tested); `bin/leakforge.js`
  is the thin I/O + exit wrapper.

### Specimens

- `createRafOrphanSpecimen()` -- acceptance test for lite-leak's
  raf-orphan kernel. A `requestAnimationFrame` loop scheduled with no
  owner: `no-owner-set` warning at schedule time, `no-owner-loop-armed`
  finding at audit time, zero leaks. Pre-FR channels only
  (`needsSettle: false`), so it runs without `--expose-gc`. Uses a
  specimen-local rAF host -- no DOM, and no shared global is patched.
  Seven specimens now ship.

### Dependencies

- Bumped `@zakkster/lite-leak` to `^1.1.0` (raf-orphan kernel).

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
