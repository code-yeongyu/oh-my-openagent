import type * as ExternalProjectionModule from "./external-projection"

export type ExternalProjectionRenderer = typeof ExternalProjectionModule

export type ExternalProjectionRendererLoad =
  | { readonly renderer: ExternalProjectionRenderer }
  | { readonly unavailable: string }

export const EXTERNAL_PROJECTION_RENDERER_FIX =
  "omo was likely updated while this process was running (the runtime keeps the package manifest it read at start), "
  + "so restart omo and fully quit the desktop app; if a fresh start still fails, reinstall omo-ai"

export const EXTERNAL_PROJECTION_WARNING_CODE = "OMO_MEMORY_PROJECTION_RENDERER_UNAVAILABLE"

/**
 * The `<external_projection>` renderer is a lazy sidecar (`#memory-external-projection`). A failed import must not
 * reject the memory compile: the block is compiled without the listing and marked degraded. Failures are not cached,
 * so the next compile retries; the warning naming the fix is emitted once per loader.
 */
export function createExternalProjectionRendererLoader(
  importRenderer: () => Promise<ExternalProjectionRenderer>,
  warn: (message: string) => void = (message) => process.emitWarning(message, { code: EXTERNAL_PROJECTION_WARNING_CODE }),
): () => Promise<ExternalProjectionRendererLoad> {
  let warned = false
  return async () => {
    try {
      return { renderer: await importRenderer() }
    } catch (error) {
      const cause = error instanceof Error ? error.message.split("\n")[0] : String(error)
      const unavailable = `<external_projection> renderer unavailable (${cause}); ${EXTERNAL_PROJECTION_RENDERER_FIX}`
      if (!warned) {
        warned = true
        warn(`omo memory: ${unavailable}`)
      }
      return { unavailable }
    }
  }
}

export const loadExternalProjectionRenderer = createExternalProjectionRendererLoader(() => import("#memory-external-projection"))
