/** Compatibility export surface for memory-usage consumers. */
export {
  incrementMemoryUsage,
  readMemoryUsageLedger,
  memoryUsagePaths,
  type MemoryUsageLedger,
  type MemoryUsageLedgerPath,
  type MemoryUsageEntry,
} from "./memory-usage-ledger"
export { extractMemoryUsagePath, MemoryUsageTracker } from "./memory-usage-tracker"
export {
  registerMemoryUsage,
  type MemoryUsageOptions,
} from "./memory-usage-wiring"
