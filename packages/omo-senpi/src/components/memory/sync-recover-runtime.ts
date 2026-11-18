import {
  createRejectionCounter,
  type RecoverOutcome,
  recoverOnFreshDevice,
} from "@oh-my-opencode/memory-core/sync-recovery"
import type { SyncRpcRecoverInput } from "./sync-rpc-ports"

export const recoverSync = (input: SyncRpcRecoverInput): Promise<RecoverOutcome> =>
  recoverOnFreshDevice({
    account: input.account,
    rpId: input.rpId,
    keyring: input.keyring,
    bridge: input.bridge,
    transport: input.chain,
    rejections: createRejectionCounter(),
    stateDir: input.pinDir,
    ...(input.method === undefined ? {} : { method: input.method }),
  })
