import { describe, expect, test } from "bun:test"
import { connectDeviceService, LocalApiError, type ConnectDeviceServiceOptions, type JsonObject as WireObject } from "@oh-my-opencode/device-service-core"
import { createDeviceServiceSessions } from "./device-service"
import type { JsonObject, RemoteResync } from "./ports"

type Client = Awaited<ReturnType<NonNullable<ConnectDeviceServiceOptions["connect"]>>>
type Event = Parameters<Parameters<Client["onEvent"]>[0]>[0]
type Held = { readonly seq: number; readonly record: WireObject }

const isResumePoint = (value: unknown): value is { readonly attach_id: number; readonly seq: number } =>
  typeof value === "object" && value !== null && typeof Reflect.get(value, "attach_id") === "number" && typeof Reflect.get(value, "seq") === "number"

const RUNNING = { isStreaming: true, currentTurnId: "t1", durableSessionId: "dur-1" }

// relayd's viewer for one remote session another local client keeps attached, over the local API (relay daemon #782):
// it holds the attachment's snapshot (`attachId`) and every record since, each with its stream seq. A session.attach is
// answered, then gets the held snapshot and records replayed; one whose `resume` names the held attach_id gets only the
// records after its seq. `resume: false` is a relayd before #782: either field is invalid_request and no seqs are sent.
// `replay`: "history" lands the replay in the attach before the watch listens, "live" after it (relayd sends the replay
// after the answer, in the same socket read or a later one; the later read is modelled as the next macrotask).
function fakeRelayd(options: { readonly resume: boolean; readonly replay: "history" | "live" }) {
  const held: Held[] = []
  const locals = new Map<string, { readonly emit: (event: Event) => void; readonly seqs: boolean }>()
  const attaches: WireObject[] = []
  const connections: Array<() => void> = []
  const adopted: Array<() => void> = []
  let attachId = 3
  let whileHeld: (() => void) | undefined
  let failNext = false
  const recordsEvent = (attach: string, records: readonly Held[], seqs: boolean): Event => ({ type: "event", kind: "session.records", attach, attach_id: attachId, records: records.map((held) => held.record), ...(seqs ? { seqs: records.map((held) => held.seq) } : {}) })
  const snapshotEvent = (attach: string): Event => ({ type: "event", kind: "session.snapshot", attach, attach_id: attachId, cursor: { marker_id: "m", last_entry_id: null }, state: { durableSessionId: "dur-1" }, entries: [], history_truncated: false, oldest_entry_id: null })
  const host = (...records: WireObject[]): void => {
    for (const record of records) {
      const next = { seq: (held.at(-1)?.seq ?? 0) + 1, record }
      held.push(next)
      for (const [attach, local] of locals) local.emit(recordsEvent(attach, [next], local.seqs))
    }
  }
  const connect = async (): Promise<Client> => {
    const listeners = new Set<(event: Event) => void>()
    let close!: () => void
    const closed = new Promise<void>((resolve) => { close = resolve })
    const mine: string[] = []
    const emit = (event: Event): void => { for (const listener of [...listeners]) listener(event) }
    connections.push(() => { for (const attach of mine) locals.delete(attach); close() })
    const attach = (params: WireObject): { readonly attach: string } => {
      attaches.push(params)
      const { seqs, resume } = params
      if (!options.resume && (seqs !== undefined || resume !== undefined)) throw new LocalApiError("invalid_request", "request has an unknown field")
      if (failNext) {
        failNext = false
        throw new LocalApiError("host_not_answering", "the host did not answer")
      }
      whileHeld?.()
      const handle = `a${attaches.length}`
      const keeps = options.resume && (seqs === true || resume !== undefined)
      const from = isResumePoint(resume) && resume.attach_id === attachId ? resume.seq : undefined
      const replay = (): void => {
        if (from === undefined) emit(snapshotEvent(handle))
        const records = held.filter((one) => from === undefined || one.seq > from)
        if (records.length > 0) emit(recordsEvent(handle, records, keeps))
        locals.set(handle, { emit, seqs: keeps })
        mine.push(handle)
        adopted.shift()?.()
      }
      if (options.replay === "history") queueMicrotask(replay)
      else setTimeout(replay, 0)
      return { attach: handle }
    }
    const command = async (_attach: string, rpc: WireObject, commandId?: string): Promise<string> => {
      const id = commandId ?? "c"
      queueMicrotask(() => {
        emit({ type: "event", kind: "session.command_event", device: "b", command_id: id, response: { type: "response", command: String(rpc["type"]), success: true, data: RUNNING } })
        emit({ type: "event", kind: "session.command_state", command_id: id, state: "engine_applied", retryable: false })
      })
      return id
    }
    return {
      welcome: { type: "welcome", v: 1, service_version: "1.4.0", owner: "service", server_proof: "p", server_nonce: "n", capabilities: [] },
      request: async (type: string, params: WireObject) => {
        if (type === "session.attach") return attach(params)
        if (type === "session.detach") return {}
        throw new Error(`unexpected request ${type}`)
      },
      onEvent: (listener: (event: Event) => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      command,
      close: () => close(),
      closed,
    } as unknown as Client
  }
  // Resolves once the next session.attach has its replay sent and receives live records.
  const nextAdopt = (): Promise<void> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const done = new Promise<void>((resolve) => adopted.push(resolve))
    const bound = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("waited 5s for the re-attach to be adopted")), 5_000) })
    return Promise.race([done, bound]).finally(() => clearTimeout(timer))
  }
  return {
    attaches, host, connect, nextAdopt,
    drop: () => connections.at(-1)?.(),
    moveAttachment: (id: number) => { attachId = id; held.length = 0 },
    duringAttach: (run: () => void) => { whileHeld = () => { whileHeld = undefined; run() } },
    failNextAttach: () => { failNext = true },
  }
}

function recorder() {
  const log: string[] = []
  const waiters: Array<{ readonly n: number; readonly resolve: () => void }> = []
  const note = (line: string) => {
    log.push(line)
    for (const waiter of [...waiters]) if (log.length >= waiter.n) { waiters.splice(waiters.indexOf(waiter), 1); waiter.resolve() }
  }
  const until = (n: number): Promise<void> => {
    if (log.length >= n) return Promise.resolve()
    let timer: ReturnType<typeof setTimeout> | undefined
    const reached = new Promise<void>((resolve) => waiters.push({ n, resolve }))
    const bound = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`waited 5s for ${n} watch events, saw ${JSON.stringify(log)}`)), 5_000) })
    return Promise.race([reached, bound]).finally(() => clearTimeout(timer))
  }
  const handlers = {
    record: (record: JsonObject) => note(`delta ${String(record["delta"] ?? record["type"])}`),
    resynced: (resync: RemoteResync) => note(`resync ${resync.state.status}`),
    lost: (reason: string) => note(`lost ${reason}`),
  }
  return { log, until, handlers }
}

const delta = (n: number): WireObject => ({ type: "message_update", delta: String(n) })
const deltas = (from: number, to: number): WireObject[] => Array.from({ length: to - from + 1 }, (_, i) => delta(from + i))
const lines = (from: number, to: number): string[] => Array.from({ length: to - from + 1 }, (_, i) => `delta ${from + i}`)

// A watch on a session another local client keeps attached: records 1-5 arrive live, the connection to relayd drops, 6-7
// are written while omo is away and 8 while its re-attach is held, then 9-10 arrive live once the watch shows it listens
// again (its `listening`-th line): records sent before the watch listens are the attach's history, which only positions it.
async function dropAndReattach(relayd: ReturnType<typeof fakeRelayd>, listening: number, before?: () => void) {
  const port = createDeviceServiceSessions({ version: "0.0.0-test", connect: () => connectDeviceService({ version: "0.0.0-test", stateDir: "/unused", connect: relayd.connect }), retryDelay: async () => {} })
  const seen = recorder()
  const adoptedFirst = relayd.nextAdopt()
  const watched = await port.watch("b", "s1", seen.handlers, { baseline: false })
  if (watched.kind !== "ok") throw new Error(`watch refused: ${watched.reason}`)
  await adoptedFirst
  relayd.host(...deltas(1, 5))
  await seen.until(5)
  before?.()
  const adoptedAgain = relayd.nextAdopt()
  relayd.duringAttach(() => relayd.host(delta(8)))
  relayd.drop()
  relayd.host(...deltas(6, 7))
  await adoptedAgain
  await seen.until(listening)
  relayd.host(...deltas(9, 10))
  return { seen, watch: watched.watch }
}

describe("watch v2 re-attach after a drop (relay daemon #774, parity row 11)", () => {
  test.each(["history", "live"] as const)("#given a relayd that serves resume, replay landing as %s #when the watch re-attaches #then it resumes from its last applied seq: every record arrives once, none is lost, no snapshot resync", async (replay) => {
    const relayd = fakeRelayd({ resume: true, replay })
    const { seen, watch } = await dropAndReattach(relayd, 8)
    await seen.until(10)
    watch.stop()
    expect([seen.log, relayd.attaches]).toEqual([
      lines(1, 10),
      [{ device: "b", session_id: "s1", seqs: true }, { device: "b", session_id: "s1", resume: { attach_id: 3, seq: 5 } }],
    ])
  })

  test("#given a relayd before #782 #when the watch re-attaches #then the refused fields are dropped and it falls back to today's snapshot resync, with no record twice", async () => {
    const relayd = fakeRelayd({ resume: false, replay: "history" })
    const { seen, watch } = await dropAndReattach(relayd, 7)
    await seen.until(9)
    watch.stop()
    expect([seen.log, relayd.attaches.length]).toEqual([[...lines(1, 5), "lost closed", "resync running", ...lines(9, 10)], 4])
  })

  // Review of #12771 at 37b5af3936 (MEDIUM): the lost line depended on whether the fallback snapshot landed in the same
  // read as the attach answer. What relayd sent decides it now: its snapshot means a gap, whichever read carries it.
  test.each(["history", "live"] as const)("#given a relayd whose held attachment moved to another attach_id while omo was away, replay landing as %s #when the watch resumes #then the full replay's snapshot reports the gap lost once, resets the watch and resyncs once, and the new attachment's records arrive once", async (replay) => {
    const relayd = fakeRelayd({ resume: true, replay })
    const { seen, watch } = await dropAndReattach(relayd, 7, () => relayd.moveAttachment(4))
    await seen.until(12)
    watch.stop()
    expect([seen.log, relayd.attaches.at(-1)]).toEqual([[...lines(1, 5), "lost closed", "resync running", ...lines(6, 10)], { device: "b", session_id: "s1", resume: { attach_id: 3, seq: 5 } }])
  })

  // Review of #12771 at 37b5af3936 (LOW): a resumed attach after a failed pass still read the session afresh, ahead of
  // the records it had resumed.
  test("#given the first re-attach fails and the next one resumes #when relayd serves the resume #then the failure is reported lost once and the records after the last applied seq arrive once, with no resync", async () => {
    const relayd = fakeRelayd({ resume: true, replay: "history" })
    const { seen, watch } = await dropAndReattach(relayd, 9, () => relayd.failNextAttach())
    await seen.until(11)
    watch.stop()
    expect([seen.log, relayd.attaches.slice(1)]).toEqual([
      [...lines(1, 5), "lost closed", ...lines(6, 10)],
      [{ device: "b", session_id: "s1", resume: { attach_id: 3, seq: 5 } }, { device: "b", session_id: "s1", resume: { attach_id: 3, seq: 5 } }],
    ])
  })
})
