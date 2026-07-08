# WHY-1.0.md -- Architectural decisions in lite-leakforge 1.0.0

## Verify runs audit before release

The verify contract executes in the order: inject -> audit -> release -> settle.

Audit must run BEFORE release because audit-time kernels (timer-orphan,
observer-orphan, async-retention) check for PENDING resources -- timers
that have not been cleared, controllers that have not been aborted,
observers that have not been disconnected. If release() clears the timer
before audit runs, the kernel's internal map no longer contains the entry
and no finding is produced.

This surfaced during session 1 when the timer-orphan specimen called
clearTimeout in release() and the finding was missing. The reordering
was confirmed correct: audit captures the leaky state, release cleans
up test resources, settle handles FR callbacks.

## Three detection channels, not one

The verify contract diffs THREE channels independently:

1. expectedLeaks -- FR-path reports (target GCd without untrack)
2. expectedWarnings -- real-time warnings (kernel emits at set-time)
3. expectedFindings -- audit() results (on-demand scan)

A single "expected" array conflating all three would mask which
detection path failed. Each channel has independent pass/fail,
missing, and unexpected arrays.

## owner-cascade-orphan specimen deferred

The owner-cascade-orphan kernel detects handles whose owner chain is
stale (nodeId returns undefined for a disposed owner). This is a
safety net for lite-signal engine bugs in the cleanup cascade.

The specimen cannot be built at the product level because lite-signal's
cascade is correct by construction: onCleanup always fires on owner
disposal, which auto-untracks the handle before audit can see a stale
chain. runWithOwner with a stale handle sets currentOwner to null
(liveNode returns undefined), so getOwner returns undefined and track()
captures no owner context.

Options for a future version:
- Add a _injectStaleRecord() test hook to the kernel
- Build a mock tracker that skips auto-untrack wiring
- Wait for a lite-signal version where the cascade can be
  programmatically interrupted (unlikely by design)

## leakSuite takes describe and it as arguments

Gate.js must be importable in non-test contexts without side effects.
Importing node:test at module scope would register test runner hooks
even when the caller only wants assertNoLeaks. Dependency injection
(passing describe and it from the caller's test file) keeps Gate.js
clean and avoids the CJS require / ESM import mismatch.

## settleFinalizers uses double setImmediate tick

A single setImmediate after gc() is sometimes insufficient for FR
callbacks to drain. The V8 FR implementation may enqueue callbacks
as microtasks that resolve between event-loop phases. A second
setImmediate tick ensures any FR callbacks that themselves enqueued
further microtasks have fully resolved. Measured on Node 22: 100/100
registrations settle on round 0 with double-tick when targets are
truly unreachable.

## Dashboard model owns exactly 2 signals

Ghost-safe budget: logVersion (bumps on every event push, subscribers
re-read the ring buffer) and filterKind (holds the active kind filter).
No signal is created per event, per kernel, or per log entry. The ring
buffer is a plain pre-allocated array. Verified by signalCount() and
tested in the ghost-safety suite.

## Exit-code precedence: evidence beats settlement state

The gate's original branch order could classify a run with audit
findings but an unsettled FR as exit 3 (inconclusive). That inverts the
semantics: a finding is CONFIRMED evidence, and "recapture" must never
downgrade it. The precedence is now explicit: leaks or findings -> 1;
otherwise unsettled -> 3; otherwise 0. Regression-tested with a pinned
target (FR can never settle) plus an orphan timer (guaranteed finding).

## Kernel teardown is try/finally, in both the gate and verify

Kernels patch process-global surfaces (setTimeout, EventTarget
prototype, AbortController). If the gated function or a specimen's
inject() throws and teardown is skipped, the patches leak into every
subsequent test in the process -- a leak inside the leak tooling. Both
createLeakGate().run() and verify() now uninstall unconditionally.

## verify() throws without --expose-gc for needsSettle specimens

The old behavior silently skipped settlement, so raw-fr in a plain
Node run reported its expected leak as "missing" -- a detection FAIL
that was really an environment error. verify() now throws with the
same message contract as settleFinalizers(). Pre-FR specimens
(needsSettle: false) are unaffected and run in browsers.

## Dashboard entries format lazily

The formatters are documented cold-path ("never per-event in hot
loops"), yet the model originally called formatReport() eagerly inside
pushEntry() -- multi-line string assembly on the event path during
warning storms. text / ownerPath / label are now memoized getters:
one small entry object per event, formatting deferred to first read
(render time, behind the panel's frame mask), computed at most once.

## Dashboard log is a sliding window over the newest entries

The original renderLog painted entries[0..pool), i.e. the OLDEST pool
of entries; once the model outgrew the row pool the panel froze on
stale events forever. The window now anchors to the end. Row clicks
resolve through the current window offset (pool index closures bound
at init -- no per-render dataset writes).
