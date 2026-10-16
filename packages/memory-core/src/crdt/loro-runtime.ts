/// <reference path="./loro-wasm.d.ts" />

import { dirname, isAbsolute, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { readFile } from "../fs/resilient"
import type { Container, ContainerID, ContainerType, LoroDoc, PeerID, Value } from "loro-crdt"

import wasmPath from "loro-crdt/bundler/loro_wasm_bg.wasm" with { type: "file" }

// Type-only re-export: consumers take Loro/Container types from this loader so the loader
// stays the only module that names "loro-crdt" (loro-runtime-packaging.test.ts enforces it).
export type { ContainerID, ContainerType, LoroDoc, PeerID }

/**
 * The sync engine's single Loro entry point. The stock `loro-crdt` bundler entry locates
 * `loro_wasm_bg.wasm` through `import.meta.url` and fetches it, which has no meaningful URL
 * inside a `bun build --compile` binary ($bunfs) or the desktop engine host bundle. Importing
 * the wasm with the `file` loader makes Bun embed the asset into every bundle and compiled
 * binary at build time. The emitted path is absolute in dev and inside a compiled binary, but
 * RELATIVE to the output file in a plain `bun build` bundle, so the loader anchors a relative
 * path to its own module dir — never to the process cwd, which is arbitrary in a bundle.
 *
 * The instantiation mirrors the package's own finalize sequence (`loro-crdt/bundler/loro_wasm.js`):
 * hand the exports to the glue through `__wbg_set_wasm`, then run `__wbindgen_start` when present.
 * There is deliberately no fallback path: a Loro that cannot initialize fails loudly here, since
 * memory merges must never silently degrade to a different CRDT.
 *
 * The raw glue module `loro_wasm_bg.js` is a process-wide singleton: `__wbg_set_wasm` retargets
 * the wasm memory behind every Loro class at once. Any other import of `loro-crdt` (any entry
 * point) runs the package's own instantiation with its own wasm bytes and swaps that memory under
 * every live doc, so this loader is the ONLY sanctioned loro-crdt importer in the repo —
 * loro-runtime-packaging.test.ts enforces it.
 */

export interface LoroRuntime {
  readonly LoroDoc: typeof LoroDoc
}

type WasmExports = Record<string, unknown>
type WasmImports = NonNullable<Parameters<typeof WebAssembly.instantiate>[1]>
type GlueFunction = (this: unknown, ...args: unknown[]) => unknown

interface LoroWasmGlue extends LoroRuntime {
  readonly __wbg_set_wasm: (exports: WasmExports) => void
  readonly callPendingEvents: () => void
  readonly isValidContainerId: (id: string) => boolean
  readonly EphemeralStoreWasm: { readonly prototype: object }
  readonly UndoManager: { readonly prototype: object }
}

const CALL_PENDING_EVENTS_WRAPPED = Symbol("loro.callPendingEventsWrapped")

// The glue queues doc events inside the wasm and expects JS to drain them: the stock bundler
// entry wraps every mutating method to call `callPendingEvents()` in a finally
// (`loro-crdt/bundler/index.js`). The raw glue skips that wrapping, so without this layer
// subscribe/subscribeLocalUpdates listeners never fire ("[LORO_INTERNAL_ERROR] Event not
// called"). These method lists mirror the bundler entry exactly.
function decorateMethod(prototype: object, method: string, callPendingEvents: () => void): void {
  const descriptor = Object.getOwnPropertyDescriptor(prototype, method)
  if (!descriptor || typeof descriptor.value !== "function") return
  const original = descriptor.value as GlueFunction & { [CALL_PENDING_EVENTS_WRAPPED]?: true }
  if (original[CALL_PENDING_EVENTS_WRAPPED]) return
  const wrapped = function (this: unknown, ...args: unknown[]): unknown {
    let result: unknown
    try {
      result = original.apply(this, args)
      return result
    } finally {
      if (result !== null && typeof (result as { then?: unknown })?.then === "function") {
        void (result as Promise<unknown>).finally(() => {
          callPendingEvents()
        })
      } else {
        callPendingEvents()
      }
    }
  }
  Object.defineProperty(wrapped, CALL_PENDING_EVENTS_WRAPPED, { value: true })
  Object.defineProperty(prototype, method, { ...descriptor, value: wrapped })
}

function decorateMethods(prototype: object, methods: readonly string[], callPendingEvents: () => void): void {
  for (const method of methods) decorateMethod(prototype, method, callPendingEvents)
}

const LORO_DOC_EVENTED_METHODS = [
  "setDetachedEditing",
  "attach",
  "detach",
  "fork",
  "forkAt",
  "checkoutToLatest",
  "checkout",
  "commit",
  "getCursorPos",
  "revertTo",
  "export",
  "exportJsonUpdates",
  "exportJsonInIdSpan",
  "importJsonUpdates",
  "import",
  "importUpdateBatch",
  "importBatch",
  "travelChangeAncestors",
  "getChangedContainersIn",
  "diff",
  "applyDiff",
  "setPeerId",
] as const

const EPHEMERAL_STORE_EVENTED_METHODS = ["set", "delete", "apply", "removeOutdated"] as const
const UNDO_MANAGER_EVENTED_METHODS = ["undo", "redo"] as const

const CONTAINER_TYPES = ["Map", "Text", "List", "Tree", "MovableList", "Counter"]

function isContainerValue(value: unknown): value is Container {
  if (typeof value !== "object" || value === null) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  if (prototype === null || typeof prototype !== "object") return false
  if (typeof (prototype as { kind?: unknown }).kind !== "function") return false
  return CONTAINER_TYPES.includes((value as { kind: () => string }).kind())
}

type JsonReplacer = (key: string | number, value: Value | Container) => Value | Container | undefined

// `toJsonWithReplacer` is a plain-JS extension the bundler entry hangs on LoroDoc.prototype;
// the raw glue does not have it. Ported verbatim from `loro-crdt/bundler/index.js`.
function installToJsonWithReplacer(LoroDocClass: typeof LoroDoc, isContainerId: (id: string) => boolean): void {
  LoroDocClass.prototype.toJsonWithReplacer = function (this: LoroDoc, replacer: JsonReplacer): Value {
    const processed = new Set<string>()
    const doc = this
    const run = (layer: unknown): Value => {
      if (Array.isArray(layer)) {
        return layer
          .map((item, index) => m(index, item))
          .filter((item) => item !== undefined) as Value
      }
      const result: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(layer as Record<string, unknown>)) {
        const answer = m(key, value)
        if (answer !== undefined) result[key] = answer
      }
      return result as Value
    }
    const m = (key: string | number, value: unknown): unknown => {
      if (typeof value === "string") {
        if (isContainerId(value) && !processed.has(value)) {
          processed.add(value)
          const container = doc.getContainerById(value as ContainerID)
          if (container == null) {
            throw new Error(`ContainerID not found: ${value}`)
          }
          const answer = replacer(key, container)
          if (answer === container) {
            const shallow = container.getShallowValue()
            if (typeof shallow === "object") {
              return run(shallow)
            }
            return shallow
          }
          if (isContainerValue(answer)) {
            throw new Error("Using new container is not allowed in toJsonWithReplacer")
          }
          if (typeof answer === "object" && answer !== null) {
            return run(answer)
          }
          return answer
        }
      }
      if (typeof value === "object" && value !== null) {
        return run(value)
      }
      const answer = replacer(key, value as Value)
      if (isContainerValue(answer)) {
        throw new Error("Using new container is not allowed in toJsonWithReplacer")
      }
      return answer
    }
    return run(doc.getShallowValue())
  }
}

// Re-applies every prototype extension the stock bundler entry performs, so docs from this
// loader behave exactly like docs from `import "loro-crdt"`.
function installBundlerParity(glue: LoroWasmGlue): void {
  decorateMethods(glue.LoroDoc.prototype, LORO_DOC_EVENTED_METHODS, glue.callPendingEvents)
  decorateMethods(glue.EphemeralStoreWasm.prototype, EPHEMERAL_STORE_EVENTED_METHODS, glue.callPendingEvents)
  decorateMethods(glue.UndoManager.prototype, UNDO_MANAGER_EVENTED_METHODS, glue.callPendingEvents)
  installToJsonWithReplacer(glue.LoroDoc, glue.isValidContainerId)
}

let pending: Promise<LoroRuntime> | undefined

async function instantiate(): Promise<LoroRuntime> {
  const glue = (await import("loro-crdt/bundler/loro_wasm_bg.js")) as unknown as LoroWasmGlue
  // The import-object key is part of the wasm binary's import section; it must match exactly.
  // import.meta.dir is Bun-only; the senpi bundle loads memory-core under plain Node through jiti.
  const wasmFile = isAbsolute(wasmPath) ? wasmPath : resolve(dirname(fileURLToPath(import.meta.url)), wasmPath)
  const bytes = await readFile(wasmFile)
  const { instance } = await WebAssembly.instantiate(bytes, {
    "./loro_wasm_bg.js": glue,
  } as unknown as WasmImports)
  const exports = instance.exports as WasmExports & { __wbindgen_start?: () => void }
  glue.__wbg_set_wasm(exports)
  if (typeof exports.__wbindgen_start === "function") exports.__wbindgen_start()
  installBundlerParity(glue)
  return glue
}

export function loadLoroRuntime(): Promise<LoroRuntime> {
  pending ??= instantiate()
  return pending
}
