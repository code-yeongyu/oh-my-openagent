import { readFileSync, realpathSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

import type { ShippedTool } from "./legacy.ts"

export type Slot<T> = { readonly ready: T } | { readonly unavailable: string }

export const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null

/** `OMO_BIN` is the `omo` launcher of a global `omo-ai` install; its package root holds the shipped bundle. */
export function shippedBundle(
  env: Readonly<Record<string, string | undefined>>,
): Slot<{ path: string; launcher: string; version: string }> {
  const bin = env.OMO_BIN?.trim()
  if (!bin) return { unavailable: "OMO_BIN is not set to the omo launcher of an installed omo-ai release" }
  let root: string
  let manifest: unknown
  try {
    root = resolve(dirname(realpathSync(bin)), "..")
    manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
  } catch (error) {
    return {
      unavailable: `cannot read the release behind OMO_BIN=${bin}: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
  if (!isRecord(manifest) || manifest.name !== "omo-ai" || typeof manifest.version !== "string")
    return { unavailable: `${root} is not an omo-ai release` }
  return {
    ready: {
      path: join(root, "plugin/extensions/omo-computer-use.js"),
      launcher: join(root, "bin", "omo.js"),
      version: manifest.version,
    },
  }
}

export async function loadShippedTool(): Promise<Slot<ShippedTool>> {
  const bundle = shippedBundle(process.env)
  if ("unavailable" in bundle) return bundle
  // The release's own launcher sets OMO_BIN to its real path before the engine starts, and the engine acquisition
  // reads the release version from it; a symlinked OMO_BIN would fall back to the locator instead.
  process.env.OMO_BIN = bundle.ready.launcher
  const settingsPath = process.env.OMO_RELEASE_SETTINGS?.trim()
  if (!settingsPath)
    return { unavailable: "OMO_RELEASE_SETTINGS is not set to the release tag's computer settings module" }
  const settingsModule: unknown = await import(settingsPath)
  if (!isRecord(settingsModule) || typeof settingsModule.resolveComputerSettings !== "function")
    return { unavailable: `${settingsPath} does not export resolveComputerSettings` }
  const loaded: unknown = await import(bundle.ready.path)
  if (!isRecord(loaded) || typeof loaded.createComputerUseRuntime !== "function")
    return { unavailable: `${bundle.ready.path} does not export createComputerUseRuntime` }
  const runtime: unknown = loaded.createComputerUseRuntime({
    settings: settingsModule.resolveComputerSettings(undefined),
    executeTool: async (name: string) => {
      throw new Error(`tool.${name}() is not available in the conformance baseline`)
    },
    onEngineError: (code: string) => console.error(`legacy engine error: ${code}`),
  })
  const tool = isRecord(runtime) ? runtime.computerTool : undefined
  if (!isRecord(tool) || typeof tool.execute !== "function")
    return { unavailable: `${bundle.ready.path} returned no computer tool` }
  const execute = tool.execute
  return {
    ready: {
      execute: (id, input, context): Promise<unknown> =>
        Promise.resolve(execute(id, input, undefined, undefined, context)),
    },
  }
}
