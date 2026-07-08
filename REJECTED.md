# REJECTED.md -- Proposals considered and declined

## Heap-snapshot diffing via node:v8

**Proposal**: Add retained-heap-size delta per specimen using
`v8.writeHeapSnapshot()` or `v8.getHeapStatistics()`. Compare heap
before and after inject/release to detect retained-size growth.

**Rejection**: lite-leak's non-goals explicitly punt memory profiling
to `@zakkster/lite-gc-profiler`. Heap snapshots are a fundamentally
different diagnostic axis -- they measure retained bytes, not ownership
attribution. Importing node:v8 would break the browser-portable subset
of the forge. The forge inherits lite-leak's boundary: it classifies
leak KINDS via kernel refinement, not leak SIZES via heap analysis.

## settleFinalizers with WeakRef polling

**Proposal**: Instead of allocation pressure + gc(), create a WeakRef
to a sentinel object and poll `deref()` until it returns undefined,
confirming GC ran.

**Rejection**: WeakRef.deref() timing is implementation-defined and
can lag behind FinalizationRegistry callback delivery. A WeakRef may
report the sentinel as collected before the FR callback fires, or vice
versa. The pressure + gc() + setImmediate pattern is directly validated
against the tracker's size() -- the actual source of truth -- not a proxy.

## Shared default tracker across specimens

**Proposal**: Run all specimens against a single shared tracker to
test kernel interaction and priority conflicts.

**Rejection**: Specimens must be isolated. A timer-orphan kernel
installed for specimen A would intercept setTimeout calls during
specimen B's inject, producing cross-contaminated warnings. The
verify contract creates a fresh tracker per specimen. Cross-kernel
interaction testing belongs in lite-leak's own test suite, not in
product-level specimens.

## Per-event signal in the dashboard model

**Proposal**: Create a signal per event kind (timerOrphanCount,
listenerOrphanCount, etc.) so downstream effects can subscribe to
individual kinds without filtering.

**Rejection**: The number of event kinds is unbounded (custom kernels
can define arbitrary kinds). Creating a signal per kind would violate
the ghost-safe budget -- the signal count would grow with kernel
registrations. The filterKind signal + getEntries() achieves the same
selectivity with a fixed signal count of 2.

## Built-in throttling in the dashboard model

**Proposal**: Add a built-in 10Hz throttle to logVersion signal writes
so downstream effects don't fire on every event.

**Rejection**: Follows the ecosystem's compose-don't-configure
principle. Users who want throttled downstream can wrap with
`@zakkster/lite-throttle`. Building throttling into the model would
either impose a fixed rate that doesn't suit all use cases or require
configuration surface that duplicates lite-throttle's API.

## Pooled (mutated-in-place) log entry objects

**Proposal**: Pre-allocate `logCapacity` entry objects at model
construction and mutate them in place on push, eliminating the one
entry allocation per event.

**Rejection**: Entries are handed out through getEntries()/getRecent()
and the documented custom-UI path; consumers may retain them (selected
row in an inspector, snapshot in a report). Ring reuse would mutate a
retained entry the moment the buffer wraps -- silent aliasing in a
diagnostic tool whose whole job is trust. The raw event object from
lite-leak is allocated per event regardless, so pooling the thin
wrapper saves one small object while introducing a correctness hazard.
The meaningful cost -- eager formatting -- was removed instead (lazy
memoized getters).
