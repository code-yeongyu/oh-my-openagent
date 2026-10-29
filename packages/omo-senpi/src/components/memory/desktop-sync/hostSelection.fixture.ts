import { PassThrough } from "node:stream"
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads"
import { accountSourceFromSelection } from "../device-session/selected-account-source"
import type { DesktopSyncAccount } from "../device-session/account-source"
import type { DesktopSyncEngineWire } from "./desktopSyncAccount"
import { selectHostMemorySync, workerMemorySync, type DesktopSyncAttachment } from "./hostSelection"
import type { DesktopSyncEvent, DesktopSyncRequest } from "./desktopSyncProtocol"

// An engine process in miniature: the main thread selects once, then session Workers register memory sync.
// Usage: bun hostSelection.fixture.ts <desktop|declared-null|unparseable|cli|no-host>

type Report = { readonly source: string; readonly cliBuilt: boolean; readonly echo?: unknown; readonly event?: unknown }

async function registerInWorker(): Promise<Report> {
  let cliBuilt = false
  const source = accountSourceFromSelection({
    selection: () => workerMemorySync(Number(workerData.waitMs)),
    cli: () => { cliBuilt = true; return async () => null },
    openAccount: async wire => {
      const event = new Promise<DesktopSyncEvent>(resolve => { const stop = wire.onEvent(e => { stop(); resolve(e) }) })
      const echo = await wire.request({ op: "descriptor" })
      return { kind: "desktop", echo, event: await event, isCurrent: async () => true } as unknown as DesktopSyncAccount
    },
  })
  const account = await source()
  const desktop = account as unknown as { echo?: unknown; event?: unknown } | null
  return { source: account === null ? "null" : account.kind === "unavailable" ? `unavailable:${account.reason}` : account.kind, cliBuilt, echo: desktop?.echo, event: desktop?.event }
}

if (!isMainThread) {
  parentPort?.postMessage(await registerInWorker())
} else {
  const scenario = process.argv[2] ?? ""
  let claims = 0
  const lifetime = new AbortController()
  const listeners = new Set<(event: DesktopSyncEvent) => void>()
  const channel: DesktopSyncEngineWire = {
    signal: lifetime.signal,
    close: () => lifetime.abort(),
    onEvent: listener => { listeners.add(listener); return () => listeners.delete(listener) },
    request: async (request: DesktopSyncRequest) => {
      for (const listener of listeners) listener({ event: "connected", child: "child-1", handle: "h-1", connected: true })
      return { answered: request.op, claims }
    },
  }
  if (scenario !== "no-host") {
    await selectHostMemorySync({
      inherited: {
        declared: name => name === "memory-sync" && (scenario === "desktop" || scenario === "declared-null"),
        tablePresent: () => scenario !== "cli",
        take: name => { claims += 1; return scenario === "desktop" && name === "memory-sync" ? new PassThrough() : undefined },
      },
      attach: async (stream): Promise<DesktopSyncAttachment> =>
        stream === undefined ? { kind: "unavailable", reason: "private_channel_unavailable" } : { kind: "connected", channel },
    })
  }
  const run = () => new Promise<Report>((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: { waitMs: scenario === "no-host" ? 300 : 5_000 } })
    // The team-core lock observer shares this port with sideband registrations; take only this fixture's report.
    const onMessage = (message: unknown) => {
      if (typeof message !== "object" || message === null || !("source" in message)) return
      worker.off("message", onMessage)
      void worker.terminate()
      resolve(message as Report)
    }
    worker.on("message", onMessage)
    worker.once("error", reject)
  })
  const reports = [await run(), await run()]
  process.stdout.write(`${JSON.stringify({ scenario, claims, reports })}\n`)
  process.exit(0)
}
