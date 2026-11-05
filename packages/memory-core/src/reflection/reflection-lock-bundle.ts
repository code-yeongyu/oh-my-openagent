// Entry of the `omo doctor` bundle (script/build-reflection-lock.ts): the shared lock decision and the reaper.
export { classifyReflectionLockHolder } from "./stale-holder"
export {
  decideStaleReflectionLock,
  decideStrandedRun,
  formatStaleLockFixLines,
  reclaimDeadOwnerLocks,
  runStaleLockReaper,
} from "./stale-lock-reaper"
export { sweepHostIdentities } from "./host-sweep"
export { sweepIdentityOrphanWorktrees } from "./identity-orphan-sweep"
