import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createThreadComponent } from "./component"
import type { ThreadToolResult } from "./contracts"
import { gatewayInboxDirectory } from "./gateway/paths"
import { createGatewayStore, type GatewayStore } from "./gateway/store"
import type { RemoteSessionRow } from "./remote/ports"
import { B_ROW, createRemoteThreadFixture } from "./thread-remote-fixture"
import type { ThreadHost, ThreadHostSession } from "./tools"

// Amendment A4.3.1 of #13037: an approved reply resolves on the device the consumed delivery came from (the device in the
// delivery's id, `device:<device>/<id>`; `rpc:local/<id>` and a bare row id mean this device), before this device's own
// entries and before any other listing match, by the sender's id or by the name it stated. The reply-target check compares
// the device as well as the session id.

const LOCAL: ThreadHostSession = {
  sessionId: "route-local",
  durableSessionId: "dur-local",
  cwd: process.cwd(),
  name: "local peer",
  status: "open",
}
const C_SAME_ID: RemoteSessionRow = { ...B_ROW, device: "c", session_id: "rk-on-c", title: "on c" }
const C_PLANNER: RemoteSessionRow = { ...B_ROW, device: "c", session_id: "rk-c", durable_id: "dur-c", title: "planner" }
const C_OTHER: RemoteSessionRow = { ...B_ROW, device: "c", session_id: "rk-c", durable_id: "dur-c", title: "c thread" }

function host(sessions: readonly ThreadHostSession[], onPrompt: () => void = () => {}): ThreadHost {
  return {
    socket: "/tmp/thread-reply-device.sock",
    listSessions: async () => [...sessions],
    openSession: async () => ({ sessionId: "s", cwd: process.cwd() }),
    getMessages: async () => [],
    getState: async () => ({ isStreaming: false }),
    prompt: async () => {
      onPrompt()
      return { turnId: "turn-local" }
    },
    interrupt: async () => ({}),
    setSessionName: async () => {},
    setModel: async (_sessionId, provider, modelId) => ({ provider, id: modelId }),
    getAvailableModels: async () => [],
    setThinkingLevel: async () => {},
    getAvailableThinkingLevels: async () => [],
  }
}

type Handler = (payload: unknown, ctx?: unknown) => unknown
type CapturedTool = {
  readonly name: string
  readonly execute: (id: string, args: unknown, signal: unknown, onUpdate: unknown, ctx: unknown) => Promise<unknown>
}

type Delivery = { readonly id: string; readonly session_id: string; readonly name?: string }

describe("#13037 A4.3.1: an approved reply resolves on the device its delivery came from", () => {
  const fixture = createRemoteThreadFixture()
  const stores: GatewayStore[] = []
  const directories: string[] = []
  afterEach(async () => {
    await Promise.all(stores.splice(0).map((store) => store.dispose()))
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
    await fixture.cleanup()
  })

  async function consumed(deliveries: readonly Delivery[], rows: readonly RemoteSessionRow[]) {
    const agentDir = mkdtempSync(join(tmpdir(), "thr-reply-device-"))
    directories.push(agentDir)
    const store = createGatewayStore({ agentDir })
    stores.push(store)
    const account = fixture.account({ rows, live: rows.map((row) => row.session_id) })
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
    const logger = { info() {}, error() {}, warn() {} }
    let prompts = 0
    createThreadComponent({
      host: host([LOCAL], () => {
        prompts += 1
      }),
      stateDirectory: join(agentDir, "state"),
      agentDir: () => agentDir,
      store,
      remote: account.remote,
    }).register(pi as never, { logger, config: { getFlag: () => undefined } } as never)
    const ctx = { sessionManager: { getSessionId: () => "dur-caller" } }
    const dispatch = async (event: string, payload: Record<string, unknown> = {}) => {
      for (const handler of handlers.get(event) ?? []) await handler({ type: event, ...payload }, ctx)
    }
    await dispatch("agent_start")
    for (const delivery of deliveries)
      await dispatch("message_start", {
        message: {
          role: "custom",
          customType: "session_control_delivery",
          details: {
            delivery_id: delivery.id,
            sender: {
              kind: "agent",
              session_id: delivery.session_id,
              ...(delivery.name === undefined ? {} : { name: delivery.name }),
            },
          },
        },
      })
    const send = tools.find((tool) => tool.name === "thread_send")
    if (send === undefined) throw new Error("thread_send is not registered")
    let call = 0
    const reply = async (thread: string): Promise<ThreadToolResult> => {
      call += 1
      const out = (await send.execute(`call-${call}`, { thread, message: "reply" }, undefined, undefined, ctx)) as {
        details: { result: ThreadToolResult }
      }
      return out.details.result
    }
    const admittedOn = () =>
      account.sent.filter((entry) => entry.rpc?.["type"] === "admit_external_message").map((entry) => entry.device)
    // A delivery to a session on this device leaves a marker in its gateway inbox: none means nothing reached it.
    const reachedLocally = (durableId: string) => existsSync(gatewayInboxDirectory(agentDir, durableId))
    return { reply, admittedOn, prompts: () => prompts, reachedLocally }
  }

  test("#given b's delivery states a session id that a third device also lists #when the run replies by that id #then the reply goes to b's row and nothing reaches the third device", async () => {
    const { reply, admittedOn } = await consumed(
      [{ id: "device:b/d-1", session_id: "dur-on-b", name: "on b" }],
      [C_SAME_ID, B_ROW],
    )
    expect(await reply("dur-on-b")).toMatchObject({ kind: "ok", thread_id: "dur-on-b", device: "b" })
    expect(admittedOn()).toEqual(["b"])
  })

  test("#given b's delivery states a session id that only a third device lists #when the run replies by that id #then it is not_found naming b, and nothing reaches the third device", async () => {
    const { reply, admittedOn } = await consumed([{ id: "device:b/d-1", session_id: "dur-on-b" }], [C_SAME_ID])
    expect(await reply("dur-on-b")).toMatchObject({
      kind: "error",
      error: { code: "not_found", details: { device: "b" } },
    })
    expect(admittedOn()).toEqual([])
  })

  test("#given b's delivery states the id of a session on this device #when the run replies by that id #then the reply does not reach the local session", async () => {
    const { reply, admittedOn } = await consumed([{ id: "device:b/d-1", session_id: "dur-local" }], [B_ROW])
    expect(await reply("dur-local")).toMatchObject({
      kind: "error",
      error: { code: "not_found", details: { device: "b" } },
    })
    expect(admittedOn()).toEqual([])
  })

  test("#given b's delivery states a name another device's session carries #when the run replies by that name #then the reply goes to the consumed sender on b", async () => {
    const { reply, admittedOn } = await consumed(
      [{ id: "device:b/d-1", session_id: "dur-on-b", name: "planner" }],
      [B_ROW, C_PLANNER],
    )
    expect(await reply("planner")).toMatchObject({ kind: "ok", thread_id: "dur-on-b", device: "b" })
    expect(admittedOn()).toEqual(["b"])
  })

  test("#given b's delivery states a name a session on this device carries #when the run replies by that name #then the reply goes to the consumed sender on b, never to the local session", async () => {
    const { reply, admittedOn, prompts, reachedLocally } = await consumed(
      [{ id: "device:b/d-1", session_id: "dur-on-b", name: "local peer" }],
      [B_ROW],
    )
    expect(await reply("local peer")).toMatchObject({ kind: "ok", thread_id: "dur-on-b", device: "b" })
    expect(admittedOn()).toEqual(["b"])
    expect({ prompts: prompts(), reached: reachedLocally("dur-local") }).toEqual({ prompts: 0, reached: false })
  })

  test("#given deliveries from b and from c that state one session id #when the run replies by that id #then it is ambiguous_target and nothing is sent", async () => {
    const { reply, admittedOn } = await consumed(
      [
        { id: "device:b/d-1", session_id: "dur-on-b" },
        { id: "device:c/d-2", session_id: "dur-on-b" },
      ],
      [B_ROW],
    )
    expect(await reply("dur-on-b")).toMatchObject({ kind: "error", error: { code: "ambiguous_target" } })
    expect(admittedOn()).toEqual([])
  })

  test("#given deliveries from two senders that state one name #when the run replies by that name #then it is ambiguous_target and nothing is sent", async () => {
    const { reply, admittedOn } = await consumed(
      [
        { id: "device:b/d-1", session_id: "dur-on-b", name: "planner" },
        { id: "device:c/d-2", session_id: "dur-c", name: "planner" },
      ],
      [B_ROW, C_OTHER],
    )
    expect(await reply("planner")).toMatchObject({ kind: "error", error: { code: "ambiguous_target" } })
    expect(admittedOn()).toEqual([])
  })

  test("#given a delivery id whose device part is URI-encoded #when the run replies #then the reply resolves on the decoded device", async () => {
    const spaced: RemoteSessionRow = { ...B_ROW, device: "b c" }
    const { reply, admittedOn } = await consumed(
      [{ id: `device:${encodeURIComponent("b c")}/d-1`, session_id: "dur-on-b" }],
      [spaced],
    )
    expect(await reply("dur-on-b")).toMatchObject({ kind: "ok", thread_id: "dur-on-b", device: "b c" })
    expect(admittedOn()).toEqual(["b c"])
  })

  test.each(["rpc:local/d-1", "d-1"])(
    "unchanged: #given a same-device delivery (id %s) from a local session #when the run replies by its id and by its stated name #then both reach the local session",
    async (id) => {
      const { reply, admittedOn } = await consumed([{ id, session_id: "dur-local", name: "local peer" }], [B_ROW])
      for (const address of ["dur-local", "local peer"]) {
        const result = await reply(address)
        expect(result).toMatchObject({ kind: "ok", thread_id: "dur-local" })
        expect(result).not.toHaveProperty("device")
      }
      expect(admittedOn()).toEqual([])
    },
  )

  test("unchanged: #given a delivery relayed from b #when the run replies by the sender's id and by its stated name #then both reach b's listed row", async () => {
    const { reply, admittedOn } = await consumed(
      [{ id: "device:b/d-1", session_id: "dur-on-b", name: "on b" }],
      [B_ROW],
    )
    expect(await reply("dur-on-b")).toMatchObject({ kind: "ok", thread_id: "dur-on-b", device: "b" })
    expect(await reply("on b")).toMatchObject({ kind: "ok", thread_id: "dur-on-b", device: "b" })
    expect(admittedOn()).toEqual(["b", "b"])
  })

  test("unchanged: #given a run that consumed no delivery #when it sends by id and by name #then each resolves as before: b's id to b, the local name here", async () => {
    const { reply, admittedOn } = await consumed([], [B_ROW])
    expect(await reply("dur-on-b")).toMatchObject({ kind: "ok", thread_id: "dur-on-b", device: "b" })
    const here = await reply("local peer")
    expect(here).toMatchObject({ kind: "ok", thread_id: "dur-local" })
    expect(here).not.toHaveProperty("device")
    expect(admittedOn()).toEqual(["b"])
  })
})
