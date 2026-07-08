# @zakkster/lite-leakforge

[![npm version](https://img.shields.io/npm/v/@zakkster/lite-leakforge.svg?style=for-the-badge&color=latest)](https://www.npmjs.com/package/@zakkster/lite-leakforge)
![Zero-GC](https://img.shields.io/badge/Zero--GC-Hot%20path-00C853?style=for-the-badge&logo=leaf&logoColor=white)
[![sponsor](https://img.shields.io/badge/sponsor-PeshoVurtoleta-ea4aaa.svg?logo=github)](https://github.com/sponsors/PeshoVurtoleta)
[![npm bundle size](https://img.shields.io/bundlephobia/minzip/@zakkster/lite-leakforge?style=for-the-badge)](https://bundlephobia.com/result?p=@zakkster/lite-leakforge)
[![npm downloads](https://img.shields.io/npm/dm/@zakkster/lite-leakforge?style=for-the-badge&color=blue)](https://www.npmjs.com/package/@zakkster/lite-leakforge)
[![npm total downloads](https://img.shields.io/npm/dt/@zakkster/lite-leakforge?style=for-the-badge&color=blue)](https://www.npmjs.com/package/@zakkster/lite-leakforge)
[![lite-signal peer](https://img.shields.io/badge/peer-lite--signal-blue?style=for-the-badge)](https://github.com/PeshoVurtoleta/lite-signal)
![TypeScript](https://img.shields.io/badge/TypeScript-Types-informational)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

Leak specimens, CI harness, and diagnostic toolkit for
[@zakkster/lite-leak](https://github.com/PeshoVurtoleta/lite-leak).

lite-leakforge is the **product layer** above lite-leak's primitive
tracker. lite-leak detects leaks; leakforge **proves it**, **shows it**,
and **gates it**.

- **Prove it** -- deterministic specimens that trigger each kernel's
  detection path, with a 3-channel verify contract diffing expected vs
  actual across leak reports, warnings, and findings.
- **Show it** -- ASCII formatters, a ghost-safe dashboard data model,
  and a 5-scene oscilloscope demo.
- **Gate it** -- a CI harness with `assertNoLeaks()` and `leakSuite()`
  that produces exit 0 (clean), exit 1 (confirmed leak), or exit 3
  (inconclusive / recapture).

```
npm install @zakkster/lite-leakforge
```

Peer dependency: `@zakkster/lite-signal >=1.5.0-beta.3 <2.0.0`

## Quick start

### CI gate

```js
// test/leak.test.js
// Run with: node --expose-gc --test test/leak.test.js
import { describe, it } from 'node:test';
import { assertNoLeaks } from '@zakkster/lite-leakforge';

describe('my library', () => {
  it('does not leak', async () => {
    await assertNoLeaks((tracker) => {
      const resource = createMyResource();
      const handle = tracker.track(resource, () => {}, 'my-resource');
      destroyMyResource(resource);
      tracker.untrack(handle);
    });
  });
});
```

### leakSuite (node:test-native)

```js
import { describe, it } from 'node:test';
import { leakSuite } from '@zakkster/lite-leakforge';

leakSuite(describe, it, 'my-module', (measure) => {
  measure('create and dispose', (tracker) => {
    const r = { x: 1 };
    const h = tracker.track(r, () => {}, 'test');
    tracker.untrack(h);
  });

  measure('no-op is clean', (_tracker) => {
    // nothing to leak
  });
});
```

### Specimen verification

```js
import { verify, createTimerOrphanSpecimen } from '@zakkster/lite-leakforge';

const result = await verify(createTimerOrphanSpecimen());
console.log(result.pass);        // true
console.log(result.warnings);    // { pass: true, actual: [...], ... }
console.log(result.findings);    // { pass: true, actual: [...], ... }
```

### Formatters

```js
import {
  formatReport, formatOwnerPath, summarize, formatSummary
} from '@zakkster/lite-leakforge/formatters';

const path = [{ id: 3, kind: 'effect' }, { id: 1, kind: 'computed' }];
formatOwnerPath(path, 1);
// '[3 effect] -> [1 computed] *BROKEN*'

const groups = summarize(events);
formatSummary(groups);
// '3x timer-orphan (no-owner-set)\n1x listener-orphan (no-owner-set)'
```

### Dashboard data model

```js
import { createDashboardModel, createDashboard } from '@zakkster/lite-leakforge/panels';
import { effect } from '@zakkster/lite-signal';
import { createLeakTracker } from '@zakkster/lite-leak';

const model = createDashboardModel({ logCapacity: 128 });
const tracker = createLeakTracker({
  name: 'my-app',
  onLeak: model.onLeak,
  onWarning: model.onWarning,
  onFinding: model.onFinding,
  onError: model.onError,
});

// Mount the full dashboard DOM (browser only)
const dashboard = createDashboard({
  container: document.getElementById('dashboard'),
  model: model,
  kernels: [timerK, listenerK],   // installed kernel objects
  maxLogRows: 60,                  // pre-allocated row pool
});

// Or use the model directly for custom UIs
effect(() => {
  const v = model.logVersion();    // triggers on every event
  const entries = model.getEntries();
  renderLog(entries);
});

// Kind filter
model.filterKind.set('timer-orphan');
```

## API

### Subpath exports

| Import | Contents |
|---|---|
| `@zakkster/lite-leakforge` | Everything (barrel) |
| `@zakkster/lite-leakforge/harness` | settleFinalizers, settleTracker, createLeakGate, assertNoLeaks, leakSuite, EXIT_* |
| `@zakkster/lite-leakforge/formatters` | formatReport, formatFinding, formatWarning, formatOwnerPath, summarize, formatSummary, formatVerifyResult |
| `@zakkster/lite-leakforge/scenarios` | verify, composeScenario, all specimen factories |
| `@zakkster/lite-leakforge/panels` | createDashboardModel, createDashboard, CHANNEL_* constants |

All subpaths ship their own `.d.ts` (types resolve for deep imports,
not just the barrel).

### Specimens

Each specimen factory returns `{ name, kernels, expectedLeaks,
expectedWarnings, expectedFindings, needsSettle, inject, release }`.

| Factory | Kernel required | Detection channels |
|---|---|---|
| `createRawFrSpecimen()` | none | FR leak `kind: 'unknown'` |
| `createTimerOrphanSpecimen()` | timer-orphan | warning `no-owner-set`, finding `no-owner-pending` |
| `createListenerOrphanSpecimen()` | listener-orphan | warning `no-owner-set` |
| `createObserverOrphanSpecimen()` | observer-orphan | warning `no-owner-set`, finding `no-owner-pending` |
| `createDetachedDomSpecimen()` | detached-dom | finding `detached-at-audit` |
| `createAsyncRetentionSpecimen()` | async-retention | warning `no-owner-set`, finding `no-owner-pending` |

### Exit codes

| Code | Constant | Meaning |
|---|---|---|
| 0 | `EXIT_CLEAN` | No leaks detected, FR settled |
| 1 | `EXIT_LEAK` | Confirmed leak (FR report or audit finding) |
| 3 | `EXIT_INCONCLUSIVE` | FR did not settle; recapture recommended |

Precedence: confirmed evidence wins. A leak report or audit finding is
exit 1 even when FR did not settle -- an unsettled registry never
downgrades hard evidence to "recapture". Exit 3 is reserved for
evidence-free unsettled runs.

`verify()` throws (rather than reporting a bogus FAIL) when a
`needsSettle` specimen runs without `--expose-gc`; the five pre-FR
specimens run anywhere, including browsers.

Kernel teardown in both `createLeakGate().run()` and `verify()` is
exception-safe: kernels patch global surfaces, and the patches are
removed even when user code or `inject()` throws.

### Ghost safety

`createDashboardModel()` creates exactly 2 signals (`logVersion`,
`filterKind`) at construction. Zero signals created per event. Verified
by `model.signalCount()` and tested in the ghost-safety suite.

Entry formatting is lazy: `entry.text`, `entry.ownerPath`, and
`entry.label` are memoized getters computed on first read (render
time), so a warning storm costs one small entry object per event and
zero formatting work.

`createDashboard()` renders through a dirty flag gated by a power-of-2
frame mask: model changes flip one boolean, the gated frame does the
work, and the log shows the newest `maxLogRows` entries as a sliding
window.

## Demo

Run from the package root:

```
npx serve .
```

Open `http://localhost:3000/demo/`. Six scenes:

1. **Tracker** -- track/untrack/abandon lifecycle, gc pressure, FR leak
   reports, oscilloscope size() trace
2. **Kernel gallery** -- five kernels installed live (scene-scoped
   install/uninstall), orphan injections vs an owned-timer clean path,
   real DOM-detachment detection
3. **Specimen lab** -- verify() per specimen with PASS/FAIL badges and
   formatVerifyResult output, composeScenario run-all; raw-fr enables
   itself when the browser exposes gc()
4. **Audit console** -- audit(), auditByKind(), remediate(),
   summarize() + formatSummary()
5. **Dashboard** -- the packaged createDashboard() component fed by a
   live tracker, with a 500-event storm to demonstrate dirty-flag
   rendering (500 events, one render)
6. **Stress** -- 4096 allocation-clean track/untrack cycles,
   Float64Array scope ring, size() return-to-zero verdict

## Tests

```
node --expose-gc --test test/*.test.js
```

83 tests across 7 files: settle (7), gate (14), specimens (12),
formatters (22), panels (21), dom (6), version (1). All GC-dependent
tests skip gracefully without `--expose-gc`.

## Architecture decisions

See [WHY-1.0.md](WHY-1.0.md) for the rationale behind key design
choices. See [REJECTED.md](REJECTED.md) for proposals considered and
declined.

## License

MIT. Copyright (c) 2026 Zahary Shinikchiev.
