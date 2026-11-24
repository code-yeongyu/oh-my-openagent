import { afterEach, expect, mock, spyOn, test } from "bun:test"
import { Database } from "bun:sqlite"
import { EventEmitter } from "node:events"
import type { Socket } from "node:net"
import { existsSync } from "node:fs"
import { connectDeviceService } from "@oh-my-opencode/device-service-core/device-service"
import { gatewayDatabasePath } from "./gateway/paths"
import { createLiveThreadSurface } from "./live-surface"
import { createServiceAliasRegistry } from "./remote/alias-registry"
import { closingPorts } from "./remote/testing/closing-ports"
import { createRemoteThreadFixture } from "./thread-remote-fixture"

const { account, surface, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)
const sessionsPort = closingPorts()
const cancelled = { kind: "error", error: { code: "cancelled" } }

function gate() {
  const entered = Promise.withResolvers<void>()
  const resume = Promise.withResolvers<void>()
  return {
    entered: entered.promise,
    resume: resume.resolve,
    pause: () => {
      entered.resolve()
      return resume.promise
    },
  }
}

function receipts(dir: string, key: string) {
  const path = gatewayDatabasePath(dir)
  if (!existsSync(path)) return []
  const db = new Database(path, { readonly: true })
  try {
    return db.query("SELECT status FROM receipts WHERE idempotency_key = ?").all(key)
  } finally {
    db.close()
  }
}

test("cold SDK endpoint lookup: abort sends no open and a same-key retry opens once", async () => {
  const lookup = gate()
  const closed = Promise.withResolvers<void>()
  const { remote } = account()
  const commandTo = mock(async (_target: unknown, _rpc: unknown, command_id: string) => {
    event({
      kind: "session.command_event",
      device: "b",
      command_id,
      response: {
        success: true,
        data: { sessionId: "rpc-9", state: { durableSessionId: "dur-new-on-b" } },
      },
    })
    event({ kind: "session.command_state", command_id, state: "engine_applied" })
    return command_id
  })
  let event: (frame: Record<string, unknown>) => void = () => {}
  const conn = await connectDeviceService({
    version: "test",
    connect: async () =>
      ({
        welcome: { service_version: "0.1.11", capabilities: [], state: "connected" },
        request: async (type: string) => {
          if (type !== "session.endpoints") throw new Error(type)
          await lookup.pause()
          return { endpoints: ["host"], primary: "host" }
        },
        commandTo,
        onEvent: (listener: typeof event) => {
          event = listener
          return () => {}
        },
        close: closed.resolve,
        closed: new Promise<void>(() => {}),
      }) as never,
  })
  const port = sessionsPort({ version: "test", dialEndpoint: async () => ({ conn, owned: true }) })
  const { run, agentDir } = surface({
    ...remote,
    sessions: { ...remote.sessions, endpointCommand: port.endpointCommand },
  })
  const args = { device: "studio", name: "cold", idempotency_key: "cold" }
  const controller = new AbortController()
  const call = run("thread_create", args, controller.signal)
  await lookup.entered
  const preparing = receipts(agentDir, args.idempotency_key)
  controller.abort()
  try {
    expect(await call).toMatchObject(cancelled)
  } finally {
    lookup.resume()
  }
  await closed.promise
  expect({ writes: commandTo.mock.calls.length, preparing }).toEqual({ writes: 0, preparing: [] })
  expect(await run("thread_create", args)).toMatchObject({ kind: "ok" })
  expect(commandTo).toHaveBeenCalledTimes(1)
})

// Each socket is synthetic. A reply (including an attach acknowledgement) is delivered only when its gate opens.
test.each(["get_protocol_info", "attach_session", "set_model"])(
  "local %s: cancellation respects the write and releases the attachment",
  async (stage) => {
    const paused = gate()
    const closed = Promise.withResolvers<void>()
    const frames: string[] = []
    const live = createLiveThreadSurface(undefined, {
      socket: "/synthetic/rpc.sock",
      exists: () => true,
      connect: () => {
        const socket = Object.assign(new EventEmitter(), {
          destroy: closed.resolve,
          write: (line: string) => {
            const { type, id } = JSON.parse(line) as { type: string; id: string }
            frames.push(type)
            const data =
              type === "get_protocol_info"
                ? { capabilities: ["attach_session", "release_attachment"] }
                : type === "set_model"
                  ? { provider: "p", id: "m" }
                  : {}
            void (async () => {
              if (type === stage) await paused.pause()
              socket.emit("data", Buffer.from(JSON.stringify({ id, type: "response", success: true, data }) + "\n"))
            })()
            return true
          },
        })
        queueMicrotask(() => socket.emit("connect"))
        return socket as unknown as Socket
      },
    })
    const { host, run, agentDir, store } = surface(undefined)
    Object.assign(host, { setModel: live.setModel })
    spyOn(host, "getAvailableModels").mockResolvedValue([{ provider: "p", id: "m" }])
    const settled = Promise.withResolvers<void>()
    const settle = store.toolReceiptSettle.bind(store)
    spyOn(store, "toolReceiptSettle").mockImplementation(async (req) => {
      const recorded = await settle(req)
      settled.resolve()
      return recorded
    })
    const args = { thread: "dur-local", model: "p/m", idempotency_key: "model" }
    const controller = new AbortController()
    const call = run("thread_set_model", args, controller.signal)
    await paused.entered
    const preparing = receipts(agentDir, args.idempotency_key)
    controller.abort()
    try {
      expect(await call).toMatchObject(cancelled)
      if (stage === "set_model")
        expect(await run("thread_set_model", args)).toMatchObject({ error: { code: "idempotency_in_progress" } })
    } finally {
      paused.resume()
    }
    await closed.promise
    expect(frames.filter((x) => x === "release_attachment")).toHaveLength(
      frames.filter((x) => x === "attach_session").length,
    )
    if (stage === "set_model") await settled.promise
    else
      expect({ writes: frames.filter((x) => x === "set_model").length, preparing }).toEqual({
        writes: 0,
        preparing: [],
      })
    expect(await run("thread_set_model", args)).toMatchObject({ kind: "ok", model: { provider: "p", id: "m" } })
    expect(frames.filter((x) => x === "set_model")).toHaveLength(1)
  },
)

test.each(["claim", "rename"])(
  "alias %s: abort during access sends no mutation POST and the key stays reusable",
  async (op) => {
    const paused = gate()
    const { remote } = account()
    const post = mock(async (_request: Request) =>
      Response.json({ alias_value: "next", session_value: "dur-local", device: "here" }),
    )
    let firstAccess = true
    const registry = createServiceAliasRegistry({
      origin: "https://alias.invalid",
      accessToken: async () => {
        if (!firstAccess) return "retry"
        firstAccess = false
        await paused.pause()
        return "cancelled"
      },
      fetch: post,
    })
    const aliases = {
      ...registry,
      aliasesOf: async () => ({ kind: "ok" as const, value: new Map(op === "rename" ? [["dur-local", "old"]] : []) }),
    }
    const { run, agentDir } = surface({ ...remote, aliases })
    const args = { thread: "dur-local", alias: "next", idempotency_key: "alias" }
    const controller = new AbortController()
    const call = run("thread_rename", args, controller.signal)
    await paused.entered
    const preparing = receipts(agentDir, args.idempotency_key)
    controller.abort()
    try {
      expect(await call).toMatchObject(cancelled)
    } finally {
      paused.resume()
    }
    const retry = await run("thread_rename", args)
    expect({
      preparing,
      writers: post.mock.calls.map(([req]) => req.headers.get("authorization")),
      retry,
    }).toMatchObject({
      preparing: [],
      writers: ["Bearer retry"],
      retry: { kind: "ok", alias: "next" },
    })
  },
)
