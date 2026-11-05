// The runtime retention pass and the host-sweep slice that memory-maintenance.ts runs when one is due. They
// ship in the memory commands sidecar (commands/runtime.ts) and load through loadMemoryCommandsRuntime, so
// the entry bundle carries only the scheduler. Nothing in the entry bundle may import this module statically.

export {
  createRetentionHostSweepStep,
  runRuntimeRetention,
  summarizeRuntimeRetention,
  sweepHostIdentities,
} from "@oh-my-opencode/memory-core"
