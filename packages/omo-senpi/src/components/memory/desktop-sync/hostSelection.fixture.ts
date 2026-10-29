import { PassThrough } from "node:stream"
import { isMainThread, MessageChannel, type MessagePort, parentPort, Worker, workerData } from "node:worker_threads"
import { accountSourceFromSelection } from "../device-session/selected-account-source"
import type { DesktopSyncAccount } from "../device-session/account-source"
import type { DesktopSyncEngineWire } from "./desktopSyncAccount"
import type { DesktopSyncEvent, DesktopSyncRequest } from "./desktopSyncProtocol"
import {
  type DesktopSyncAttachment, MEMORY_SYNC_WORKER_DATA, memorySyncWorkerData, selectHostMemorySyncSource, workerMemorySyncSource,
} from "./hostSelection"

// An engine process in miniature, wired the way senpi provideSessionWorkerData hands each session Worker its value:
// the main thread selects once; each Worker gets workerData.extensionData[name] plus its transfers; dispose on exit.
// Usage: bun hostSelection.fixture.ts <desktop|declared-null|unparseable|cli|no-port|throwing|malformed|late|hang>

type Report = {
  readonly source: string
  readonly cliBuilt: boolean
  readonly handle?: string
  readonly foreignEnd?: string
  readonly events?: readonly string[]
}

async function inWorker(): Promise<void> {
  const port = Reflect.get(Object(Reflect.get(Object(workerData), "extensionData")), MEMORY_SYNC_WORKER_DATA) as MessagePort | undefined
  let cliBuilt = false
  let wire: DesktopSyncEngineWire | undefined
  const source = accountSourceFromSelection({
    selection: () => workerMemorySyncSource(port),
    cli: () => { cliBuilt = true; return async () => null },
    openAccount: async opened => { wire = opened; return { kind: "desktop", isCurrent: async () => true } as unknown as DesktopSyncAccount },
  })
  const account = await source()
  const kind = account === null ? "null" : account.kind === "unavailable" ? `unavailable:${account.reason}` : account.kind
  if (wire === undefined) {
    parentPort?.postMessage({ report: { source: kind, cliBuilt } satisfies Report })
    return
  }
  const channel = wire
  const events: string[] = []
  channel.onEvent((event: DesktopSyncEvent) => { if (event.event !== "retired") events.push(event.handle) })
  const began = await channel.request({ op: "operationBegin" }) as { handle: string }
  parentPort?.postMessage({ began: began.handle })
  const foreign = await new Promise<string>(resolve => parentPort?.once("message", (message: { foreign: string }) => resolve(message.foreign)))
  const foreignEnd = await channel.request({ op: "operationEnd", handle: foreign }).then(() => "admitted", () => "refused")
  await channel.request({ op: "capability" })
  parentPort?.postMessage({ report: { source: kind, cliBuilt, handle: began.handle, foreignEnd, events } satisfies Report })
}

async function inMain(scenario: string): Promise<void> {
  let claims = 0
  let handles = 0
  let ends = 0
  let allEnded = () => {}
  const ended = new Promise<void>(resolve => { allEnded = resolve })
  const lifetime = new AbortController()
  const listeners = new Set<(event: DesktopSyncEvent) => void>()
  const issued: string[] = []
  const channel: DesktopSyncEngineWire = {
    signal: lifetime.signal,
    close: () => lifetime.abort(),
    onEvent: listener => { listeners.add(listener); return () => listeners.delete(listener) },
    request: async (request: DesktopSyncRequest) => {
      if (request.op === "operationBegin") { handles += 1; issued.push(`h-${handles}`); return { handle: `h-${handles}` } }
      if (request.op === "operationEnd") { ends += 1; if (ends === handles) allEnded(); return {} }
      for (const handle of issued) for (const listener of listeners) listener({ event: "advanced", child: "c", handle, head: 1 })
      return {}
    },
  }
  let releaseAttach = () => {}
  const attachGate = new Promise<void>(resolve => { releaseAttach = resolve })
  const host = scenario === "no-port" || scenario === "malformed" ? undefined : selectHostMemorySyncSource({
    inherited: {
      declared: name => { if (scenario === "throwing") throw new Error("stub failure"); return name === "memory-sync" && ["desktop", "declared-null", "late", "hang"].includes(scenario) },
      tablePresent: () => scenario !== "cli",
      take: name => { claims += 1; return ["desktop", "late", "hang"].includes(scenario) && name === "memory-sync" ? new PassThrough() : undefined },
    },
    ...(scenario === "hang" ? { attachDeadlineMs: 500 } : {}),
    attach: async (stream): Promise<DesktopSyncAttachment> => {
      if (scenario === "late") await attachGate
      if (scenario === "hang") await new Promise(() => {})
      return stream === undefined ? { kind: "unavailable", reason: "private_channel_unavailable" } : { kind: "connected", channel }
    },
  })
  const workers: Worker[] = []
  const spawn = () => {
    let entry: { value: unknown; transfer: readonly MessagePort[]; dispose(): void } | undefined
    if (host !== undefined) entry = memorySyncWorkerData(host)()
    if (scenario === "malformed") {
      const { port1, port2 } = new MessageChannel()
      port1.postMessage({ kind: "outcome", outcome: "cli", extra: true })
      entry = { value: port2, transfer: [port2], dispose: () => port1.close() }
    }
    const worker = new Worker(new URL(import.meta.url), {
      workerData: entry === undefined ? {} : { extensionData: { [MEMORY_SYNC_WORKER_DATA]: entry.value } },
      transferList: entry === undefined ? [] : [...entry.transfer],
    })
    worker.once("exit", () => entry?.dispose())
    workers.push(worker)
    return worker
  }
  // The team-core lock observer shares this port with sideband registrations; take only this fixture's messages.
  const next = <T>(worker: Worker, key: string) => new Promise<T>((resolve, reject) => {
    const onMessage = (message: unknown) => {
      if (typeof message !== "object" || message === null || !(key in message)) return
      worker.off("message", onMessage)
      resolve(Reflect.get(message, key) as T)
    }
    worker.on("message", onMessage)
    worker.once("error", reject)
  })
  const a = spawn()
  const b = spawn()
  const desktop = ["desktop", "late"].includes(scenario)
  if (desktop) {
    const beganA = next<string>(a, "began")
    const beganB = next<string>(b, "began")
    if (scenario === "late") releaseAttach()
    const [ha, hb] = await Promise.all([beganA, beganB])
    a.postMessage({ foreign: hb })
    b.postMessage({ foreign: ha })
  }
  const reports = await Promise.all([next<Report>(a, "report"), next<Report>(b, "report")])
  await Promise.all(workers.map(worker => worker.terminate()))
  // Worker exit closes each port; the host must then cancel and end the handles that port opened.
  if (desktop) await Promise.race([ended, new Promise(resolve => setTimeout(resolve, 10_000))])
  process.stdout.write(`${JSON.stringify({ scenario, claims, ends, reports })}\n`)
  process.exit(0)
}

if (isMainThread) await inMain(process.argv[2] ?? "")
else await inWorker()
