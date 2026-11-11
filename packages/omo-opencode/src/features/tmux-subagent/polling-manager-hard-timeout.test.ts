import { createOpencodeClient } from "@opencode-ai/sdk"
import { describe, test, expect } from "bun:test"
import { TmuxPollingManager } from "./polling-manager"
import { SESSION_TIMEOUT_MS } from "../../shared/tmux"
import type { OpencodeClient } from "../../tools/delegate-task/types"
import type { TrackedSession } from "./types"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"

function createTrackedSession(sessionId: string, createdAt: Date): TrackedSession {
  return {
    sessionId,
    paneId: "%1",
    description: "test",
    attachActivated: false,
    createdAt,
    lastSeenAt: createdAt,
    closePending: false,
    closeRetryCount: 0,
  }
}

function createStatuslessClient(): OpencodeClient {
  return unsafeTestValue<OpencodeClient>({
    session: {
      status: async () => ({ data: {} }),
      messages: async () => ({ data: [] }),
    },
  })
}

describe("TmuxPollingManager never-activated pane hard timeout (#4773, #5071)", () => {
  test("closes a never-focused pane with no session status once SESSION_TIMEOUT_MS elapses", async () => {
    //#given a pane past the hard timeout that was never attach-activated and never reported a status
    const pastHardTimeout = new Date(Date.now() - SESSION_TIMEOUT_MS - 60_000)
    const sessions = new Map<string, TrackedSession>()
    sessions.set("ses-unfocused-timed-out", createTrackedSession("ses-unfocused-timed-out", pastHardTimeout))

    const closedSessionIds: string[] = []
    const manager = new TmuxPollingManager(createStatuslessClient(), sessions, async (sessionId) => {
      closedSessionIds.push(sessionId)
    })

    //#when
    await unsafeTestValue<{ pollSessions: () => Promise<void> }>(manager).pollSessions()

    //#then
    expect(closedSessionIds).toEqual(["ses-unfocused-timed-out"])
  })

  test("keeps a young never-focused pane with no session status open", async () => {
    //#given a 30s-old placeholder pane that was never attach-activated and has no status yet
    const thirtySecondsAgo = new Date(Date.now() - 30_000)
    const sessions = new Map<string, TrackedSession>()
    sessions.set("ses-unfocused-young", createTrackedSession("ses-unfocused-young", thirtySecondsAgo))

    const closedSessionIds: string[] = []
    const manager = new TmuxPollingManager(createStatuslessClient(), sessions, async (sessionId) => {
      closedSessionIds.push(sessionId)
    })

    //#when
    await unsafeTestValue<{ pollSessions: () => Promise<void> }>(manager).pollSessions()

    //#then
    expect(closedSessionIds).toEqual([])
  })
})

describe("TmuxPollingManager stalled registry recovery", () => {
  test("retains an abort-ignoring request slot while hard-timeout and close retry recovery continue", async () => {
    let calls = 0
    let signal: AbortSignal | undefined
    let release!: (value: { data: object }) => void
    const pending = new Promise<{ data: object }>((resolve) => { release = resolve })
    const client = unsafeTestValue<OpencodeClient>({ session: { status: (options?: { signal?: AbortSignal }) => { calls += 1; signal = options?.signal; return pending } } })
    const sessions = new Map<string, TrackedSession>()
    const expired = createTrackedSession("expired", new Date(Date.now() - SESSION_TIMEOUT_MS - 1))
    const healthy = { ...createTrackedSession("healthy", new Date(Date.now() - 60000)), attachActivated: true, lastSeenAt: new Date(1) }
    sessions.set(expired.sessionId, expired)
    sessions.set(healthy.sessionId, healthy)
    const closed: string[] = []
    let retries = 0
    const manager = new TmuxPollingManager(client, sessions, async (id) => { closed.push(id) }, async () => { retries += 1 })
    let circuit: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([manager["pollSessions"](), new Promise((_, reject) => { circuit = setTimeout(() => reject(new Error("stalled registry blocked pane recovery past 7s")), 7000) })])
      expect(signal?.aborted).toBe(true)
      expect(closed).toEqual(["expired"])
      expect(healthy.stableIdlePolls ?? 0).toBe(0)
      await manager["pollSessions"]()
      expect(calls).toBe(1)
      expect(retries).toBe(2)
      expect(closed).toEqual(["expired"])
    } finally { clearTimeout(circuit); release({ data: {} }); manager.stopPolling() }
  }, 12000)

  test("stop aborts the request and a late response cannot close a pane in a new polling epoch", async () => {
    let started!: () => void
    const ready = new Promise<void>((resolve) => { started = resolve })
    let signal: AbortSignal | undefined
    let release!: (value: { data: object }) => void
    const pending = new Promise<{ data: object }>((resolve) => { release = resolve })
    const client = unsafeTestValue<OpencodeClient>({ session: { status: (options?: { signal?: AbortSignal }) => { signal = options?.signal; started(); return pending } } })
    const tracked = { ...createTrackedSession("late", new Date(1)), attachActivated: true }
    const closed: string[] = []
    const manager = new TmuxPollingManager(client, new Map([[tracked.sessionId, tracked]]), async (id) => { closed.push(id) })
    const polling = manager["pollSessions"]()
    await ready
    try { manager.stopPolling(); expect(signal?.aborted).toBe(true); manager.startPolling() }
    finally { release({ data: { late: { type: "idle" } } }); await polling; manager.stopPolling() }
    expect(closed).toEqual([])
  })
})


describe("TmuxPollingManager pinned SDK transport", () => {
  test("cancels a hung HTTP status request and subsequently accepts a valid response", async () => {
    let serverCalls = 0
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => {
      serverCalls += 1
      if (serverCalls === 1) return new Promise<Response>(() => {})
      return Response.json({ transport: { type: "busy" } })
    } })
    const sdk = createOpencodeClient({ baseUrl: server.url.toString() })
    let active = 0
    let maxActive = 0
    let firstSettled!: () => void
    const settled = new Promise<void>((resolve) => { firstSettled = resolve })
    const signals: AbortSignal[] = []
    const client = unsafeTestValue<OpencodeClient>({ session: { status: async (options: { signal: AbortSignal; throwOnError: true }) => {
      signals.push(options.signal)
      active += 1
      maxActive = Math.max(maxActive, active)
      try { return await sdk.session.status(options) }
      finally { active -= 1; firstSettled() }
    } } })
    const tracked = { ...createTrackedSession("transport", new Date()), attachActivated: true }
    const closed: string[] = []
    const manager = new TmuxPollingManager(client, new Map([[tracked.sessionId, tracked]]), async (id) => { closed.push(id) })
    let circuit: ReturnType<typeof setTimeout> | undefined
    try {
      await manager["pollSessions"]()
      await Promise.race([settled, new Promise((_, reject) => { circuit = setTimeout(() => reject(new Error("pinned SDK did not settle after transport abort")), 1000) })])
      await manager["pollSessions"]()
      expect(serverCalls).toBe(2)
      expect(signals[0].aborted).toBe(true)
      expect(active).toBe(0)
      expect(maxActive).toBe(1)
      expect(closed).toEqual([])
    } finally { clearTimeout(circuit); manager.stopPolling(); await server.stop(true) }
  }, 12000)
})


test("TmuxPollingManager does not treat a resolved error envelope as a missing session", async () => {
  const tracked = { ...createTrackedSession("unavailable", new Date(Date.now() - 60000)), attachActivated: true, lastSeenAt: new Date(1) }
  const client = unsafeTestValue<OpencodeClient>({ session: { status: async () => ({error: new Error("status unavailable")}) } })
  const closed: string[] = []
  let retries = 0
  const manager = new TmuxPollingManager(client,new Map([[tracked.sessionId,tracked]]),async id=>{closed.push(id)},async()=>{retries+=1})
  try { await manager["pollSessions"](); expect(closed).toEqual([]); expect(retries).toBe(1) }
  finally { manager.stopPolling() }
})


for (const [name,response] of [["missing",{data:undefined}],["null",{data:null}],["undefined",undefined],["array",{data:[]}],["invalid status entry",{data:{healthy:{}}}]] as const) {
  test(`TmuxPollingManager keeps healthy panes when registry is ${name}`, async () => {
    const tracked = { ...createTrackedSession("healthy", new Date(Date.now()-60000)), attachActivated:true,lastSeenAt:new Date(1) }
    const client=unsafeTestValue<OpencodeClient>({session:{status:async()=>response}})
    const closed:string[]=[]
    const manager=new TmuxPollingManager(client,new Map([[tracked.sessionId,tracked]]),async id=>{closed.push(id)})
    try {await manager["pollSessions"]();expect(closed).toEqual([])} finally {manager.stopPolling()}
  })
}

test("TmuxPollingManager stops an old close batch after restart during the first close",async()=>{
  const first=createTrackedSession("first",new Date(1)),second=createTrackedSession("second",new Date(1))
  let started!:()=>void,release!:()=>void
  const ready=new Promise<void>(resolve=>{started=resolve}),gate=new Promise<void>(resolve=>{release=resolve})
  const closed:string[]=[];let retries=0
  const manager=new TmuxPollingManager(createStatuslessClient(),new Map([[first.sessionId,first],[second.sessionId,second]]),async id=>{closed.push(id);started();await gate},async()=>{retries+=1})
  const polling=manager["pollSessions"]()
  await ready
  try {manager.stopPolling();manager.startPolling();release();await polling;expect(closed).toEqual(["first"]);expect(retries).toBe(0)}
  finally {release();manager.stopPolling()}
})

for (const phase of ["window state", "activation"] as const) {
  test(`TmuxPollingManager ignores late ${phase} after stop`,async()=>{
    const tracked=createTrackedSession("late-activation",new Date())
    let started!:()=>void,release!:()=>void
    const ready=new Promise<void>(resolve=>{started=resolve}),gate=new Promise<void>(resolve=>{release=resolve})
    let activations=0
    const state=unsafeTestValue<import("./types").WindowState>({mainPane:{paneId:tracked.paneId,isActive:true},agentPanes:[]})
    const manager=new TmuxPollingManager(createStatuslessClient(),new Map([[tracked.sessionId,tracked]]),async()=>{},undefined,async()=>{
      if(phase==="window state"){started();await gate}
      return state
    },async()=>{activations+=1;if(phase==="activation"){started();await gate}return true})
    const polling=manager["pollSessions"]()
    await ready
    try {manager.stopPolling();release();await polling;expect(activations).toBe(phase==="window state"?0:1);expect(tracked.attachActivated).toBe(false)}
    finally {release();manager.stopPolling()}
  })
}
