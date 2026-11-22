import { readFileSync } from "node:fs"
import type { composeOmoSenpiExtension, omoSenpiComponents } from "../../extension/bundled-index"
import { MemoryFakeExtensionAPI, sessionContext } from "./memory.test-support"
import type { SyncRpcRegistration } from "./sync-rpc-ports"

const rpcSidecar = /[/\\]extensions[/\\]omo-memory-sync-rpc\.js$/
let loads = 0
Bun.plugin({
  name: "packaged-sync-rpc-load-probe",
  setup(build) {
    build.onLoad({ filter: rpcSidecar }, ({ path }) => {
      loads++
      return { contents: readFileSync(path, "utf8"), loader: "js" }
    })
  },
})

const entry = new URL("../../../plugin/extensions/omo.js", import.meta.url)
const built: {
  readonly composeOmoSenpiExtension: typeof composeOmoSenpiExtension
  readonly omoSenpiComponents: typeof omoSenpiComponents
} = await import(entry.href)
const memory = built.omoSenpiComponents.find((component) => component.name === "memory")
if (memory === undefined) throw new Error("The packaged extension is missing memory")

type Handler = Parameters<SyncRpcRegistration["handle"]>[1]
const handlers = new Map<string, Handler>()
class Host extends MemoryFakeExtensionAPI {
  override rpc = {
    emit() {},
    handle(name: string, handler: Handler) {
      handlers.set(name, handler)
    },
  }
}

const host = new Host()
await built.composeOmoSenpiExtension([memory])(host)
const registered = [...handlers.keys()].filter((name) => name.startsWith("omo.memory.sync.")).sort()
const registrationLoads = loads
const session = { ...sessionContext({ cwd: process.cwd() }), hasUI: false }
await host.dispatch("session_start", { type: "session_start" }, session)
const startupLoads = loads
const features = handlers.get("omo.memory.sync.features")
if (features === undefined) throw new Error("Sync features was not eagerly registered")

const context = {
  ownerId: "sync-rpc-probe",
  disconnectSignal: new AbortController().signal,
  admit<T>(dispatch: () => T): T {
    return dispatch()
  },
}
const reply = await features({}, context)
const firstUseLoads = loads
await features({}, context)
const totalLoads = loads
await host.dispatch("session_shutdown", { type: "session_shutdown", reason: "quit" }, session)
console.log(
  `SYNC_RPC_PROBE ${JSON.stringify({ registered, registrationLoads, startupLoads, firstUseLoads, totalLoads, reply })}`,
)
