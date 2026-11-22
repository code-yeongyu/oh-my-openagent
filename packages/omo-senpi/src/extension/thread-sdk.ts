import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { GATEWAY_STORE_WORKER_BUNDLE_NAME } from "../components/thread/gateway/store"
import { createAccountRemoteSurface } from "../components/thread/remote/default-remote"
import {
  assertThreadSdkOptions,
  createThreadSdk as createSdk,
  type ThreadSdk,
  type ThreadSdkOptions,
} from "../components/thread/sdk"

export type { LocatedThread, ThreadSdk, ThreadSdkOptions } from "../components/thread/sdk"
// `omo host status --all` stamps each terminal row's `last_activity_at` with the same reader `omo thread list` uses.
export { readSessionFacts } from "../components/thread/session-facts"

/**
 * Built to `plugin/runtime/thread-sdk/sdk.js`, two levels below the `extensions/` directory that
 * holds the store worker sidecar; a bundler cannot inline a Worker's entry, so the store is pointed
 * at that sidecar. From source no sidecar is there and the store resolves `store-worker.ts` itself.
 * The anchor is joined as a path: a literal `new URL("...", import.meta.url)` is an asset reference
 * to the bundler, which would emit it as a second output.
 */
const sidecarAnchor = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "extensions", "omo.js"))
const sidecarPresent = existsSync(fileURLToPath(new URL(`./${GATEWAY_STORE_WORKER_BUNDLE_NAME}`, sidecarAnchor)))

declare const OMO_SENPI_PACKAGE_VERSION: string
const VERSION = typeof OMO_SENPI_PACKAGE_VERSION === "undefined" ? "0.0.0" : OMO_SENPI_PACKAGE_VERSION

/**
 * The shipped SDK reads the whole account like the agent's thread tools: a caller that passes no `remote` (a connector,
 * a monitor script) gets the account surface over this device's device service, as principal `cli:<uid>`, and
 * `dispose()` closes it (#14616). The `omo thread` CLI passes its own.
 */
export function createThreadSdk(options: ThreadSdkOptions): ThreadSdk {
  assertThreadSdkOptions(options)
  const remote =
    options.remote ??
    createAccountRemoteSurface({
      version: VERSION,
      sender: { kind: "cli", uid: String(options.uid) },
      env: options.env ?? process.env,
      cwd: options.cwd,
    })
  return createSdk({
    ...options,
    remote,
    ...(options.workerModuleUrl !== undefined || !sidecarPresent ? {} : { workerModuleUrl: sidecarAnchor }),
  })
}
