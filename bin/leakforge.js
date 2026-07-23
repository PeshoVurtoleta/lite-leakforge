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
import { writeFileSync } from 'node:fs';

import { VERSION } from '../Leakforge.js';
import {
  parseArgs,
  loadSuite,
  runSuite,
  renderSuiteReport,
  suiteReportToJson,
  builtinSpecimens,
  runSpecimens,
  renderSpecimenReport,
  specimenReportToJson,
  USAGE,
  EXIT_USAGE,
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
      writeFileSync(args.json, JSON.stringify(specimenReportToJson(report, VERSION), null, 2) + '\n');
    }
    return report.exitCode;
  }

  if (args.suite === null) {
    process.stderr.write('error: no suite file given\n\n' + USAGE + '\n');
    return EXIT_USAGE;
  }
  const suite = await loadSuite(args.suite);
  const report = await runSuite(suite);
  process.stdout.write(renderSuiteReport(report, { group: args.group }) + '\n');
  if (args.json !== null) {
    writeFileSync(args.json, JSON.stringify(suiteReportToJson(report, VERSION), null, 2) + '\n');
  }
  return report.exitCode;
}

main()
  .then(function (code) { process.exit(code); })
  .catch(function (err) {
    process.stderr.write('leakforge: ' + (err && err.message ? err.message : String(err)) + '\n');
    process.exit(EXIT_USAGE);
  });
