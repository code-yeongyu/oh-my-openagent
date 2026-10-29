// Capture the real inherited table before loading the component or any test support.
import { privateChannelDeclared } from "@code-yeongyu/senpi/private-fds"
import { provideSessionWorkerData, sessionWorkerDataRegistry } from "@code-yeongyu/senpi/session-worker-data"
import { mock } from "bun:test"
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads"
import type { DeviceAccountSource } from "./device-session/account-source"
import { createDeviceSessionResolver } from "./device-session/resolver"
import { wireSyncRpc } from "./sync-rpc-wiring"
import { MEMORY_SYNC_WORKER_DATA } from "./desktop-sync/hostSelection"
import { MemoryFakeExtensionAPI, componentContext, loadedMemoryConfig, memorySettings } from "./memory.test-support"

const scenario = isMainThread ? process.argv[2] : Reflect.get(Object(workerData), "scenario")
let cliBuilt = 0
let resolverSource: DeviceAccountSource | undefined
let rpcSource: Parameters<typeof wireSyncRpc>[0]["source"] | undefined
const resolveSession = createDeviceSessionResolver
const registerRpc = wireSyncRpc
mock.module("./device-session/account-runtime-loader", () => ({
  lazyCliAccountSource: () => {
    cliBuilt += 1
    if (scenario !== "cli") throw new Error("desktop registration constructed the CLI source")
    return async () => null
  },
}))
mock.module("./device-session/resolver", () => ({
  createDeviceSessionResolver: (options: Parameters<typeof createDeviceSessionResolver>[0]) => {
    resolverSource = options.source
    return resolveSession(options)
  },
}))
mock.module("./sync-rpc-wiring", () => ({
  wireSyncRpc: (options: Parameters<typeof wireSyncRpc>[0]) => {
    rpcSource = options.source
    return registerRpc(options)
  },
}))

const { createMemoryComponent } = await import("./index")
class RegistrationApi extends MemoryFakeExtensionAPI {
  override rpc = { emit() {}, handle() {} }
}
function register(override = false): void {
  const pi = new RegistrationApi()
  const source: DeviceAccountSource = async () => ({ kind: "unavailable", reason: "selection_failed" })
  createMemoryComponent({
    env: { OMO_MEMORY_HOME: process.env.TMPDIR },
    loadConfig: () => loadedMemoryConfig(memorySettings()),
    sweepTransientRuns: async () => ({ removedRuns: 0, removedIdentities: 0, promoted: 0, stranded: 0, kept: 0 }),
    ...(override ? { deviceAccount: source } : {}),
  }).register(pi, componentContext())
  if (override && resolverSource !== source) throw new Error("deviceAccount override lost")
}

async function report(): Promise<unknown> {
  register(scenario === "override")
  if (resolverSource === undefined || rpcSource !== resolverSource) throw new Error("resolver and RPC did not receive one source")
  const account = await resolverSource()
  // Repeated component registration must reuse the bootstrap rather than provide the name twice.
  register(scenario === "override")
  return {
    source: account === null ? "null" : account.kind === "unavailable" ? `unavailable:${account.reason}` : account.kind,
    cliBuilt,
    declared: privateChannelDeclared("memory-sync"),
    sharedSource: true,
  }
}

if (isMainThread && scenario === "provider-throw") {
  provideSessionWorkerData(MEMORY_SYNC_WORKER_DATA, () => ({ value: undefined }))
  try {
    register()
    throw new Error("registration swallowed the provider failure")
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("already provided")) throw error
    process.stdout.write(`${JSON.stringify({ error: error.message, cliBuilt })}\n`)
  }
} else if (isMainThread && (scenario === "worker-absent" || scenario === "worker-desktop")) {
  if (scenario === "worker-desktop") register()
  const start = (extensionData: Readonly<Record<string, unknown>>, transferList: readonly import("node:worker_threads").Transferable[]) =>
    new Worker(new URL(import.meta.url), { workerData: { scenario, extensionData }, transferList: [...transferList] })
  const issued = scenario === "worker-desktop" ? sessionWorkerDataRegistry.spawn(data => start(data.extensionData, data.transfer)) : undefined
  const worker = issued?.result ?? start({}, [])
  try {
    const result = await new Promise<unknown>((resolve, reject) => {
      worker.on("message", message => {
        if (typeof message === "object" && message !== null && "report" in message) resolve(message.report)
      })
      worker.once("error", reject)
      worker.once("exit", code => { if (code !== 0) reject(new Error(`worker exited ${code}`)) })
    })
    process.stdout.write(`${JSON.stringify(result)}\n`)
  } finally {
    await worker.terminate()
    issued?.issued.dispose()
  }
} else {
  const result = await report()
  if (isMainThread) process.stdout.write(`${JSON.stringify(result)}\n`)
  else parentPort?.postMessage({ report: result })
}
if (isMainThread) process.exit(0)
