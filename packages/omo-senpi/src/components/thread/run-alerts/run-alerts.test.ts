import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { awaitWithinTestBudget } from "../../../../../../test-support/test-deadline"
import { createThreadComponent } from "../component"
import { createGatewayStore } from "../gateway/store"
import type { ThreadHost, ThreadHostSession } from "../tools"

// #14430 at the component boundary: run ends reach the alert through the real agent_end / agent_settled handlers, the
// thread alert goes through the real thread_send path into the gateway store, and the webhook through an injected fetch.

const SEAT = "dur-seat"
const DUTY = "dur-duty"
const WEBHOOK_ENV = "OMO_TEST_ALERT_WEBHOOK"
const WEBHOOK_URL = "https://hooks.example.invalid/services/SECRET-PATH"
const HOST_SOCKET = "/tmp/run-alerts-host.sock"
const SENTINELS = ["PROMPT-SENTINEL", "TOOL-SENTINEL", "OUTPUT-SENTINEL"]

const cleanups: Array<() => Promise<void> | void> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

type Handler = (payload: unknown, ctx?: unknown) => unknown

function liveSession(durableId: string, name: string): ThreadHostSession {
  return {
    sessionId: `rpc-${durableId}`,
    durableSessionId: durableId,
    cwd: process.cwd(),
    name,
    status: "open",
    socket: HOST_SOCKET,
    endpoint_kind: "rpc_host",
  }
}

/** A host where the seat, the duty seat and the seat's peers are live; a wake admits nothing, so rows stay queued. */
function host(peers: readonly string[]): ThreadHost {
  const sessions = [
    liveSession(SEAT, "coordinator"),
    liveSession(DUTY, "duty"),
    ...peers.map((id) => liveSession(id, id)),
  ]
  const view = async () => ({
    sessions,
    hosts: [{ socket: HOST_SOCKET, list_sessions: { sessions }, endpoint_kind: "rpc_host" as const, alive: true }],
    disk: [],
  })
  const unused = async (): Promise<never> => {
    throw new Error("not used")
  }
  return {
    socket: "/tmp/run-alerts-legacy.sock",
    listSessions: async () => sessions,
    listView: view,
    listTarget: view,
    openSession: unused,
    getMessages: async () => [],
    getState: async () => ({ isStreaming: false }),
    prompt: unused,
    interrupt: unused,
    setSessionName: unused,
    setModel: unused,
    getAvailableModels: unused,
    setThinkingLevel: unused,
    getAvailableThinkingLevels: unused,
    gateway: { wake: async () => ({ admitted: [] }) },
  }
}

function logSink() {
  const lines: string[] = []
  const waiters: { readonly pattern: RegExp; readonly resolve: () => void }[] = []
  const push = (line: string) => {
    lines.push(line)
    for (const waiter of waiters.splice(0)) {
      if (waiter.pattern.test(line)) waiter.resolve()
      else waiters.push(waiter)
    }
  }
  return {
    lines,
    logger: { info: push, warn: push, error: push },
    next(pattern: RegExp): Promise<void> {
      if (lines.some((line) => pattern.test(line))) return Promise.resolve()
      return new Promise((resolve) => waiters.push({ pattern, resolve }))
    },
  }
}

type Posted = { readonly url: string; readonly body: Record<string, unknown> }

function seatWithAlerts(options: {
  readonly fetch: (url: string, body: Record<string, unknown>) => Promise<Response>
  readonly peers?: readonly string[]
  /** Which layer carries `operator_alerts`: the user's `~/.omo/omo.jsonc` or the workspace's `.omo/omo.json`. */
  readonly configLayer?: "user" | "project"
}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "run-alerts-")))
  cleanups.push(() => rmSync(root, { recursive: true, force: true }))
  const agentDir = join(root, "agent")
  const home = join(root, "home")
  const workspace = join(home, "project")
  mkdirSync(join(home, ".omo"), { recursive: true })
  mkdirSync(join(workspace, ".omo"), { recursive: true })
  const alerts = {
    operator_alerts: {
      error_streak: { threshold: 10, realert_minutes: 60, threads: [DUTY], webhook_url_env: WEBHOOK_ENV },
    },
  }
  const project = options.configLayer === "project"
  writeFileSync(join(home, ".omo", "omo.jsonc"), JSON.stringify(project ? {} : alerts))
  writeFileSync(join(workspace, ".omo", "omo.json"), JSON.stringify(project ? alerts : {}))
  const store = createGatewayStore({ agentDir })
  cleanups.push(() => store.dispose())
  const handlers = new Map<string, Handler[]>()
  const tools: { name: string; execute: (...args: unknown[]) => Promise<unknown> }[] = []
  const pi = {
    cwd: workspace,
    registerTool: (tool: (typeof tools)[number]) => tools.push(tool),
    on: (event: string, handler: Handler) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
    registerCommand() {},
    registerFlag() {},
    getFlag: () => undefined,
    getSessionName: () => "coordinator",
    sendMessage() {},
    sendUserMessage() {},
  }
  const log = logSink()
  let clock = Date.parse("2026-11-19T22:00:00.000Z")
  const posted: Posted[] = []
  createThreadComponent({
    host: host(options.peers ?? []),
    stateDirectory: join(agentDir, "state"),
    agentDir: () => agentDir,
    store,
    env: { HOME: home, [WEBHOOK_ENV]: WEBHOOK_URL },
    callerWorkspaceRoot: () => workspace,
    operatorAlerts: {
      now: () => clock,
      device: async () => "device-test",
      delay: async () => {},
      fetch: (async (url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>
        posted.push({ url, body })
        return await options.fetch(url, body)
      }) as typeof fetch,
    },
  }).register(pi as never, { logger: log.logger, config: { getFlag: () => undefined } } as never)

  const ctx = (durableId: string) => ({ sessionManager: { getSessionId: () => durableId } })
  const dispatch = async (event: string, durableId: string, payload: Record<string, unknown> = {}) => {
    for (const handler of handlers.get(event) ?? []) await handler({ type: event, ...payload }, ctx(durableId))
  }
  const endRun = async (assistant: Record<string, unknown>) => {
    clock += 15_000
    await dispatch("agent_end", SEAT, {
      messages: [
        { role: "user", content: [{ type: "text", text: "PROMPT-SENTINEL" }] },
        { role: "toolResult", toolCallId: "c1", content: [{ type: "text", text: "TOOL-SENTINEL" }] },
        assistant,
      ],
    })
    await dispatch("agent_settled", SEAT)
  }
  const failedRun = () =>
    endRun({
      role: "assistant",
      stopReason: "error",
      errorMessage: "rate_limit_error: This request would exceed your account's rate limit OUTPUT-SENTINEL",
      provider: "anthropic",
      model: "claude-x",
      content: [],
    })
  const normalRun = () => endRun({ role: "assistant", stopReason: "stop", content: [{ type: "text", text: "done" }] })
  // Read through the component's own store worker, never a second connection to the file it is writing.
  const deliveriesTo = async (target: string) =>
    [...(await store.list({ target_durable_id: target }))]
      .sort((a, b) => a.seq - b.seq)
      .map((row) => ({ sender: row.sender, body: row.body }))
  const sendAsPeer = async (peer: string, text: string) => {
    const send = tools.find((tool) => tool.name === "thread_send")
    if (send === undefined) throw new Error("thread_send is not registered")
    return await send.execute(
      `call-${peer}-${text}`,
      { thread: SEAT, message: text, all_scope: true },
      undefined,
      undefined,
      ctx(peer),
    )
  }
  return { log, posted, failedRun, normalRun, deliveriesTo, sendAsPeer }
}

const ok = async () => new Response("ok", { status: 200 })

describe("error-streak alerts through the thread component (#14430)", () => {
  test("#given a seat whose runs end with errors #when the 10th error settles, 25 more follow inside the re-alert interval and a normal stop comes #then the duty thread and the webhook each get one alert and one recovered notice, carrying metadata only", async () => {
    const seat = seatWithAlerts({ fetch: ok })
    const alerted = seat.log.next(/error_streak for dur-seat sent to the webhook/)
    const alertedThread = seat.log.next(/error_streak for dur-seat sent to thread dur-duty/)
    for (let run = 1; run <= 10; run++) await seat.failedRun()
    await awaitWithinTestBudget(Promise.all([alerted, alertedThread]), "the first error-streak alert")

    for (let run = 1; run <= 25; run++) await seat.failedRun()
    const recovered = seat.log.next(/error_streak_recovered for dur-seat sent to the webhook/)
    const recoveredThread = seat.log.next(/error_streak_recovered for dur-seat sent to thread dur-duty/)
    await seat.normalRun()
    await awaitWithinTestBudget(Promise.all([recovered, recoveredThread]), "the recovered notice")

    const toDuty = await seat.deliveriesTo(DUTY)
    expect(toDuty.map((row) => row.sender)).toEqual([`session:${SEAT}`, `session:${SEAT}`])
    expect(toDuty.map((row) => JSON.parse(row.body.split("\n")[1] ?? "{}"))).toMatchObject([
      { event: "error_streak", count: 10, device: "device-test" },
      { event: "error_streak_recovered", count: 35, device: "device-test" },
    ])
    expect(seat.posted.map((post) => [post.url, post.body["event"], post.body["count"]])).toEqual([
      [WEBHOOK_URL, "error_streak", 10],
      [WEBHOOK_URL, "error_streak_recovered", 35],
    ])
    expect(seat.posted[0]?.body).toMatchObject({
      session_id: SEAT,
      name: "coordinator",
      classes: { rate_limit: 10 },
      provider: "anthropic",
      model: "claude-x",
      first_at: Date.parse("2026-11-19T22:00:15.000Z"),
      last_at: Date.parse("2026-11-19T22:02:30.000Z"),
    })
    expect(typeof seat.posted[0]?.body["text"]).toBe("string")
    const everything = [...toDuty.map((row) => row.body), ...seat.posted.map((post) => JSON.stringify(post.body))]
    for (const sentinel of SENTINELS) expect(everything.filter((text) => text.includes(sentinel))).toEqual([])
  })

  test("#given a seat whose own inbox holds 128 undelivered messages #when its 10th error run settles #then the alert still reaches the duty thread", async () => {
    // 128 is the per-target backlog the #14428 admission caps a target at: the seat's own inbox is full, its outbound alert is not.
    const peers = Array.from({ length: 16 }, (_, index) => `dur-peer-${index}`)
    const seat = seatWithAlerts({ fetch: ok, peers })
    await Promise.all(
      peers.map(async (peer) => {
        for (let message = 1; message <= 8; message++) await seat.sendAsPeer(peer, `work ${message}`)
      }),
    )
    expect(await seat.deliveriesTo(SEAT)).toHaveLength(128)

    const alerted = seat.log.next(/error_streak for dur-seat sent to thread dur-duty/)
    for (let run = 1; run <= 10; run++) await seat.failedRun()
    await awaitWithinTestBudget(alerted, "the alert to the duty thread")

    expect(await seat.deliveriesTo(DUTY)).toHaveLength(1)
  })

  test("#given a webhook that answers 500 once and then holds its answer #when the alert fires #then the settle never waits for it, the POST is retried once, and the URL is never logged", async () => {
    let release: (response: Response) => void = () => {}
    const held = new Promise<Response>((resolve) => {
      release = resolve
    })
    let retried: () => void = () => {}
    const retriedSeen = new Promise<void>((resolve) => {
      retried = resolve
    })
    let calls = 0
    const seat = seatWithAlerts({
      fetch: async () => {
        calls++
        if (calls === 1) return new Response("down", { status: 500 })
        retried()
        return await held
      },
    })
    const sent = seat.log.next(/error_streak for dur-seat sent to the webhook/)

    for (let run = 1; run <= 10; run++) await seat.failedRun()
    await awaitWithinTestBudget(retriedSeen, "the retried webhook POST")
    await awaitWithinTestBudget(seat.failedRun(), "a settle while the webhook holds its answer")
    release(new Response("ok", { status: 200 }))
    await awaitWithinTestBudget(sent, "the webhook alert")

    expect(calls).toBe(2)
    expect(seat.log.lines.filter((line) => line.includes("SECRET-PATH"))).toEqual([])
  })

  test("#given operator_alerts set only in the workspace's .omo/omo.json #when the 10th error settles #then the alert is logged but no thread or webhook receives it", async () => {
    const seat = seatWithAlerts({ fetch: ok, configLayer: "project" })
    const detected = seat.log.next(/^omo alert: .*ended 10 runs in a row/)
    const dispatched = seat.log.next(/error_streak for dur-seat: \d+ of \d+ target\(s\) reached/)

    for (let run = 1; run <= 10; run++) await seat.failedRun()
    await awaitWithinTestBudget(Promise.all([detected, dispatched]), "the logged and dispatched error-streak alert")

    expect(await seat.deliveriesTo(DUTY)).toEqual([])
    expect(seat.posted).toEqual([])
  })
})
