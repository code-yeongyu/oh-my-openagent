/**
 * Backward-compatible shim: the implementation moved to
 * `../process-sweep/codegraph-family` (family-based sweep restructure).
 * All downstream imports of this module keep working unchanged.
 */
export {
  selectZombieCodegraphProcesses,
  type CodegraphProcessMatchKind,
  type CodegraphZombieProcess,
  type SelectZombieCodegraphProcessesOptions,
} from "../process-sweep/codegraph-family"
export { parsePosixProcessTable, parseWindowsProcessTable, type CodegraphProcessInfo } from "../process-sweep/process-table"
