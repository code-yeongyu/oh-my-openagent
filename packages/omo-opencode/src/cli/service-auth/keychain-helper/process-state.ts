import type { HelperAccess } from "./access"
import type { ApprovalCache } from "./approval-cache"

/**
 * The state design 3.2 and 3.6 require once per PROCESS: the Bun.secrets queue and interaction switch, the approval
 * cache, the helper candidates and their resolution, and the prompt locks this process holds. The store is bundled
 * separately into more than one sidecar loaded in one process, so module state would give each copy its own; one
 * record on globalThis under a registered symbol is shared by every copy. The ".v1" suffix keeps a future change of
 * this record's shape from being read by an older copy.
 */
export type KeychainProcessState = {
  secretsQueue: Promise<unknown>
  interactionSwitch: ((allowed: boolean) => void) | null | undefined
  approvalCache: ApprovalCache | undefined
  readonly entryCandidates: string[]
  helperAccess: Promise<HelperAccess> | undefined
  readonly heldPromptLocks: Set<string>
}

const KEY = Symbol.for("omo.keychain-helper.process.v1")

export function keychainProcessState(): KeychainProcessState {
  const holder = globalThis as { [KEY]?: KeychainProcessState }
  holder[KEY] ??= {
    secretsQueue: Promise.resolve(),
    interactionSwitch: undefined,
    approvalCache: undefined,
    entryCandidates: [],
    helperAccess: undefined,
    heldPromptLocks: new Set(),
  }
  return holder[KEY]
}
