import { existsSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

/** The store worker's file name beside the built extension bundle (`plugin/extensions/`). */
export const GATEWAY_STORE_WORKER_BUNDLE_NAME = "gateway-store-worker.mjs"

/**
 * The location a store that runs outside `omo.js` resolves its worker from: `<extensionsDir>/omo.js` when that
 * directory holds the `gateway-store-worker.mjs` sidecar (a bundler cannot inline a Worker's entry), else undefined, and
 * the store resolves `store-worker.ts` itself (source). Every shipped entry that is not `omo.js` (the thread SDK, the
 * omo SDK root, the `omo` CLI) names its plugin's extensions directory here.
 */
export function storeWorkerAnchor(extensionsDir: string): URL | undefined {
  return existsSync(join(extensionsDir, GATEWAY_STORE_WORKER_BUNDLE_NAME))
    ? pathToFileURL(join(extensionsDir, "omo.js"))
    : undefined
}
