import { afterEach, describe, expect, setSystemTime, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { commandWaitMs, TOOL_CALL_BUDGET_MS } from "../call-budget/call-deadline"
import { createThreadComponent } from "./component"
import type { ThreadToolResult } from "./contracts"
import { createGatewayStore, type GatewayStore } from "./gateway/store"
import { B_ROW, createRemoteThreadFixture } from "./thread-remote-fixture"
import type { ThreadHost } from "./tools"

// omo#14130 with #14221 (train merge): thread_send's one budget starts before its view selection, so a reply to a
// sender on another device reads this device's id (replyRoute -> thisDeviceOf -> devices.list) inside the call's
// deadline, and the time that read takes is taken out of what the send's own commands may wait. Time is moved with
// setSystemTime (the deadline and commandWaitMs read Date.now()); nothing here sleeps.

/** A bound longer than the call's budget: a wait read inside the call is cut to the budget, one outside it is not. */
const UNBOUNDED_WAIT_MS = TOOL_CALL_BUDGET_MS * 2
/** The send's own bound (device-service.ts SEND_WAIT_MS). */
const SEND_WAIT_MS = 45_000

const host: ThreadHost = {
  socket: "/tmp/thread-send-route-deadline.sock",
  listSessions: async () => [],
  openSession: async () => ({ sessionId: "s", cwd: process.cwd() }),
  getMessages: async () => [],
  getState: async () => ({ isStreaming: false }),
  prompt: async () => ({ turnId: "turn-local" }),
  interrupt: async () => ({}),
  setSessionName: async () => {},
  setModel: async (_sessionId, provider, modelId) => ({ provider, id: modelId }),
  getAvailableModels: async () => [],
  setThinkingLevel: async () => {},
  getAvailableThinkingLevels: async () => [],
}

type Handler = (payload: unknown, ctx?: unknown) => unknown
type CapturedTool = {
  readonly name: string
  readonly execute: (id: string, args: unknown, signal: unknown, onUpdate: unknown, ctx: unknown) => Promise<unknown>
}

describe("thread_send's reply-route selection runs under the call's deadline (#14185 with #14221)", () => {
  const fixture = createRemoteThreadFixture()
  const stores: GatewayStore[] = []
  const directories: string[] = []
  afterEach(async () => {
    setSystemTime()
    await Promise.all(stores.splice(0).map((store) => store.dispose()))
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
    await fixture.cleanup()
  })

  /**
   * A run that consumed a delivery from b's session, replying to it. `takesMs`: how long the first device read (the
   * route selection's) takes; the clock moves by it before that read answers. Each read records the wait it would get; each admission to b
   * records the wait the send would get and, as the device-service port does (device-service.test.ts), is refused
   * request_timeout before sending when the call's budget is spent.
   */
  async function replyingRun(takesMs: number) {
    const agentDir = mkdtempSync(join(tmpdir(), "thr-send-route-deadline-"))
    directories.push(agentDir)
    const store = createGatewayStore({ agentDir })
    stores.push(store)
    const account = fixture.account({ rows: [B_ROW], live: [B_ROW.session_id] })
    const deviceReadWaits: number[] = []
    const admitWaits: number[] = []
    const list = account.remote.client.devices.list
    const command = account.remote.sessions.sessionCommand
    const remote = {
      ...account.remote,
      client: {
        ...account.remote.client,
        devices: {
          ...account.remote.client.devices,
          list: async (...args: Parameters<typeof list>) => {
            deviceReadWaits.push(commandWaitMs(UNBOUNDED_WAIT_MS))
            if (deviceReadWaits.length === 1) setSystemTime(new Date(Date.now() + takesMs))
            return await list(...args)
          },
        },
      },
      sessions: {
        ...account.remote.sessions,
        sessionCommand: async (...args: Parameters<typeof command>) => {
          if (args[2]["type"] === "admit_external_message") {
            const waitMs = commandWaitMs(SEND_WAIT_MS)
            admitWaits.push(waitMs)
            if (waitMs <= 0) return { kind: "refused", reason: "request_timeout" } as const
          }
          return await command(...args)
        },
      },
    }
    const handlers = new Map<string, Handler[]>()
    const tools: CapturedTool[] = []
    const pi = {
      cwd: process.cwd(),
      registerTool(tool: CapturedTool) {
        tools.push(tool)
      },
      on(event: string, handler: Handler) {
        handlers.set(event, [...(handlers.get(event) ?? []), handler])
      },
      registerCommand() {},
      registerFlag() {},
      getFlag() {
        return undefined
      },
      sendMessage() {},
      sendUserMessage() {},
    }
    createThreadComponent({
      host,
      stateDirectory: join(agentDir, "state"),
      agentDir: () => agentDir,
      store,
      remote,
    }).register(
      pi as never,
      { logger: { info() {}, error() {}, warn() {} }, config: { getFlag: () => undefined } } as never,
    )
    const ctx = { sessionManager: { getSessionId: () => "dur-caller" } }
    const dispatch = async (event: string, payload: Record<string, unknown> = {}) => {
      for (const handler of handlers.get(event) ?? []) await handler({ type: event, ...payload }, ctx)
    }
    await dispatch("agent_start")
    await dispatch("message_start", {
      message: {
        role: "custom",
        customType: "session_control_delivery",
        details: { delivery_id: "device:b/d-1", sender: { kind: "agent", session_id: "dur-on-b", name: "on b" } },
      },
    })
    const send = tools.find((tool) => tool.name === "thread_send")
    if (send === undefined) throw new Error("thread_send is not registered")
    const reply = async (): Promise<ThreadToolResult> => {
      const out = (await send.execute(
        "call-1",
        { thread: "dur-on-b", message: "reply" },
        undefined,
        undefined,
        ctx,
      )) as {
        details: { result: ThreadToolResult }
      }
      return out.details.result
    }
    const admitted = () =>
      account.sent.filter((entry) => entry.rpc?.["type"] === "admit_external_message").map((entry) => entry.device)
    return { reply, deviceReadWaits, admitWaits, admitted }
  }

  test("#given a reply to a sender on b #when thread_send reads this device's id to pick the reply route #then that read sees the call's deadline: its wait is cut to the call's budget", async () => {
    setSystemTime(new Date("2026-11-18T00:00:00.000Z"))
    const run = await replyingRun(0)
    expect(await run.reply()).toMatchObject({ kind: "ok", thread: "dur-on-b", device: "b" })
    const [selection] = run.deviceReadWaits
    expect(selection).toBeLessThanOrEqual(TOOL_CALL_BUDGET_MS)
    expect(selection).toBeGreaterThan(0)
    expect(run.admitted()).toEqual(["b"])
  })

  test("#given this device's id read takes 30 s during route selection #when the reply is admitted on b #then the admission waits only what is left of the call's budget", async () => {
    setSystemTime(new Date("2026-11-18T00:00:00.000Z"))
    const run = await replyingRun(30_000)
    expect(await run.reply()).toMatchObject({ kind: "ok", thread: "dur-on-b", device: "b" })
    expect(run.admitWaits).toHaveLength(1)
    const [admit] = run.admitWaits
    expect(admit).toBeLessThanOrEqual(TOOL_CALL_BUDGET_MS - 30_000)
    expect(admit).toBeGreaterThan(0)
    expect(run.admitted()).toEqual(["b"])
  })

  test("#given this device's id read answers only after the call's whole budget #when the reply goes on #then thread_send ends typed and nothing reaches b or any other route", async () => {
    setSystemTime(new Date("2026-11-18T00:00:00.000Z"))
    const run = await replyingRun(TOOL_CALL_BUDGET_MS + 1)
    expect(await run.reply()).toMatchObject({
      kind: "error",
      error: { code: "host_unavailable", details: { device: "b", reason: "request_timeout" } },
    })
    expect(run.admitWaits).toHaveLength(1)
    expect(run.admitWaits[0]).toBeLessThanOrEqual(0)
    expect(run.admitted()).toEqual([])
  })
})
