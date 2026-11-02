import type { KernelToolGrant } from "./resolve"

/**
 * The parent engine's RUNTIME-ONLY kernel-tool capability map, keyed by child task id or pool id.
 *
 * Nothing here is ever persisted: a binding lives exactly as long as this process's parent kernel
 * does. It deliberately SURVIVES idle parking (a parked child revived into the same live parent must
 * reach the same closures) and is dropped on deliberate destruction, record expunge and parent
 * shutdown, so a disposed kernel keeps no strong reference. A new host process starts with an empty
 * map, which is what makes a revived child's old tool fail closed instead of re-binding.
 */
export type KernelToolBindingRegistry = {
  bind(key: string, grant: KernelToolGrant): void
  get(key: string): KernelToolGrant | undefined
  release(key: string): void
  releaseAll(): void
  keys(): readonly string[]
  readonly size: number
}

export function createKernelToolBindings(): KernelToolBindingRegistry {
  const bindings = new Map<string, KernelToolGrant>()
  return {
    bind: (key, grant) => {
      bindings.set(key, grant)
    },
    get: (key) => bindings.get(key),
    release: (key) => {
      bindings.delete(key)
    },
    releaseAll: () => bindings.clear(),
    keys: () => [...bindings.keys()],
    get size() {
      return bindings.size
    },
  }
}
