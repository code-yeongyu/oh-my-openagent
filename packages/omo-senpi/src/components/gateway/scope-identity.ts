import { join } from "node:path"
import { resolveMemoryIdentity, sanitizeToSlug, shortHash } from "@oh-my-opencode/memory-core"

export function resolveScopeMemoryIdentity(scope: string, memoryIdentity: string, memoryHome: string, cwd: string) {
  const root = join(memoryHome, "gateway-scopes", `${sanitizeToSlug(scope)}-${shortHash(scope)}`)
  // The qualified source also keeps the adapter's per-identity runtimes distinct.
  return resolveMemoryIdentity(JSON.stringify([scope, memoryIdentity]), cwd, { OMO_MEMORY_HOME: root })
}
