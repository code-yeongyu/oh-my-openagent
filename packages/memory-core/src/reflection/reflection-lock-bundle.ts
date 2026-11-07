// Entry of the `omo doctor` bundle (script/build-reflection-lock.ts): the shared lock decision and the reaper.
// Every export here is consumed by packages/omo-native/bin/lib/doctor-reflection-lock.js through the generated
// reflection-lock.generated.js, which knip cannot trace back to this file, so each one is tagged @public.
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
export { sweepIdentityOrphanWorktrees } from "./identity-orphan-sweep"
