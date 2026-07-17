import type { HookDeps } from "./types"

export function isRuntimeFallbackActive(deps: HookDeps): boolean {
  return deps.isLifecycleActive?.() !== false
}
