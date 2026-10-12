import { afterEach, describe, expect, test } from "bun:test"

import {
  createPermissionBridge,
  SkillPermissionDeniedError,
  type V1AskInput,
} from "./permission-bridge"

type FetchCall = { url: string; method?: string; body?: unknown }

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

function makeHarness(options: {
  createEffect?: "allow" | "deny" | "ask"
  createStatus?: number
  events?: Array<Record<string, unknown>>
  hangEvents?: boolean
  recordFetch?: Array<FetchCall>
  replies?: Array<Record<string, unknown>>
}) {
  const calls: FetchCall[] = options.recordFetch ?? []
  const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const target = new URL(String(url))
    calls.push({
      url: target.toString(),
      method: init?.method,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    })
    if (target.pathname === "/api/session/active") return jsonResponse(200, { data: {} })
    if (target.pathname === "/api/session/ses_1/permission") {
      if (options.createStatus !== undefined) return jsonResponse(options.createStatus, {})
      return jsonResponse(200, {
        data: { id: "req_1", effect: options.createEffect ?? "allow" },
      })
    }
    return jsonResponse(404, {})
  }) as typeof fetch

  const ctx = {
    event: {
      subscribe: async function* () {
        if (options.hangEvents) {
          await new Promise<void>(() => {})
          return
        }
        for (const event of options.events ?? []) yield event
      },
    },
    permission: {
      reply: async (input: Record<string, unknown>) => {
        ;(options.replies ??= []).push(input)
      },
    },
  } as never

  const bridge = createPermissionBridge(ctx as never, {
    fetchImpl,
    argv: ["opencode", "serve", "--port", "4599"],
    listenPort: async () => undefined,
    probeTimeoutMs: 500,
  })
  return { bridge, calls, fetchImpl, ctx }
}

describe("v2 permission bridge", () => {
  test("resolves without consuming events when the rules allow", async () => {
    const { bridge } = makeHarness({ createEffect: "allow", events: [] })
    await expect(bridge.ask(toolContext, askInput)).resolves.toBeUndefined()
  })

  test("sends the v1 ask payload to the platform create route", async () => {
    const calls: FetchCall[] = []
    const { bridge } = makeHarness({ createEffect: "allow", recordFetch: calls })
    await bridge.ask(toolContext, askInput)
    const create = calls.find((call) => call.url.endsWith("/api/session/ses_1/permission"))
    expect(create?.method).toBe("POST")
    expect(create?.body).toEqual({
      action: "skill",
      resources: ["review-work"],
      save: ["review-work"],
      metadata: { skill: "review-work" },
      agent: "build",
      source: { type: "tool", messageID: "msg_1", id: "call_1" },
    })
  })

  test("rejects with SkillPermissionDeniedError when the rules deny", async () => {
    const { bridge } = makeHarness({ createEffect: "deny", events: [] })
    await expect(bridge.ask(toolContext, askInput)).rejects.toBeInstanceOf(SkillPermissionDeniedError)
  })

  test("waits for a once/always reply and resolves", async () => {
    const { bridge } = makeHarness({
      createEffect: "ask",
      events: [
        { type: "permission.updated", data: { noise: true } },
        { type: "permission.replied", data: { sessionID: "ses_1", requestID: "req_1", reply: "once" } },
      ],
    })
    await expect(bridge.ask(toolContext, askInput)).resolves.toBeUndefined()
  })

  test("rejects when the user rejects the prompt", async () => {
    const { bridge } = makeHarness({
      createEffect: "ask",
      events: [
        { type: "permission.replied", data: { sessionID: "ses_1", requestID: "req_1", reply: "reject" } },
      ],
    })
    await expect(bridge.ask(toolContext, askInput)).rejects.toBeInstanceOf(SkillPermissionDeniedError)
  })

  test("accepts the flat (un-enveloped) replied event shape", async () => {
    const { bridge } = makeHarness({
      createEffect: "ask",
      events: [
        { type: "permission.replied", sessionID: "ses_1", requestID: "req_1", reply: "always" },
      ],
    })
    await expect(bridge.ask(toolContext, askInput)).resolves.toBeUndefined()
  })

  test("ignores replied events for other requests", async () => {
    const { bridge } = makeHarness({
      createEffect: "ask",
      events: [
        { type: "permission.replied", data: { sessionID: "ses_1", requestID: "req_other", reply: "reject" } },
        { type: "permission.replied", data: { sessionID: "ses_1", requestID: "req_1", reply: "once" } },
      ],
    })
    await expect(bridge.ask(toolContext, askInput)).resolves.toBeUndefined()
  })

  test("aborted tool call rejects and unparks its own request", async () => {
    const replies: Array<Record<string, unknown>> = []
    const controller = new AbortController()
    const { bridge } = makeHarness({ createEffect: "ask", hangEvents: true, replies })
    const pending = bridge.ask({ ...toolContext, signal: controller.signal }, askInput)
    await new Promise((resolve) => setTimeout(resolve, 10))
    controller.abort()
    await expect(pending).rejects.toThrow(/aborted/)
    expect(replies).toEqual([{ sessionID: "ses_1", requestID: "req_1", decision: "reject" }])
  })

  test("stream ending without a reply fails loudly and unparks the request", async () => {
    const replies: Array<Record<string, unknown>> = []
    const { bridge } = makeHarness({ createEffect: "ask", events: [], replies })
    await expect(bridge.ask(toolContext, askInput)).rejects.toThrow(/ended/)
    expect(replies).toEqual([{ sessionID: "ses_1", requestID: "req_1", decision: "reject" }])
  })

  test("fails open with a logged skip when no server origin resolves", async () => {
    const calls: FetchCall[] = []
    const bridge = createPermissionBridge(
      {
        event: { subscribe: () => { throw new Error("must not be reached") } },
        permission: {},
      } as never,
      {
        fetchImpl: (async () => {
          throw new Error("no server expected")
        }) as typeof fetch,
        argv: ["opencode"],
        listenPort: async () => undefined,
        probeTimeoutMs: 200,
      },
    )
    void calls
    await expect(bridge.ask(toolContext, askInput)).resolves.toBeUndefined()
  })

  test("fails open with a logged skip when create errors before prompting", async () => {
    const { bridge } = makeHarness({ createStatus: 500, events: [] })
    await expect(bridge.ask(toolContext, askInput)).resolves.toBeUndefined()
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
    const { mkdtempSync, rmSync } = await import("node:fs")
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
    // The harness ctx has no origin (no --port, no netstat hit for this test
    // process), so ask() resolves via the documented fail-open path.
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
    const denyBridge = createPermissionBridge(
      {
        event: { subscribe: async function* () {} },
        permission: {},
      } as never,
      {
        fetchImpl: (async (url: RequestInfo | URL) => {
          const target = new URL(String(url))
          if (target.pathname === "/api/session/active") return jsonResponse(200, { data: {} })
          return jsonResponse(200, { data: { id: "req_d", effect: "deny" } })
        }) as typeof fetch,
        argv: ["opencode", "serve", "--port", "4599"],
        listenPort: async () => undefined,
        probeTimeoutMs: 500,
      },
    )
    await expect(
      denyBridge.ask({ sessionID: "ses_1", agent: "build" }, askInput),
    ).rejects.toBeInstanceOf(SkillPermissionDeniedError)

  })
})
