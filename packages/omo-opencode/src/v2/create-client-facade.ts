import type { PluginInput } from "@opencode-ai/plugin"
import { V2UnsupportedOperationError } from "./unsupported-operation-error"

type V1Client = PluginInput["client"]

const NOT_THENABLE_KEYS: ReadonlySet<string> = new Set(["then", "toJSON", "constructor"])

function unsupportedPath(path: readonly string[]): unknown {
  return new Proxy(function unsupportedOperation(): void {}, {
    get(_target, property) {
      if (typeof property === "symbol" || NOT_THENABLE_KEYS.has(property)) return undefined
      return unsupportedPath([...path, property])
    },
    apply() {
      return Promise.reject(new V2UnsupportedOperationError(path.join(".")))
    },
  })
}

/**
 * The V1 SDK client shape the plugin body is written against. Every namespace the V2 adapter has
 * not mapped yet resolves to a path-tracking stub that rejects with the exact operation name, so a
 * gap fails loudly at the call site instead of returning silently empty data.
 */
export function createClientFacade(): V1Client {
  return unsupportedPath(["client"]) as V1Client
}
