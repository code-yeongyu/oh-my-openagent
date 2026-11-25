import type { GatewayStore } from "../../../packages/omo-senpi/src/components/thread/gateway/store"
import type { StoreExtensionResult } from "../../../packages/omo-senpi/src/components/thread/gateway/store-extensions"
import type { Recorder } from "./recorder"

// The gateway store port over one recorder. Only the members the P1b cores reach are faked: the extension channel
// (store.register_extension {name, migrations: <count>, wakeDir?, sessionCallable?}, store.extension_call {name, op,
// args}) and the lifetime members. Any other member throws, naming itself, so a core that starts using one shows up as a
// failed run instead of a silent pass. A stated `{ code }` is the store's refusal with that code.

const answer = (result: unknown, fallback: unknown): StoreExtensionResult<never> => {
  const code = Reflect.get(Object(result), "code")
  if (typeof code === "string") return { kind: "refused", code: code as never, message: `fake store refused: ${code}` }
  return { kind: "ok", value: (result ?? fallback) as never }
}

export function storePort(recorder: Recorder, now: () => number): GatewayStore {
  const faked: Partial<GatewayStore> = {
    busyTimeoutMs: 0,
    now,
    registerStoreExtension: async (extension) => {
      const { result } = recorder.record("store", "register_extension", {
        name: extension.name,
        migrations: extension.migrations.length,
        ...(extension.wakeDir === undefined ? {} : { wakeDir: extension.wakeDir }),
        ...(extension.sessionCallable === undefined ? {} : { sessionCallable: extension.sessionCallable }),
      })
      return answer(result, { version: 1 })
    },
    extensionCall: async (name, op, args) => {
      const { result } = recorder.record("store", "extension_call", { name, op, args: args as never })
      return answer(result, null)
    },
    dispose: async () => undefined,
  }
  return new Proxy(faked as GatewayStore, {
    get: (target, key, receiver) => {
      if (Reflect.has(target, key) || typeof key === "symbol" || key === "then")
        return Reflect.get(target, key, receiver)
      return () => {
        throw new Error(`fake store: ${key} is not faked; a scenario that reaches it needs this fake extended`)
      }
    },
  })
}
