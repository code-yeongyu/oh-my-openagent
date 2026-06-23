import { Mem0L2AdapterError } from "./errors"
import type { Mem0Memory } from "./types"

export interface Mem0ScopeConfig {
  projectId: string
  defaultUserId?: string
}

export function assertMem0MemoryInScope(
  memory: Mem0Memory,
  scope: Mem0ScopeConfig,
  providerExternalId: string,
): void {
  if (isMem0MemoryInScope(memory, scope)) {
    return
  }

  throw new Mem0L2AdapterError(
    `Mem0 memory "${providerExternalId}" is outside configured scope`,
    403,
  )
}

export function isMem0ScopeError(error: unknown): boolean {
  return error instanceof Mem0L2AdapterError && error.statusCode === 403
}

function isMem0MemoryInScope(memory: Mem0Memory, scope: Mem0ScopeConfig): boolean {
  const projectId = readProjectId(memory)
  if (projectId !== scope.projectId) {
    return false
  }

  const userId = typeof memory.user_id === "string" ? memory.user_id : undefined
  if (scope.defaultUserId) {
    return userId === scope.defaultUserId
  }

  return typeof userId === "string" && userId.startsWith(`${scope.projectId}:`)
}

function readProjectId(memory: Mem0Memory): string | undefined {
  const projectId = memory.metadata?.project_id
  return typeof projectId === "string" ? projectId : undefined
}
