import type { NewSessionOptions } from "@code-yeongyu/senpi"
import type { RpcRunnerSpec } from "./types"

export function rpcChildAncestry(spec: RpcRunnerSpec): NewSessionOptions["spawnedBy"] {
  if (spec.parent_session_id === undefined) return undefined
  return {
    parentSessionId: spec.parent_session_id,
    rootSessionId: spec.root_session_id ?? spec.parent_session_id,
    taskId: spec.task_id,
  }
}
