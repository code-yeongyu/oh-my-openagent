/**
 * Backward-compatible shim: the implementation moved to
 * `../process-sweep/sweeper` (family-based sweep restructure).
 */
export {
  sweepCodegraphZombies,
  type CodegraphSweepAction,
  type SweepCodegraphZombiesOptions,
  type SweepCodegraphZombiesResult,
} from "../process-sweep/sweeper"
