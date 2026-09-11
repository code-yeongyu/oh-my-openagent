export type KibitzerTaskRuntime = typeof import("#omo-task-runtime")

/** The bare specifier `plugin/package.json` maps to `./extensions/omo-task.js`; named as the primed asset. */
export const KIBITZER_TASK_RUNTIME_ASSET = "#omo-task-runtime"

/**
 * `#omo-task-runtime` lives in the same mutable install tree as the persona assets: a global install
 * replaces it in place and the omob launcher rebuilds and prunes runtime dirs. One process-level
 * promise makes the registration prime the module's first and only load; a fire awaits that same
 * promise instead of resolving the specifier against whatever the tree holds by then. A rejected
 * import is not kept, so a repaired tree recovers without a restart (memory-core's persona cache
 * follows the same rule).
 */
export function createTaskRuntimeLoader<T>(importer: () => Promise<T>): () => Promise<T> {
  let loading: Promise<T> | undefined
  return () => {
    if (loading === undefined) {
      const pending: Promise<T> = importer().catch((error: unknown) => {
        if (loading === pending) loading = undefined
        throw error
      })
      loading = pending
    }
    return loading
  }
}

export const loadKibitzerTaskRuntime: () => Promise<KibitzerTaskRuntime> = createTaskRuntimeLoader(() => import("#omo-task-runtime"))
