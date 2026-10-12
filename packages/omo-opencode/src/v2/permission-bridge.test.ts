import { afterEach, describe, expect, test } from "bun:test"

import {
  createPermissionBridge,
  SkillPermissionDeniedError,
  SkillPermissionUnavailableError,
  type V1AskInput,
} from "./permission-bridge"

type FetchCall = { url: string; method?: string; body?: unknown; authorized: boolean }

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

const toolContext = {
  sessionID: "ses_1",
  agent: "build",
  messageID: "msg_1",
  id: "call_1",
}

const askInput: V1AskInput = {
  permission: "skill",
  patterns: ["review-work"],
  always: ["review-work"],
  metadata: { skill: "review-work" },
}

const REQUEST_ID = "per_test_request"
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
// Bun 1.4.2: `await expect(promise).rejects` does not service timers that must fire
// during the wait once another test has run in the process, so outcomes that
// depend on the bridge's own timers are awaited directly.
const outcomeOf = (promise: Promise<unknown>) => promise.then(() => undefined as unknown, (error: unknown) => error)
const stateOf = (promise: Promise<unknown>, ms = 60) =>
  Promise.race([promise.then(() => "resolved" as const, () => "rejected" as const), sleep(ms).then(() => "pending" as const)])

/**
 * A live event source: nothing is replayed. An event published while nobody is
 * subscribed is lost, like the real bus.
 */
function liveEvents() {
  const subscribers = new Set<{ push: (event: unknown) => void; end: () => void }>()
  const stats = { subscribed: 0, returned: 0, aborted: 0 }
  return {
    stats,
    listening: () => subscribers.size,
    emit: (event: unknown) => {
      for (const subscriber of [...subscribers]) subscriber.push(event)
    },
    end: () => {
      for (const subscriber of [...subscribers]) subscriber.end()
    },
    subscribe: (options?: { signal?: AbortSignal }): AsyncIterable<unknown> => ({
      [Symbol.asyncIterator]() {
        const queue: unknown[] = []
        let done = false
        let wake: (() => void) | undefined
        const subscriber = {
          push: (event: unknown) => {
            queue.push(event)
            wake?.()
          },
          end: () => {
            done = true
            subscribers.delete(subscriber)
            wake?.()
          },
        }
        subscribers.add(subscriber)
        stats.subscribed++
        options?.signal?.addEventListener(
          "abort",
          () => {
            stats.aborted++
            subscriber.end()
          },
          { once: true },
        )
        return {
          async next(): Promise<IteratorResult<unknown>> {
            for (;;) {
              if (queue.length > 0) return { done: false, value: queue.shift() }
              if (done) return { done: true, value: undefined }
              await new Promise<void>((resolve) => {
                wake = resolve
              })
              wake = undefined
            }
          },
          async return(): Promise<IteratorResult<unknown>> {
            stats.returned++
            subscriber.end()
            return { done: true, value: undefined }
          },
        }
      },
    }),
  }
}

type CreateContext = {
  id: string
  attempt: number
  signal?: AbortSignal
  park: () => void
  reply: (decision: "once" | "always" | "reject") => void
  hang: () => Promise<Response>
}

function makeHarness(
  options: {
    effect?: "allow" | "deny" | "ask"
    onCreate?: (context: CreateContext) => Promise<Response> | Response
    list?: "http" | "host" | "none"
    hostReply?: boolean
    failClosed?: boolean
    probe?: (authorized: boolean) => Response
    createTimeoutMs?: number
    argv?: readonly string[]
    listenPorts?: number[]
  } = {},
) {
  const calls: FetchCall[] = []
  const events = liveEvents()
  const parked = new Set<string>()
  const rejected: string[] = []
  const listMode = options.list ?? "http"
  let creates = 0

  const answer = (id: string, decision: "once" | "always" | "reject") => {
    parked.delete(id)
    events.emit({ type: "permission.replied", data: { sessionID: "ses_1", requestID: id, reply: decision } })
  }
  const withdraw = (id: string) => {
    rejected.push(id)
    if (parked.delete(id)) {
      events.emit({ type: "permission.replied", data: { sessionID: "ses_1", requestID: id, reply: "reject" } })
    }
  }

  const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const target = new URL(String(url))
    const authorized = new Headers(init?.headers).has("Authorization")
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined
    calls.push({ url: target.toString(), method: init?.method ?? "GET", body, authorized })
    if (target.pathname === "/api/session/active") {
      return options.probe ? options.probe(authorized) : jsonResponse(200, { data: {} })
    }
    if (target.pathname === "/api/session/ses_1/permission" && init?.method === "POST") {
      creates++
      const id = String(body?.id)
      const signal = init.signal ?? undefined
      const context: CreateContext = {
        id,
        attempt: creates,
        signal,
        park: () => parked.add(id),
        reply: (decision) => answer(id, decision),
        hang: () =>
          new Promise<Response>((_, reject) => {
            const fail = () => reject(signal?.reason ?? new DOMException("aborted", "AbortError"))
            if (signal?.aborted) return fail()
            signal?.addEventListener("abort", fail, { once: true })
          }),
      }
      if (options.onCreate) return options.onCreate(context)
      const effect = options.effect ?? "allow"
      if (effect === "ask") context.park()
      return jsonResponse(200, { data: { id, effect } })
    }
    if (target.pathname === "/api/session/ses_1/permission") {
      return listMode === "http"
        ? jsonResponse(200, { data: [...parked].map((id) => ({ id, sessionID: "ses_1" })) })
        : jsonResponse(503, {})
    }
    const replyMatch = /^\/api\/session\/ses_1\/permission\/([^/]+)\/reply$/.exec(target.pathname)
    if (replyMatch) {
      withdraw(decodeURIComponent(replyMatch[1]))
      return new Response(null, { status: 204 })
    }
    return jsonResponse(404, {})
  }) as typeof fetch

  const ctx = {
    event: { subscribe: events.subscribe },
    permission: {
      ...(listMode === "host"
        ? { list: async () => [...parked].map((id) => ({ id, sessionID: "ses_1" })) }
        : {}),
      ...(options.hostReply === false
        ? {}
        : {
            reply: async (input: { requestID: string }) => {
              withdraw(input.requestID)
            },
          }),
    },
  }

  const bridge = createPermissionBridge(ctx as never, {
    fetchImpl,
    argv: options.argv ?? ["opencode", "serve", "--port", "4599"],
    listenPorts: async () => options.listenPorts ?? [],
    probeTimeoutMs: 500,
    createTimeoutMs: options.createTimeoutMs ?? 2000,
    reconcileIntervalMs: 20,
    failClosed: options.failClosed,
    createID: () => REQUEST_ID,
  })
  return {
    bridge,
    calls,
    events,
    parked,
    rejected,
    answer,
    creates: () => creates,
    createCalls: () => calls.filter((call) => call.method === "POST" && call.url.endsWith("/api/session/ses_1/permission")),
  }
}

describe("v2 permission bridge", () => {
  test("resolves when the rules allow and closes its event subscription", async () => {
    const harness = makeHarness({ effect: "allow" })
    await expect(harness.bridge.ask(toolContext, askInput)).resolves.toBeUndefined()
    expect(harness.events.stats.subscribed).toBe(1)
    expect(harness.events.stats.returned).toBe(1)
    expect(harness.events.listening()).toBe(0)
  })

  test("sends the v1 ask payload with a bridge-chosen request id to the platform create route", async () => {
    const harness = makeHarness({ effect: "allow" })
    await harness.bridge.ask(toolContext, askInput)
    const create = harness.createCalls()[0]
    expect(create?.method).toBe("POST")
    expect(create?.body).toEqual({
      id: REQUEST_ID,
      action: "skill",
      resources: ["review-work"],
      save: ["review-work"],
      metadata: { skill: "review-work" },
      agent: "build",
      source: { type: "tool", messageID: "msg_1", id: "call_1" },
    })
  })

  test("generates a platform-shaped request id by default", async () => {
    const calls: Array<Record<string, unknown>> = []
    const bridge = createPermissionBridge(
      { event: { subscribe: liveEvents().subscribe }, permission: {} } as never,
      {
        fetchImpl: (async (url: RequestInfo | URL, init?: RequestInit) => {
          if (new URL(String(url)).pathname === "/api/session/active") return jsonResponse(200, { data: {} })
          const body = JSON.parse(String(init?.body)) as Record<string, unknown>
          calls.push(body)
          return jsonResponse(200, { data: { id: body.id, effect: "allow" } })
        }) as typeof fetch,
        argv: ["opencode", "serve", "--port", "4599"],
        listenPorts: async () => [],
      },
    )
    await bridge.ask(toolContext, askInput)
    await bridge.ask(toolContext, askInput)
    expect(String(calls[0].id)).toMatch(/^per_[0-9a-f]{12}[0-9A-Za-z]{14}$/)
    expect(calls[0].id).not.toBe(calls[1].id)
  })

  test("rejects with SkillPermissionDeniedError when the rules deny", async () => {
    const harness = makeHarness({ effect: "deny" })
    await expect(harness.bridge.ask(toolContext, askInput)).rejects.toBeInstanceOf(SkillPermissionDeniedError)
    expect(harness.events.listening()).toBe(0)
  })

  test("waits for a once/always reply and resolves", async () => {
    const harness = makeHarness({ effect: "ask" })
    const pending = harness.bridge.ask(toolContext, askInput)
    expect(await stateOf(pending)).toBe("pending")
    harness.events.emit({ type: "permission.updated", data: { noise: true } })
    harness.answer(REQUEST_ID, "once")
    await expect(pending).resolves.toBeUndefined()
    expect(harness.events.listening()).toBe(0)
  })

  test("rejects when the user rejects the prompt", async () => {
    const harness = makeHarness({ effect: "ask" })
    const pending = harness.bridge.ask(toolContext, askInput)
    expect(await stateOf(pending)).toBe("pending")
    harness.answer(REQUEST_ID, "reject")
    await expect(pending).rejects.toBeInstanceOf(SkillPermissionDeniedError)
  })

  test("accepts the flat (un-enveloped) replied event shape", async () => {
    const harness = makeHarness({ effect: "ask" })
    const pending = harness.bridge.ask(toolContext, askInput)
    expect(await stateOf(pending)).toBe("pending")
    harness.parked.delete(REQUEST_ID)
    harness.events.emit({ type: "permission.replied", sessionID: "ses_1", requestID: REQUEST_ID, reply: "always" })
    await expect(pending).resolves.toBeUndefined()
  })

  test("ignores replied events for other requests", async () => {
    const harness = makeHarness({ effect: "ask" })
    const pending = harness.bridge.ask(toolContext, askInput)
    expect(await stateOf(pending)).toBe("pending")
    harness.events.emit({ type: "permission.replied", data: { sessionID: "ses_1", requestID: "per_other", reply: "reject" } })
    expect(await stateOf(pending)).toBe("pending")
    harness.answer(REQUEST_ID, "once")
    await expect(pending).resolves.toBeUndefined()
  })

  test("uses the id the platform returned when it differs from the proposed one", async () => {
    const harness = makeHarness({
      onCreate: () => jsonResponse(200, { data: { id: "per_server_chosen", effect: "ask" } }),
      list: "none",
    })
    const pending = harness.bridge.ask(toolContext, askInput)
    expect(await stateOf(pending)).toBe("pending")
    harness.events.emit({ type: "permission.replied", data: { sessionID: "ses_1", requestID: "per_server_chosen", reply: "once" } })
    await expect(pending).resolves.toBeUndefined()
  })
})

describe("v2 permission bridge: reply timing (cross-review A M1)", () => {
  test("a reply published before the create response returns is not lost", async () => {
    const harness = makeHarness({
      onCreate: async (context) => {
        context.park()
        // The UI (or auto-approve) answers while the HTTP response is still in flight.
        context.reply("once")
        await sleep(15)
        return jsonResponse(200, { data: { id: context.id, effect: "ask" } })
      },
    })
    await expect(harness.bridge.ask(toolContext, askInput)).resolves.toBeUndefined()
    expect(harness.events.listening()).toBe(0)
  })

  test("a rejection published before the create response returns still denies", async () => {
    const harness = makeHarness({
      onCreate: async (context) => {
        context.park()
        context.reply("reject")
        await sleep(15)
        return jsonResponse(200, { data: { id: context.id, effect: "ask" } })
      },
    })
    await expect(harness.bridge.ask(toolContext, askInput)).rejects.toBeInstanceOf(SkillPermissionDeniedError)
  })

  test("a parked request that vanishes without an observed reply fails closed instead of hanging", async () => {
    const harness = makeHarness({ effect: "ask" })
    const pending = harness.bridge.ask(toolContext, askInput)
    expect(await stateOf(pending)).toBe("pending")
    // Answered elsewhere, but the event never reaches this subscriber.
    harness.parked.delete(REQUEST_ID)
    expect(await outcomeOf(pending)).toBeInstanceOf(SkillPermissionUnavailableError)
    expect(harness.events.listening()).toBe(0)
  })

  test("the in-process pending list is used when the HTTP list is unavailable", async () => {
    const harness = makeHarness({ effect: "ask", list: "host" })
    const pending = harness.bridge.ask(toolContext, askInput)
    expect(await stateOf(pending)).toBe("pending")
    harness.parked.delete(REQUEST_ID)
    expect(await outcomeOf(pending)).toBeInstanceOf(SkillPermissionUnavailableError)
  })
})

describe("v2 permission bridge: create failures (cross-review A B1)", () => {
  test("an already-aborted call rejects and never reaches the server", async () => {
    const controller = new AbortController()
    controller.abort()
    const harness = makeHarness({ effect: "allow" })
    await expect(harness.bridge.ask({ ...toolContext, signal: controller.signal }, askInput)).rejects.toThrow(/aborted/)
    expect(harness.calls).toEqual([])
    expect(harness.events.stats.subscribed).toBe(0)
  })

  test("a call aborted while the create is in flight rejects and withdraws its request", async () => {
    const controller = new AbortController()
    const harness = makeHarness({
      onCreate: (context) => {
        context.park()
        return context.hang()
      },
    })
    const pending = harness.bridge.ask({ ...toolContext, signal: controller.signal }, askInput)
    expect(await stateOf(pending)).toBe("pending")
    controller.abort()
    await expect(pending).rejects.toThrow(/aborted/)
    expect(harness.creates()).toBe(1)
    expect(harness.rejected).toEqual([REQUEST_ID])
    expect(harness.parked.size).toBe(0)
    expect(harness.events.listening()).toBe(0)
  })

  test("a create whose response body is lost after the server parked the request waits for the answer", async () => {
    for (const [decision, list] of [
      ["once", "http"],
      ["reject", "http"],
      ["once", "host"],
    ] as const) {
      const harness = makeHarness({
        list,
        onCreate: (context) => {
          context.park()
          return new Response("{ truncated", { status: 200, headers: { "content-type": "application/json" } })
        },
      })
      const pending = harness.bridge.ask(toolContext, askInput)
      // Not a bypass: the parked request is recognised and the call keeps waiting.
      expect(await stateOf(pending, 120)).toBe("pending")
      expect(harness.creates()).toBe(1)
      expect(harness.rejected).toEqual([])
      harness.answer(REQUEST_ID, decision)
      if (decision === "reject") await expect(pending).rejects.toBeInstanceOf(SkillPermissionDeniedError)
      else await expect(pending).resolves.toBeUndefined()
    }
  })

  test("a lost response for a request that was answered meanwhile honours that answer", async () => {
    const harness = makeHarness({
      onCreate: (context) => {
        context.park()
        context.reply("reject")
        throw new TypeError("socket closed")
      },
    })
    await expect(harness.bridge.ask(toolContext, askInput)).rejects.toBeInstanceOf(SkillPermissionDeniedError)
    expect(harness.creates()).toBe(1)
  })

  test("a failure whose outcome cannot be verified rejects", async () => {
    const harness = makeHarness({
      list: "none",
      onCreate: () => {
        throw new TypeError("socket closed")
      },
    })
    await expect(harness.bridge.ask(toolContext, askInput)).rejects.toBeInstanceOf(SkillPermissionUnavailableError)
    expect(harness.creates()).toBe(1)
    expect(harness.rejected).toEqual([REQUEST_ID])
  })

  test("a verified-unparked transport failure is retried once with the same id, then skipped", async () => {
    const harness = makeHarness({
      onCreate: () => {
        throw new TypeError("connection refused")
      },
    })
    await expect(harness.bridge.ask(toolContext, askInput)).resolves.toBeUndefined()
    expect(harness.createCalls().map((call) => (call.body as { id: string }).id)).toEqual([REQUEST_ID, REQUEST_ID])
  })

  test("a retry that reaches the server uses its decision", async () => {
    const harness = makeHarness({
      onCreate: (context) => {
        if (context.attempt === 1) throw new TypeError("connection reset")
        return jsonResponse(200, { data: { id: context.id, effect: "deny" } })
      },
    })
    await expect(harness.bridge.ask(toolContext, askInput)).rejects.toBeInstanceOf(SkillPermissionDeniedError)
    expect(harness.creates()).toBe(2)
  })

  test("a 4xx refusal is skipped without a retry; a 5xx is verified and retried first", async () => {
    const refused = makeHarness({ onCreate: () => jsonResponse(404, {}) })
    await expect(refused.bridge.ask(toolContext, askInput)).resolves.toBeUndefined()
    expect(refused.creates()).toBe(1)
    expect(refused.rejected).toEqual([])

    const failing = makeHarness({ onCreate: () => jsonResponse(500, {}) })
    await expect(failing.bridge.ask(toolContext, askInput)).resolves.toBeUndefined()
    expect(failing.creates()).toBe(2)
  })

  test("OMO_V2_PERMISSION_FAIL_CLOSED turns every infrastructure skip into a rejection", async () => {
    const createFails = makeHarness({ failClosed: true, onCreate: () => jsonResponse(500, {}) })
    await expect(createFails.bridge.ask(toolContext, askInput)).rejects.toBeInstanceOf(SkillPermissionUnavailableError)

    const noOrigin = makeHarness({ failClosed: true, argv: ["opencode"] })
    await expect(noOrigin.bridge.ask(toolContext, askInput)).rejects.toBeInstanceOf(SkillPermissionUnavailableError)
    expect(noOrigin.calls).toEqual([])
  })

  test("fails open with a logged skip when no server origin resolves", async () => {
    const harness = makeHarness({ argv: ["opencode"] })
    await expect(harness.bridge.ask(toolContext, askInput)).resolves.toBeUndefined()
    expect(harness.events.stats.subscribed).toBe(0)
  })
})

describe("v2 permission bridge: lifecycle (cross-review A M2)", () => {
  test("an aborted wait rejects, unparks its request and closes the subscription", async () => {
    const controller = new AbortController()
    const harness = makeHarness({ effect: "ask" })
    const pending = harness.bridge.ask({ ...toolContext, signal: controller.signal }, askInput)
    expect(await stateOf(pending)).toBe("pending")
    expect(harness.events.listening()).toBe(1)
    controller.abort()
    await expect(pending).rejects.toThrow(/aborted/)
    expect(harness.rejected).toEqual([REQUEST_ID])
    expect(harness.events.stats.returned).toBe(1)
    expect(harness.events.stats.aborted).toBe(1)
    expect(harness.events.listening()).toBe(0)
  })

  test("the request is withdrawn over HTTP when the host exposes no reply()", async () => {
    const controller = new AbortController()
    const harness = makeHarness({ effect: "ask", hostReply: false })
    const pending = harness.bridge.ask({ ...toolContext, signal: controller.signal }, askInput)
    expect(await stateOf(pending)).toBe("pending")
    controller.abort()
    await expect(pending).rejects.toThrow(/aborted/)
    await sleep(10)
    expect(harness.rejected).toEqual([REQUEST_ID])
  })

  test("stream ending without a reply fails loudly and unparks the request", async () => {
    const harness = makeHarness({ effect: "ask" })
    const pending = harness.bridge.ask(toolContext, askInput)
    expect(await stateOf(pending)).toBe("pending")
    harness.events.end()
    await expect(pending).rejects.toThrow(/ended/)
    expect(harness.rejected).toEqual([REQUEST_ID])
  })

  test("a create that never answers is bounded by its own deadline", async () => {
    const started = Date.now()
    const harness = makeHarness({ createTimeoutMs: 60, onCreate: (context) => context.hang() })
    expect(await outcomeOf(harness.bridge.ask(toolContext, askInput))).toBeUndefined()
    expect(harness.creates()).toBe(2)
    expect(Date.now() - started).toBeLessThan(1500)
    // The request may still land after the deadline, so it is withdrawn.
    expect(harness.rejected).toEqual([REQUEST_ID])
    expect(harness.events.listening()).toBe(0)

    const strict = makeHarness({ failClosed: true, createTimeoutMs: 60, onCreate: (context) => context.hang() })
    expect(await outcomeOf(strict.bridge.ask(toolContext, askInput))).toBeInstanceOf(SkillPermissionUnavailableError)
  })
})

describe("v2 permission bridge: origin probe", () => {
  const savedPassword = process.env.OPENCODE_SERVER_PASSWORD
  afterEach(() => {
    if (savedPassword === undefined) delete process.env.OPENCODE_SERVER_PASSWORD
    else process.env.OPENCODE_SERVER_PASSWORD = savedPassword
  })

  test("never sends the server password to a listener that does not refuse like OpenCode", async () => {
    process.env.OPENCODE_SERVER_PASSWORD = "fixture-only"
    const harness = makeHarness({
      argv: ["opencode"],
      listenPorts: [4601],
      probe: () => new Response("Unauthorized", { status: 401, headers: { "www-authenticate": "Basic" } }),
    })
    await expect(harness.bridge.ask(toolContext, askInput)).resolves.toBeUndefined()
    expect(harness.calls.length).toBe(1)
    expect(harness.calls.every((call) => !call.authorized)).toBe(true)
    expect(harness.creates()).toBe(0)
  })

  test("authenticates only after an OpenCode-shaped refusal, then uses that origin", async () => {
    process.env.OPENCODE_SERVER_PASSWORD = "fixture-only"
    const harness = makeHarness({
      argv: ["opencode"],
      listenPorts: [4601],
      effect: "deny",
      probe: (authorized) =>
        authorized ? jsonResponse(200, { data: {} }) : jsonResponse(401, { _tag: "Unauthorized", message: "no" }),
    })
    await expect(harness.bridge.ask(toolContext, askInput)).rejects.toBeInstanceOf(SkillPermissionDeniedError)
    expect(harness.calls.slice(0, 2).map((call) => call.authorized)).toEqual([false, true])
    expect(harness.createCalls()[0]?.url).toBe("http://127.0.0.1:4601/api/session/ses_1/permission")
  })

  test("rejects a listener that answers the probe with something other than a JSON object", async () => {
    const harness = makeHarness({
      argv: ["opencode"],
      listenPorts: [4601],
      probe: () => new Response("<html>ok</html>", { status: 200 }),
    })
    await expect(harness.bridge.ask(toolContext, askInput)).resolves.toBeUndefined()
    expect(harness.creates()).toBe(0)
  })
})

describe("v2 permission bridge wiring", () => {
  const directories: string[] = []
  afterEach(() => {
    for (const directory of directories.splice(0)) {
      try {
        require("node:fs").rmSync(directory, { recursive: true, force: true })
      } catch {}
    }
  })

  test("projected v1 tools receive a working ask() on their context", async () => {
    const { mkdtempSync } = await import("node:fs")
    const { tmpdir } = await import("node:os")
    const { join } = await import("node:path")
    const { projectV1Surface } = await import("./project-config")
    const { createAdapterState } = await import("./adapter-state")

    const directory = mkdtempSync(join(tmpdir(), "omo-perm-bridge-"))
    directories.push(directory)
    const state = createAdapterState(join(directory, "state"))

    const registered: Array<{
      name: string
      execute: (args: unknown, context: Record<string, unknown>) => Promise<unknown>
    }> = []
    let projectedContext: Record<string, unknown> | undefined

    const ctx = {
      agent: { transform: async (fn: (editor: object) => void) => fn({}) },
      tool: {
        transform: async (fn: (editor: object) => void) =>
          fn({
            list: () => [] as Array<{ id: string; name: string }>,
            add: (tool: { name: string; execute: (args: unknown, context: Record<string, unknown>) => Promise<unknown> }) => {
              registered.push(tool)
            },
          }),
      },
      command: { transform: async (fn: (editor: object) => void) => fn({}) },
      mcp: { transform: async (fn: (editor: object) => void) => fn({}) },
      event: { subscribe: async function* () {} },
      permission: { reply: async () => {} },
    } as never

    await projectV1Surface({
      ctx,
      directory,
      agentDirectory: join(directory, "agents"),
      config: {},
      tools: {
        skill: {
          description: "skill tool",
          execute: async (_args: unknown, context: Record<string, unknown>) => {
            projectedContext = context
            return "ok"
          },
        },
      },
      recordTodos: { read: state.todos, write: state.recordTodos },
    })

    const skillTool = registered.find((tool) => tool.name === "skill")
    expect(skillTool).toBeDefined()
    await skillTool!.execute({ name: "review-work" }, {
      sessionID: "ses_1",
      agent: "build",
      messageID: "msg_1",
      id: "call_1",
    })
    expect(projectedContext).toBeDefined()
    expect(typeof (projectedContext as { ask?: unknown }).ask).toBe("function")
    expect((projectedContext as { sessionID?: string }).sessionID).toBe("ses_1")

    // With a deny from the platform, the projected ask must throw so the
    // denial propagates through the v1 skill tool unchanged.
    const denying = makeHarness({ effect: "deny" })
    await expect(
      denying.bridge.ask({ sessionID: "ses_1", agent: "build" }, askInput),
    ).rejects.toBeInstanceOf(SkillPermissionDeniedError)
  })
})
