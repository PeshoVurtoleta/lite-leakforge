/**
 * TORTURE 3 -- formatters/Format.js + panels/DashboardModel.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  summarize, formatSummary, formatReport, formatFinding, formatWarning, formatOwnerPath,
} from '../formatters/Format.js';
import { createDashboardModel } from '../panels/DashboardModel.js';

describe('F1 formatters: hostile events', () => {
  it('F1.1 summarize tolerates null/undefined members', () => {
    assert.doesNotThrow(() => summarize([null, undefined, { kind: 'a' }]));
  });

  it('F1.2 summarize tolerates primitives', () => {
    assert.doesNotThrow(() => summarize([1, 'x', true]));
  });

  it('F1.3 summarize kind/reason collision cannot merge distinct groups', () => {
    // key is kind + "\x00" + reason. An event whose kind embeds the separator
    // must not collide with a different kind/reason pair.
    const g = summarize([
      { kind: 'a\x00b', reason: null },
      { kind: 'a', reason: 'b' },
    ]);
    assert.equal(g.length, 2, 'distinct kind/reason pairs collapsed into ' + g.length + ' group(s)');
  });

  it('F1.4 formatReport with a throwing getter tag', () => {
    const evil = { kind: 'x' };
    Object.defineProperty(evil, 'tag', { get() { throw new Error('nope'); }, enumerable: true });
    assert.doesNotThrow(() => formatReport(evil));
  });

  it('F1.5 formatReport with a BigInt tag', () => {
    assert.doesNotThrow(() => formatReport({ kind: 'x', tag: 10n }));
  });

  it('F1.6 formatOwnerPath with hostile frames', () => {
    assert.doesNotThrow(() => formatOwnerPath([null, undefined, 1, { id: 1, kind: 'e' }]));
  });

  it('F1.7 formatWarning/formatFinding on primitives', () => {
    assert.doesNotThrow(() => { formatWarning('str'); formatFinding(42); });
  });
});

describe('M1 dashboard model: capacity hostility', () => {
  it('M1.1 fractional logCapacity', () => {
    assert.doesNotThrow(() => createDashboardModel({ logCapacity: 2.5 }));
  });
  it('M1.2 Infinity logCapacity', () => {
    assert.doesNotThrow(() => createDashboardModel({ logCapacity: Infinity }));
  });
  it('M1.3 NaN logCapacity falls back to the default', () => {
    const m = createDashboardModel({ logCapacity: NaN });
    assert.equal(m.capacity, 256);
  });
  it('M1.4 huge logCapacity is clamped rather than allocating gigabytes', () => {
    const m = createDashboardModel({ logCapacity: 5e8 });
    assert.ok(m.capacity <= 1 << 20, 'capacity accepted as ' + m.capacity);
  });
});

describe('M2 dashboard model: ring buffer correctness', () => {
  it('M2.1 ordering is oldest-first before overflow', () => {
    const m = createDashboardModel({ logCapacity: 8 });
    for (let i = 0; i < 5; i++) m.onLeak({ kind: 'k' + i });
    const e = m.getEntries();
    assert.deepEqual(e.map((x) => x.kind), ['k0', 'k1', 'k2', 'k3', 'k4']);
  });

  it('M2.2 ordering is oldest-first after overflow (fuzz)', () => {
    for (let cap of [1, 2, 3, 5, 8, 13]) {
      const m = createDashboardModel({ logCapacity: cap });
      const pushed = [];
      for (let i = 0; i < cap * 3 + 1; i++) { m.onLeak({ kind: 'k' + i }); pushed.push('k' + i); }
      const got = m.getEntries().map((x) => x.kind);
      const want = pushed.slice(-cap);
      assert.deepEqual(got, want, 'cap=' + cap);
    }
  });

  it('M2.3 getRecent returns newest-first and respects n', () => {
    const m = createDashboardModel({ logCapacity: 8 });
    for (let i = 0; i < 6; i++) m.onWarning({ kind: 'w' + i });
    assert.deepEqual(m.getRecent(3).map((x) => x.kind), ['w5', 'w4', 'w3']);
  });

  it('M2.4 filter applies to kind, and count is unaffected', () => {
    const m = createDashboardModel({ logCapacity: 16 });
    m.onLeak({ kind: 'a' }); m.onLeak({ kind: 'b' }); m.onLeak({ kind: 'a' });
    m.filterKind.set('a');
    assert.equal(m.getEntries().length, 2);
    assert.equal(m.getEntries({ applyFilter: false }).length, 3);
    assert.equal(m.count, 3);
  });

  it('M2.5 reset clears entries and version', () => {
    const m = createDashboardModel({ logCapacity: 4 });
    for (let i = 0; i < 10; i++) m.onLeak({ kind: 'k' });
    m.reset();
    assert.equal(m.count, 0);
    assert.equal(m.getEntries().length, 0);
    assert.equal(m.logVersion.peek(), 0);
  });

  it('M2.6 logVersion is monotonic across pushes', () => {
    const m = createDashboardModel({ logCapacity: 4 });
    let prev = m.logVersion.peek();
    for (let i = 0; i < 50; i++) {
      m.onFinding({ kind: 'f' });
      const v = m.logVersion.peek();
      assert.ok(v > prev, 'version did not advance at push ' + i);
      prev = v;
    }
  });
});

describe('M3 dashboard model: storm behaviour', () => {
  it('M3.1 100k events do not grow the heap past the ring capacity', () => {
    const m = createDashboardModel({ logCapacity: 256 });
    for (let i = 0; i < 1000; i++) m.onWarning({ kind: 'warm' });
    globalThis.gc();
    const start = process.memoryUsage().heapUsed;
    for (let i = 0; i < 100000; i++) m.onWarning({ kind: 'k', reason: 'r' });
    globalThis.gc();
    const growthMB = (process.memoryUsage().heapUsed - start) / 1048576;
    assert.ok(growthMB < 6, 'heap growth over 100k events: ' + growthMB.toFixed(2) + ' MB');
  });

  it('M3.2 evicted entries are not retained by the ring', async () => {
    const m = createDashboardModel({ logCapacity: 4 });
    // Created inside a helper so no caller-frame binding outlives the loop --
    // V8 can otherwise keep the most recent value alive in a stack slot and
    // make this assertion flaky for reasons that have nothing to do with the
    // ring buffer.
    const refs = (function push() {
      const out = [];
      for (let i = 0; i < 8; i++) {
        const payload = { kind: 'k', blob: new Uint8Array(1 << 20) }; // 1 MB each
        out.push(new WeakRef(payload));
        m.onLeak(payload);
      }
      return out;
    })();
    // Evict every one of the above.
    for (let i = 0; i < 8; i++) m.onLeak({ kind: 'later' });
    for (let i = 0; i < 6; i++) { globalThis.gc(); await new Promise((r) => setImmediate(r)); }
    const alive = refs.filter((r) => r.deref() !== undefined).length;
    assert.equal(alive, 0, alive + '/8 evicted 1MB payloads still retained by the model');
  });

  it('M3.3 lazy text/label getters memoize and stay stable', () => {
    const m = createDashboardModel({ logCapacity: 4 });
    m.onLeak({ kind: 'k', reason: 'r', ownerPath: [{ id: 1, kind: 'effect' }] });
    const e = m.getEntries()[0];
    const t1 = e.text, t2 = e.text;
    assert.equal(t1, t2);
    assert.equal(e.label, e.label);
    assert.ok(e.ownerPath.length > 0);
  });

  it('M3.4 entries survive a non-object event', () => {
    const m = createDashboardModel({ logCapacity: 4 });
    assert.doesNotThrow(() => { m.onLeak(null); m.onWarning('oops'); m.onFinding(42); });
    const e = m.getEntries();
    assert.equal(e.length, 3);
    assert.doesNotThrow(() => e.forEach((x) => { void x.text; void x.label; void x.ownerPath; }));
  });

  it('M3.5 onError records message and tag', () => {
    const m = createDashboardModel({ logCapacity: 4 });
    m.onError(new Error('bad'), 'ctx');
    const e = m.getEntries()[0];
    assert.equal(e.channel, 'error');
    assert.equal(e.raw.message, 'bad');
  });
});
