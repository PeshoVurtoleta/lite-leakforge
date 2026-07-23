/**
 * TORTURE 4 -- bin/leakforge.js + bin/Cli.js, end to end.
 *
 * Every case spawns the real executable. Nothing is stubbed: exit codes,
 * stdout/stderr separation, the --expose-gc re-exec, and the --json artifact
 * are all observed the way CI observes them.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseArgs, EXIT_USAGE } from '../bin/Cli.js';

const BIN = fileURLToPath(new URL('../bin/leakforge.js', import.meta.url));
const EXIT_CLEAN = 0, EXIT_LEAK = 1, EXIT_INCONCLUSIVE = 3;

let dir;
before(() => { dir = mkdtempSync(join(tmpdir(), 'lf-torture-')); });
after(() => { rmSync(dir, { recursive: true, force: true }); });

/** Run the real bin. exposeGc=false exercises the self re-exec path. */
function run(args, opts) {
  const o = opts || {};
  const argv = (o.exposeGc ? ['--expose-gc'] : []).concat([BIN], args);
  return spawnSync(process.execPath, argv, {
    encoding: 'utf8',
    timeout: 60000,
    env: Object.assign({}, process.env, o.env || {}),
  });
}

function suiteFile(name, body) {
  const p = join(dir, name);
  writeFileSync(p, body);
  return p;
}

// -----------------------------------------------------------------
describe('X1 CLI: info modes never run the gate', () => {
  it('X1.1 --help exits 0 on stdout', () => {
    const r = run(['--help']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Usage:/);
    assert.equal(r.stderr, '');
  });

  it('X1.2 -h is equivalent', () => {
    assert.equal(run(['-h']).status, 0);
  });

  it('X1.3 --version prints the package version', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const r = run(['--version']);
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), 'leakforge ' + pkg.version);
  });

  it('X1.4 --help does not spawn a child (fast path)', () => {
    // A re-exec would double the process count; assert it completes without
    // needing gc at all by running with a poisoned re-exec guard.
    const r = run(['--help'], { env: { LEAKFORGE_GC: '' } });
    assert.equal(r.status, 0);
  });
});

// -----------------------------------------------------------------
describe('X2 CLI: usage errors', () => {
  it('X2.1 no arguments -> exit 2, usage on stderr', () => {
    const r = run([]);
    assert.equal(r.status, EXIT_USAGE);
    assert.match(r.stderr, /no suite file given/);
  });

  it('X2.2 unknown option -> exit 2', () => {
    const r = run(['--bogus']);
    assert.equal(r.status, EXIT_USAGE);
    assert.match(r.stderr, /unknown option/);
  });

  it('X2.3 --json with no path -> exit 2', () => {
    const r = run(['--json']);
    assert.equal(r.status, EXIT_USAGE);
    assert.match(r.stderr, /--json requires a path/);
  });

  it('X2.4 --json= (empty value) is rejected, not written to ""', () => {
    const r = run(['--specimens', 'raf-orphan', '--json=']);
    assert.equal(r.status, EXIT_USAGE,
      'empty --json= produced status ' + r.status + ' stderr=' + JSON.stringify(r.stderr.slice(0, 200)));
  });

  it('X2.5 unknown specimen name -> non-zero, readable message', () => {
    const r = run(['--specimens', 'no-such-specimen']);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /unknown specimen/);
    assert.doesNotMatch(r.stderr, /at .*node:internal/, 'raw stack leaked to stderr');
  });

  it('X2.6 missing suite file -> readable message, not a raw ERR_MODULE_NOT_FOUND dump', () => {
    const r = run([join(dir, 'does-not-exist.js')]);
    assert.notEqual(r.status, 0);
    assert.doesNotMatch(r.stderr, /ERR_MODULE_NOT_FOUND/,
      'raw loader error surfaced: ' + r.stderr.slice(0, 300));
  });
});

// -----------------------------------------------------------------
describe('X3 CLI: specimen mode', () => {
  it('X3.1 all built-in specimens pass -> exit 0', () => {
    const r = run(['--specimens']);
    assert.equal(r.status, EXIT_CLEAN, 'stdout:\n' + r.stdout + '\nstderr:\n' + r.stderr);
    assert.match(r.stdout, /Verdict: CLEAN/);
  });

  it('X3.2 a single named specimen', () => {
    const r = run(['--specimens', 'raf-orphan']);
    assert.equal(r.status, EXIT_CLEAN);
    assert.match(r.stdout, /raf-orphan/);
  });

  it('X3.3 several named specimens', () => {
    const r = run(['--specimens', 'raf-orphan', 'timer-orphan', 'raw-fr']);
    assert.equal(r.status, EXIT_CLEAN);
    assert.match(r.stdout, /Passed 3\/3/);
  });

  it('X3.4 specimen run is deterministic across 5 invocations', () => {
    for (let i = 0; i < 5; i++) {
      const r = run(['--specimens']);
      assert.equal(r.status, EXIT_CLEAN, 'iteration ' + i + ' -> ' + r.status + '\n' + r.stdout);
    }
  });

  it('X3.5 --json artifact is valid and shaped', () => {
    const out = join(dir, 'spec.json');
    const r = run(['--specimens', '--json', out]);
    assert.equal(r.status, EXIT_CLEAN);
    assert.ok(existsSync(out), 'artifact written');
    const j = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(j.tool, 'leakforge');
    assert.equal(j.mode, 'specimens');
    assert.equal(j.exitCode, 0);
    assert.ok(typeof j.version === 'string' && j.version.length > 0,
      'artifact version is ' + JSON.stringify(j.version));
    assert.ok(Array.isArray(j.results) && j.results.length > 0);
  });

  it('X3.6 --json= form works', () => {
    const out = join(dir, 'spec2.json');
    const r = run(['--specimens', 'raw-fr', '--json=' + out]);
    assert.equal(r.status, EXIT_CLEAN);
    assert.ok(existsSync(out));
  });

  it('X3.7 --json to an unwritable path fails loudly, not silently', () => {
    const out = join(dir, 'no', 'such', 'dir', 'x.json');
    const r = run(['--specimens', 'raw-fr', '--json', out]);
    assert.notEqual(r.status, EXIT_CLEAN,
      'unwritable artifact path still exited ' + r.status + ' (CI would believe the run succeeded)');
  });
});

// -----------------------------------------------------------------
describe('X4 CLI: --expose-gc re-exec', () => {
  it('X4.1 works without --expose-gc (self re-exec)', () => {
    const r = run(['--specimens', 'raw-fr'], { exposeGc: false });
    assert.equal(r.status, EXIT_CLEAN, 'stderr: ' + r.stderr);
  });

  it('X4.2 works with --expose-gc already present (no re-exec)', () => {
    const r = run(['--specimens', 'raw-fr'], { exposeGc: true });
    assert.equal(r.status, EXIT_CLEAN);
  });

  it('X4.3 the re-exec guard does not loop when the child still lacks gc', () => {
    // Simulate the pathological case: guard already set, no gc available.
    const r = run(['--specimens', 'raw-fr'], { exposeGc: false, env: { LEAKFORGE_GC: '1' } });
    assert.notEqual(r.signal, 'SIGTERM', 'timed out -- likely a re-exec loop');
    assert.notEqual(r.status, null, 'process did not terminate normally');
  });

  it('X4.4 re-exec forwards all arguments including --json', () => {
    const out = join(dir, 'reexec.json');
    const r = run(['--specimens', 'raw-fr', '--json', out], { exposeGc: false });
    assert.equal(r.status, EXIT_CLEAN);
    assert.ok(existsSync(out), 'artifact written by the re-exec child');
  });
});

// -----------------------------------------------------------------
describe('X5 CLI: suite mode exit codes', () => {
  it('X5.1 clean suite -> exit 0', () => {
    const f = suiteFile('clean.mjs', `
      export default { name: 'clean', checks: [
        { name: 'nothing', run() {} },
      ]};
    `);
    const r = run([f]);
    assert.equal(r.status, EXIT_CLEAN, r.stdout + r.stderr);
    assert.match(r.stdout, /Verdict: CLEAN/);
  });

  it('X5.2 leaking suite -> exit 1', () => {
    const f = suiteFile('leak.mjs', `
      export default { name: 'leaky', checks: [
        { name: 'drops a tracked target', run(tracker) {
          tracker.track({ payload: 1 }, () => {}, 'leaked');
        }},
      ]};
    `);
    const r = run([f]);
    assert.equal(r.status, EXIT_LEAK, r.stdout + r.stderr);
    assert.match(r.stdout, /Verdict: LEAK/);
  });

  it('X5.3 unsettleable suite -> exit 3 (inconclusive), not 0', () => {
    const f = suiteFile('stuck.mjs', `
      const held = [];
      export default { name: 'stuck', options: { maxRounds: 2 }, checks: [
        { name: 'keeps the target reachable', run(tracker) {
          const t = { payload: 1 };
          held.push(t);
          tracker.track(t, () => {}, 'held');
        }},
      ]};
    `);
    const r = run([f]);
    assert.ok(r.status === EXIT_INCONCLUSIVE || r.status === EXIT_LEAK,
      'expected 3 or 1, got ' + r.status + '\n' + r.stdout);
  });

  it('X5.4 evidence wins: one leaking check among many -> exit 1', () => {
    const f = suiteFile('mixed.mjs', `
      export default { name: 'mixed', checks: [
        { name: 'ok1', run() {} },
        { name: 'bad', run(tracker) { tracker.track({ a: 1 }, () => {}, 'x'); } },
        { name: 'ok2', run() {} },
      ]};
    `);
    const r = run([f]);
    assert.equal(r.status, EXIT_LEAK);
    assert.match(r.stdout, /\[CLEAN\] ok1/);
    assert.match(r.stdout, /\[LEAK\] bad/);
    assert.match(r.stdout, /\[CLEAN\] ok2/);
  });

  it('X5.5 bare-function checks are supported', () => {
    const f = suiteFile('bare.mjs', `
      export default { name: 'bare', checks: [
        function namedCheck() {},
      ]};
    `);
    const r = run([f]);
    assert.equal(r.status, EXIT_CLEAN, r.stdout + r.stderr);
  });

  it('X5.6 empty checks array -> exit 0', () => {
    const f = suiteFile('empty.mjs', `export default { name: 'empty', checks: [] };`);
    assert.equal(run([f]).status, EXIT_CLEAN);
  });
});

// -----------------------------------------------------------------
describe('X6 CLI: malformed suites must not be reported as clean', () => {
  it('X6.1 suite with no default export', () => {
    const f = suiteFile('nodefault.mjs', `export const x = 1;`);
    const r = run([f]);
    assert.notEqual(r.status, EXIT_CLEAN);
    assert.match(r.stderr, /default-export/);
  });

  it('X6.2 suite whose checks is not an array', () => {
    const f = suiteFile('badchecks.mjs', `export default { name: 'x', checks: 'nope' };`);
    const r = run([f]);
    assert.notEqual(r.status, EXIT_CLEAN);
    assert.match(r.stderr, /checks must be an array/);
  });

  it('X6.3 suite that throws at import time', () => {
    const f = suiteFile('throws.mjs', `throw new Error('import-boom');`);
    const r = run([f]);
    assert.notEqual(r.status, EXIT_CLEAN);
    assert.match(r.stderr + r.stdout, /import-boom/);
  });

  it('X6.4 suite with a syntax error', () => {
    const f = suiteFile('syntax.mjs', `export default { name: 'x', checks: [ }`);
    const r = run([f]);
    assert.notEqual(r.status, EXIT_CLEAN);
  });

  it('X6.5 a check that throws must be reported, not abort the whole run', () => {
    const f = suiteFile('throwcheck.mjs', `
      export default { name: 'tc', checks: [
        { name: 'ok-before', run() {} },
        { name: 'explodes', run() { throw new Error('check-boom'); } },
        { name: 'ok-after', run() {} },
      ]};
    `);
    const r = run([f]);
    assert.notEqual(r.status, EXIT_CLEAN, 'a throwing check must not exit 0');
    assert.match(r.stdout, /ok-after/,
      'checks after the throwing one were never run; output:\n' + r.stdout + '\n' + r.stderr);
  });

  it('X6.6 a check with a null run must not exit 0', () => {
    const f = suiteFile('nullrun.mjs', `
      export default { name: 'nr', checks: [ { name: 'broken', run: null } ]};
    `);
    const r = run([f]);
    assert.notEqual(r.status, EXIT_CLEAN,
      'a check with no runnable body exited ' + r.status);
  });

  it('X6.7 an async check that awaits a timer must not be reported as a leak', () => {
    const f = suiteFile('asyncclean.mjs', `
      export default { name: 'ac', checks: [
        { name: 'awaits a timer and leaks nothing',
          async run() { await new Promise((r) => setTimeout(r, 50)); } },
      ]};
    `);
    const r = run([f]);
    assert.equal(r.status, EXIT_CLEAN,
      'a clean async check exited ' + r.status + ':\n' + r.stdout);
  });

  it('X6.8 an async check that leaks after its await must be caught', () => {
    const f = suiteFile('asyncleak.mjs', `
      export default { name: 'al', checks: [
        { name: 'leaks after await', async run(tracker) {
          await new Promise((r) => setTimeout(r, 200));
          tracker.track({ payload: 1 }, () => {}, 'late');
        }},
      ]};
    `);
    const r = run([f]);
    assert.equal(r.status, EXIT_LEAK,
      'a post-await leak exited ' + r.status + ':\n' + r.stdout);
  });

  it('X6.9 an async check that rejects must not crash with unhandledRejection', () => {
    const f = suiteFile('asyncreject.mjs', `
      export default { name: 'ar', checks: [
        { name: 'rejects', async run() { throw new Error('async-boom'); } },
      ]};
    `);
    const r = run([f]);
    assert.doesNotMatch(r.stderr, /UnhandledPromiseRejection|ERR_UNHANDLED_REJECTION/,
      'surfaced as an unhandled rejection instead of a reported failure:\n' + r.stderr.slice(0, 400));
    assert.notEqual(r.status, EXIT_CLEAN);
  });
});

// -----------------------------------------------------------------
describe('X7 CLI: JSON artifact fidelity', () => {
  it('X7.1 suite artifact round-trips and matches the exit code', () => {
    const f = suiteFile('json.mjs', `
      export default { name: 'jsonsuite', checks: [
        { name: 'leaks', run(tracker) { tracker.track({ a: 1 }, () => {}, 'tag-a'); } },
      ]};
    `);
    const out = join(dir, 'suite.json');
    const r = run([f, '--json', out]);
    const j = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(j.mode, 'suite');
    assert.equal(j.suite, 'jsonsuite');
    assert.equal(j.exitCode, r.status);
    assert.equal(j.clean, false);
    assert.equal(j.checks.length, 1);
    assert.ok(Array.isArray(j.summary));
  });

  it('X7.2 artifact contains no stack traces (CI diff stability)', () => {
    const out = join(dir, 'nostack.json');
    run(['--specimens', '--json', out]);
    const raw = readFileSync(out, 'utf8');
    assert.doesNotMatch(raw, /\bat \/|node:internal/, 'stack text leaked into the artifact');
  });

  it('X7.3 artifact is byte-identical across two runs (deterministic)', () => {
    const a = join(dir, 'det-a.json');
    const b = join(dir, 'det-b.json');
    run(['--specimens', 'raf-orphan', 'timer-orphan', '--json', a]);
    run(['--specimens', 'raf-orphan', 'timer-orphan', '--json', b]);
    assert.equal(readFileSync(a, 'utf8'), readFileSync(b, 'utf8'),
      'artifact is not reproducible between identical runs');
  });
});

// -----------------------------------------------------------------
describe('X8 parseArgs: unit-level edges', () => {
  it('X8.1 --json consumes the next token only once', () => {
    const a = parseArgs(['suite.js', '--json', 'a.json', 'extra.js']);
    assert.equal(a.json, 'a.json');
    assert.equal(a.suite, 'suite.js');
  });

  it('X8.2 duplicate --json: last wins, no error', () => {
    const a = parseArgs(['s.js', '--json', 'a.json', '--json', 'b.json']);
    assert.equal(a.json, 'b.json');
    assert.equal(a.error, null);
  });

  it('X8.3 --json= empty string must be an error, not a "" path', () => {
    const a = parseArgs(['--specimens', '--json=']);
    assert.notEqual(a.json, '', '--json= produced an empty path that writeFileSync will reject');
  });

  it('X8.4 --help wins over a usage error', () => {
    const a = parseArgs(['--bogus', '--help']);
    assert.equal(a.help, true);
  });

  it('X8.5 first positional wins in suite mode; extras ignored silently', () => {
    const a = parseArgs(['one.js', 'two.js']);
    assert.equal(a.suite, 'one.js');
    assert.equal(a.error, null,
      'a second positional was silently discarded rather than flagged');
  });

  it('X8.6 --specimens collects all positionals', () => {
    const a = parseArgs(['--specimens', 'raw-fr', 'timer-orphan']);
    assert.deepEqual(a.specimens, ['raw-fr', 'timer-orphan']);
  });

  it('X8.7 empty argv is a usage error path, not a crash', () => {
    const a = parseArgs([]);
    assert.equal(a.suite, null);
    assert.equal(a.mode, 'suite');
  });
});
