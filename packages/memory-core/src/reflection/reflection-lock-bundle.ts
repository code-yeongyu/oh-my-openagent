// Entry of the `omo doctor` bundle (script/build-reflection-lock.ts): the shared lock decision, the reaper,
// and the runtime size measure the size cap acts on (#10144).
// Every export here is consumed by packages/omo-native/bin/lib/doctor-reflection-lock.js and doctor-memory-runtime.js
// through the generated reflection-lock.generated.js, which knip cannot trace back to this file, so each one is tagged @public.
/** @public */
export { classifyReflectionLockHolder } from "./stale-holder"
/** @public */
export {
  decideStaleReflectionLock,
  decideStrandedRun,
  formatStaleLockFixLines,
  reclaimDeadOwnerLocks,
  runStaleLockReaper,
} from "./stale-lock-reaper"
/** @public */
export { sweepHostIdentities } from "./host-sweep"
/** @public */
export { createRetentionHostSweepStep } from "../retention/host-step"
/** @public */
export { sweepIdentityOrphanWorktrees } from "./identity-orphan-sweep"
/** @public */
export {
  DEFAULT_RUNTIME_MAX_BYTES,
  formatRuntimeBytes,
  measureRuntimeSizeWithinBudget,
  runtimeSizeStanding,
} from "../retention/size"
/** @public */
export { describeRuntimeCapExcess, measureRuntimeCapEvictableBytes } from "../retention/cap"
/** @public */
export { buildIdentityPaths } from "../identity/layout"
/** @public */
export { measureUnreflectedJournalBytes } from "../retention/past-retention"
/** @public */
export { DEFAULT_RUNTIME_RETENTION } from "../retention/policy"
