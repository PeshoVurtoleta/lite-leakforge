/**
 * @zakkster/lite-leakforge
 * Type declarations for the leak diagnostic toolkit.
 */

// -----------------------------------------------------------------
// Core
// -----------------------------------------------------------------

export declare const VERSION: string;

// -----------------------------------------------------------------
// Harness
// -----------------------------------------------------------------

export interface SettleResult {
  settled: boolean;
  rounds: number;
  remaining: number;
}

export interface SettleOptions {
  check: () => number;
  target?: number;
  maxRounds?: number;
  pressureKB?: number;
}

export declare function settleFinalizers(options: SettleOptions): Promise<SettleResult>;

export interface SettleTrackerOptions {
  expectedSize?: number;
  maxRounds?: number;
  pressureKB?: number;
}

export declare function settleTracker(tracker: any, options?: SettleTrackerOptions): Promise<SettleResult>;

export interface GateResult {
  exitCode: number;
  clean: boolean;
  leaks: any[];
  warnings: any[];
  findings: any[];
  settleResult: SettleResult;
}

export interface GateOptions {
  name?: string;
  installTimerKernel?: boolean;
  installListenerKernel?: boolean;
  installAsyncKernel?: boolean;
  extraKernels?: any[];
  maxRounds?: number;
  pressureKB?: number;
  /** Pass-through to createLeakTracker. Default true. */
  captureStacks?: boolean;
}

export interface LeakGate {
  run(fn: (tracker: any) => void): Promise<GateResult>;
  EXIT_CLEAN: number;
  EXIT_LEAK: number;
  EXIT_INCONCLUSIVE: number;
}

export declare function createLeakGate(options?: GateOptions): LeakGate;
export declare function assertNoLeaks(fn: (tracker: any) => void, options?: GateOptions): Promise<GateResult>;
export declare function leakSuite(
  describe: Function,
  it: Function,
  name: string,
  fn: (measure: (name: string, testFn: (tracker: any) => void) => void) => void,
  options?: GateOptions
): void;

export declare const EXIT_CLEAN: 0;
export declare const EXIT_LEAK: 1;
export declare const EXIT_INCONCLUSIVE: 3;

// -----------------------------------------------------------------
// Formatters
// -----------------------------------------------------------------

export interface OwnerFrame {
  id: number;
  kind: string;
}

export declare function formatOwnerPath(path: OwnerFrame[] | null, brokenAt?: number): string;
export declare function formatReport(report: any): string;
export declare function formatFinding(finding: any): string;
export declare function formatWarning(warning: any): string;

export interface SummaryGroup {
  kind: string;
  reason: string | null;
  count: number;
  first: any;
}

export declare function summarize(events: any[]): SummaryGroup[];
export declare function formatSummary(groups: SummaryGroup[]): string;
export declare function formatVerifyResult(result: VerifyResult): string;

// -----------------------------------------------------------------
// Specimens
// -----------------------------------------------------------------

export interface ExpectedEvent {
  kind: string;
  reason?: string;
  tag?: unknown;
}

export interface Specimen {
  name: string;
  kernels: () => any[];
  expectedLeaks?: ExpectedEvent[];
  expectedWarnings?: ExpectedEvent[];
  expectedFindings?: ExpectedEvent[];
  needsSettle?: boolean;
  inject: (tracker: any) => void;
  release: () => void;
}

export interface ChannelResult {
  pass: boolean;
  expected: ExpectedEvent[];
  actual: any[];
  missing: ExpectedEvent[];
  unexpected: any[];
}

export interface VerifyResult {
  pass: boolean;
  specimen: string;
  leaks: ChannelResult;
  warnings: ChannelResult;
  findings: ChannelResult;
  settleResult: SettleResult | null;
}

export interface ComposeResult {
  pass: boolean;
  results: VerifyResult[];
  passed: number;
  failed: number;
}

export interface VerifyOptions {
  maxRounds?: number;
  pressureKB?: number;
}

export declare function verify(specimen: Specimen, options?: VerifyOptions): Promise<VerifyResult>;
export declare function composeScenario(specimens: Specimen[], options?: VerifyOptions): Promise<ComposeResult>;

export declare function createRawFrSpecimen(): Specimen;
export declare function createTimerOrphanSpecimen(): Specimen;
export declare function createListenerOrphanSpecimen(): Specimen;
export declare function createObserverOrphanSpecimen(): Specimen;
export declare function createDetachedDomSpecimen(): Specimen;
export declare function createAsyncRetentionSpecimen(): Specimen;
/**
 * Specimen for lite-leak's raf-orphan kernel (1.1.0): a requestAnimationFrame
 * loop scheduled with no owner. Emits a `no-owner-set` warning at schedule
 * time and a `no-owner-loop-armed` finding at audit time. Pre-FR channels only
 * (needsSettle false); uses a specimen-local rAF host, so it needs no DOM and
 * patches no global. Requires @zakkster/lite-leak >= 1.1.0.
 */
export declare function createRafOrphanSpecimen(): Specimen;
export declare function createWorkerOrphanSpecimen(): Specimen;
export declare function createAudioNodeSpecimen(): Specimen;
export declare function createSocketOrphanSpecimen(): Specimen;

// -----------------------------------------------------------------
// Panels
// -----------------------------------------------------------------

export declare const CHANNEL_LEAK: 'leak';
export declare const CHANNEL_WARNING: 'warning';
export declare const CHANNEL_FINDING: 'finding';
export declare const CHANNEL_ERROR: 'error';

export interface LogEntry {
  channel: string;
  kind: string;
  reason: string | null;
  /** Lazy memoized: formatted multi-line ASCII, computed on first read. */
  readonly text: string;
  /** Lazy memoized: formatted owner path, computed on first read. */
  readonly ownerPath: string;
  /** Lazy memoized: compact one-line label for log rows. */
  readonly label: string;
  raw: any;
  ts: number;
}

export interface KernelDescriptor {
  name: string;
  patchSurfaces: string[];
  priority: number;
  hasRefine: boolean;
  hasAudit: boolean;
  hasAdvise: boolean;
}

export interface OwnerInspection {
  formatted: string;
  path: OwnerFrame[] | null;
  brokenAt: number | undefined;
  depth: number;
  kind: string | null;
}

export interface DashboardModelOptions {
  logCapacity?: number;
}

export interface DashboardModel {
  onLeak(report: any): void;
  onWarning(warning: any): void;
  onFinding(finding: any): void;
  onError(err: any, tag: any): void;
  getEntries(options?: { applyFilter?: boolean }): LogEntry[];
  getRecent(n?: number, options?: { applyFilter?: boolean }): LogEntry[];
  logVersion: { peek(): number; set(v: number): void };
  filterKind: { peek(): string | null; set(v: string | null): void };
  snapshotKernels(kernels: any[]): KernelDescriptor[];
  inspectOwnerPath(entry: LogEntry | null): OwnerInspection;
  signalCount(): number;
  readonly count: number;
  readonly capacity: number;
  reset(): void;
}

export declare function createDashboardModel(options?: DashboardModelOptions): DashboardModel;

// -----------------------------------------------------------------
// Dashboard DOM
// -----------------------------------------------------------------

export interface DashboardDOMOptions {
  container: any;
  model: DashboardModel;
  sink?: any;
  kernels?: any[];
  maxLogRows?: number;
  className?: string;
}

export interface DashboardDOM {
  updateKernels(kernels: any[]): void;
  /** Force an immediate render outside the rAF throttle (test/debug). */
  flush(): void;
  dispose(): void;
  _poolSize(): number;
  _visibleRows(): number;
  _windowStart(): number;
  _rowText(i: number): string;
}

export declare function createDashboard(options: DashboardDOMOptions): DashboardDOM;
