export { type AtomicClient, type AtomicProcessBinding, createAtomicClient } from "./client"
export type { AtomicHookDispatch } from "./client-agent"
export type { AtomicIntentStatusChange } from "./client-intent"
export type { AtomicCallOptions } from "./client-runner"
export type { AtomicMemoryRequest, AtomicVaultContextRequest } from "./client-vault"
export {
  ATOMIC_HOOK_VERBS,
  type AtomicCompatibility,
  type AtomicHookAgent,
  type AtomicHookVerb,
  type AtomicIntentKind,
  type AtomicIntentStatus,
  type AtomicMemoryKind,
  type AtomicVersion,
} from "./contracts"
export { AtomicError, type AtomicErrorCode } from "./errors"
export { type AtomicProbe, type AtomicProbeOptions, probeAtomic } from "./probe"
export { type AtomicSpawn, type AtomicSpawnOutcome, type AtomicSpawnRequest, spawnAtomicProcess } from "./process"
