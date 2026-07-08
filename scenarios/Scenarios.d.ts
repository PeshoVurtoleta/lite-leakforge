/**
 * @zakkster/lite-leakforge -- scenarios subpath types.
 */
export {
  verify, composeScenario,
  createRawFrSpecimen, createTimerOrphanSpecimen,
  createListenerOrphanSpecimen, createObserverOrphanSpecimen,
  createDetachedDomSpecimen, createAsyncRetentionSpecimen,
} from '../Leakforge.js';
export type {
  Specimen, ExpectedEvent, ChannelResult, VerifyResult,
  ComposeResult, VerifyOptions,
} from '../Leakforge.js';
