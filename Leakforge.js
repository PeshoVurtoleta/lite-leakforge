/**
 * @zakkster/lite-leakforge
 * Leak specimens, CI harness, and dashboard for @zakkster/lite-leak.
 * Zero-GC diagnostic toolkit.
 *
 * Copyright (c) 2026 Zahary Shinikchiev <shinikchiev@yahoo.com>
 * MIT License
 */

export const VERSION = '1.3.0';

// Harness
export { settleFinalizers, settleTracker } from './harness/Settle.js';
export {
  createLeakGate,
  assertNoLeaks,
  leakSuite,
  EXIT_CLEAN,
  EXIT_LEAK,
  EXIT_INCONCLUSIVE,
} from './harness/Gate.js';

// Formatters
export {
  formatOwnerPath,
  formatReport,
  formatFinding,
  formatWarning,
  formatSummary,
  formatVerifyResult,
  summarize,
} from './formatters/Format.js';

// Panels
export {
  createDashboardModel,
  createDashboard,
  CHANNEL_LEAK,
  CHANNEL_WARNING,
  CHANNEL_FINDING,
  CHANNEL_ERROR,
} from './panels/Panels.js';

// Specimens + contract
export {
  verify,
  composeScenario,
  createRawFrSpecimen,
  createTimerOrphanSpecimen,
  createListenerOrphanSpecimen,
  createObserverOrphanSpecimen,
  createDetachedDomSpecimen,
  createAsyncRetentionSpecimen,
  createRafOrphanSpecimen,
  createWorkerOrphanSpecimen,
  createAudioNodeSpecimen,
  createSocketOrphanSpecimen,
  createGlResourceOrphanSpecimen,
} from './scenarios/Scenarios.js';
