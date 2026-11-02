import type { RpcChildHandle } from "../runners/types"
import { HOST_RESPAWN_CONTINUATION } from "../runners/rpc-host/reconcile-turn"
import type { TaskRecord } from "../state"
import { isTerminalRecord } from "./manager-helpers"

export async function reconcileDaemonTurn(record: TaskRecord, handle: RpcChildHandle): Promise<void> {
  if (isTerminalRecord(record)) return
  if (handle.reconcileTurn !== undefined) {
    if (await handle.reconcileTurn(record) === "continued") await handle.followUp(HOST_RESPAWN_CONTINUATION)
  }
}
