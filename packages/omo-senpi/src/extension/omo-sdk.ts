import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { createOmoSdk as createRoot, type OmoSdk, type OmoSdkOptions } from "../components/omo-sdk"
import { storeWorkerAnchor } from "../components/thread/gateway/store-worker-sidecar"

export * from "../components/omo-sdk"

declare const OMO_SENPI_PACKAGE_VERSION: string
export const SDK_VERSION = typeof OMO_SENPI_PACKAGE_VERSION === "undefined" ? "dev" : OMO_SENPI_PACKAGE_VERSION

/**
 * Built to `plugin/runtime/omo-sdk/sdk.js`, two levels below the `extensions/` directory that holds the store worker
 * sidecar, so the root's thread store runs on that sidecar as the shipped thread SDK's does. Resolved when a root is
 * built, never when the entry loads. The directory is joined as a path: a literal `new URL("...", import.meta.url)` is
 * an asset reference to the bundler, which would emit it as a second output.
 */
export function createOmoSdk(options: OmoSdkOptions = {}): OmoSdk {
  if (options.threads?.workerModuleUrl !== undefined) return createRoot(options)
  const workerModuleUrl = storeWorkerAnchor(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "extensions"))
  return createRoot(
    workerModuleUrl === undefined ? options : { ...options, threads: { ...options.threads, workerModuleUrl } },
  )
}
