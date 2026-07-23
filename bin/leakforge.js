#!/usr/bin/env node
/**
 * @zakkster/lite-leakforge -- bin/leakforge.js
 *
 * The `leakforge` executable. Thin: it re-execs itself with --expose-gc when
 * needed (the leak gate requires manual GC), dispatches to the testable core
 * in Cli.js, writes any --json artifact, and maps the result to a process exit
 * code. All logic worth testing lives in Cli.js.
 *
 * Copyright (c) 2026 Zahary Shinikchiev <shinikchiev@yahoo.com>
 * MIT License
 */

import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';

import { VERSION } from '../Leakforge.js';
import {
  parseArgs,
  loadSuite,
  runSuite,
  renderSuiteReport,
  suiteReportToJson,
  buildBaseline,
  compareBaseline,
  renderBaselineReport,
  builtinSpecimens,
  runSpecimens,
  renderSpecimenReport,
  specimenReportToJson,
  USAGE,
  EXIT_USAGE,
  EXIT_ERROR,
  EXIT_CLEAN,
  EXIT_LEAK,
} from './Cli.js';

// --help/--version never run the gate, so don't pay for a subprocess.
const rawArgs = process.argv.slice(2);
const wantsInfoOnly = rawArgs.some(function (a) {
  return a === '--help' || a === '-h' || a === '--version' || a === '-v';
});

// The gate needs manual GC. If we were not launched with --expose-gc, re-exec
// ourselves once with it (guarded by an env flag so a still-gc-less child does
// not loop) and forward the child's exit code.
if (!wantsInfoOnly && typeof globalThis.gc !== 'function' && process.env.LEAKFORGE_GC !== '1') {
  const self = fileURLToPath(import.meta.url);
  const child = spawnSync(
    process.execPath,
    ['--expose-gc', self].concat(process.argv.slice(2)),
    {
      stdio: 'inherit',
      env: Object.assign({}, process.env, { LEAKFORGE_GC: '1' }),
    }
  );
  process.exit(child.status === null ? EXIT_USAGE : child.status);
}

/**
 * Write a --json artifact, reporting a write failure loudly instead of letting
 * it crash into the top-level catch as a usage error after the report already
 * printed CLEAN. Returns true on success, false on failure.
 * @private
 */
function writeArtifact(path, json) {
  try {
    writeFileSync(path, JSON.stringify(json, null, 2) + '\n');
    return true;
  } catch (err) {
    process.stderr.write(
      'leakforge: could not write --json artifact to "' + path + '": ' +
      (err && err.message ? err.message : String(err)) + '\n'
    );
    return false;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) { process.stdout.write(USAGE + '\n'); return 0; }
  if (args.version) { process.stdout.write('leakforge ' + VERSION + '\n'); return 0; }
  if (args.error !== null) {
    process.stderr.write('error: ' + args.error + '\n\n' + USAGE + '\n');
    return EXIT_USAGE;
  }

  if (args.mode === 'specimens') {
    const specimens = builtinSpecimens(args.specimens);
    const report = await runSpecimens(specimens);
    process.stdout.write(renderSpecimenReport(report) + '\n');
    if (args.json !== null) {
      const ok = writeArtifact(args.json, specimenReportToJson(report, VERSION));
      if (!ok) return EXIT_ERROR;
    }
    return report.exitCode;
  }

  if (args.suite === null) {
    process.stderr.write('error: no suite file given\n\n' + USAGE + '\n');
    return EXIT_USAGE;
  }
  const suite = await loadSuite(args.suite);
  const report = await runSuite(suite);

  // --update-baseline: write the current clusters as the new baseline and stop.
  // A run that leaks is still recorded -- the point of a baseline is to capture
  // the current state, whatever it is.
  if (args.updateBaseline) {
    if (args.baseline === null) {
      process.stderr.write('error: --update-baseline requires --baseline <path>\n');
      return EXIT_USAGE;
    }
    const ok = writeArtifact(args.baseline, buildBaseline(report, VERSION));
    if (!ok) return EXIT_ERROR;
    process.stdout.write('Wrote baseline to ' + args.baseline + '\n');
    return EXIT_CLEAN;
  }

  // --baseline: gate on regressions against the saved baseline only.
  if (args.baseline !== null) {
    let baseline;
    try {
      baseline = JSON.parse(readFileSync(args.baseline, 'utf8'));
    } catch (err) {
      // Fail closed: without a readable baseline we cannot decide what is new,
      // so we do not silently pass.
      process.stderr.write(
        'leakforge: could not read baseline "' + args.baseline + '": ' +
        (err && err.message ? err.message : String(err)) + '\n' +
        'Create one first: leakforge ' + args.suite + ' --baseline ' +
        args.baseline + ' --update-baseline\n'
      );
      return EXIT_ERROR;
    }
    let comparison;
    try {
      comparison = compareBaseline(report, baseline);
    } catch (err) {
      process.stderr.write('leakforge: ' + (err && err.message ? err.message : String(err)) + '\n');
      return EXIT_ERROR;
    }
    process.stdout.write(renderBaselineReport(report, comparison) + '\n');
    if (args.json !== null) {
      const ok = writeArtifact(args.json, suiteReportToJson(report, VERSION));
      if (!ok) return EXIT_ERROR;
    }
    return comparison.regressed ? EXIT_LEAK : EXIT_CLEAN;
  }

  process.stdout.write(renderSuiteReport(report, { group: args.group }) + '\n');
  if (args.json !== null) {
    const ok = writeArtifact(args.json, suiteReportToJson(report, VERSION));
    if (!ok) return EXIT_ERROR;
  }
  return report.exitCode;
}

main()
  .then(function (code) { process.exit(code); })
  .catch(function (err) {
    // A crash here is a runtime failure -- a suite that failed to import, a
    // loader error -- not a malformed command line (that is caught in
    // parseArgs and returns EXIT_USAGE). No trustworthy verdict was produced,
    // so it is inconclusive/recapture, not usage.
    process.stderr.write('leakforge: ' + (err && err.message ? err.message : String(err)) + '\n');
    process.exit(EXIT_ERROR);
  });
