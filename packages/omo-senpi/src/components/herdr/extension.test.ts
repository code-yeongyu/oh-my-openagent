import { describe, expect, test } from "bun:test"

import type { HerdrSocketLike } from "./client"
import { createHerdrExtension } from "./extension"

type Handler = (payload: unknown, ctx?: unknown) => unknown

class FakePi {
  readonly handlers = new Map<string, Handler[]>()
  readonly busHandlers = new Map<string, ((payload: unknown) => void)[]>()
  sessionContext: Record<string, string> | undefined

  on(event: string, handler: Handler): void {
    const list = this.handlers.get(event) ?? []
    list.push(handler)
    this.handlers.set(event, list)
  }

  readonly events = {
    on: (name: string, handler: (payload: unknown) => void) => {
      const list = this.busHandlers.get(name) ?? []
      list.push(handler)
      this.busHandlers.set(name, list)
      return () => {
        this.busHandlers.set(name, (this.busHandlers.get(name) ?? []).filter((h) => h !== handler))
      }
    },
  }

  async dispatch(event: string, payload: unknown, ctx?: unknown): Promise<void> {
    for (const handler of this.handlers.get(event) ?? []) await handler(payload, ctx)
  }

  emitBus(name: string, data: unknown): void {
    for (const handler of this.busHandlers.get(name) ?? []) handler(data)
  }
}

const HERDR_ENV: NodeJS.ProcessEnv = {
  HERDR_ENV: "1",
  HERDR_PANE_ID: "pane-3",
  HERDR_SOCKET_PATH: "/tmp/herdr-test.sock",
  HERDR_BIN_PATH: "/usr/bin/herdr",
  OMO_NATIVE: "1",
}

interface HarnessOptions {
  readonly env?: NodeJS.ProcessEnv
  readonly sessionContext?: Record<string, string>
  readonly sessionId?: string
  readonly sessionName?: string
  readonly mode?: string
  readonly countChildren?: number
}

interface CapturedRequest {
  readonly id: string
  readonly method: string
  readonly params: Record<string, unknown>
}

function makeCtx(options: HarnessOptions = {}): Record<string, unknown> {
  const sessionId = options.sessionId ?? "sess-1"
  return {
    mode: options.mode ?? "tui",
    cwd: "/tmp/project",
    model: { provider: "anthropic", id: "claude-opus-5" },
    thinkingLevel: "high",
    isIdle: () => true,
    sessionManager: {
      getSessionId: () => sessionId,
      getSessionFile: () => `/sessions/${sessionId}.jsonl`,
      getSessionName: () => options.sessionName ?? "Test session",
    },
  }
}

function harness(options: HarnessOptions = {}) {
  const pi = new FakePi()
  pi.sessionContext = options.sessionContext
  const requests: CapturedRequest[] = []
  const extension = createHerdrExtension({
    env: options.env ?? HERDR_ENV,
    countChildren: () => options.countChildren ?? 0,
    connect: () => {
      const listeners = new Map<string, ((arg?: unknown) => void)[]>()
      const emit = (event: string, arg?: unknown) => {
        for (const listener of listeners.get(event) ?? []) listener(arg)
      }
      const socket: HerdrSocketLike = {
        on(event, listener) {
          const list = listeners.get(event) ?? []
          list.push(listener)
          listeners.set(event, list)
        },
        write(chunk) {
          const request = JSON.parse(chunk.trim()) as CapturedRequest
          requests.push(request)
          queueMicrotask(() => emit("data", `${JSON.stringify({ id: request.id, result: {} })}\n`))
        },
        destroy() {},
      }
      queueMicrotask(() => emit("connect"))
      return socket
    },
  })
  extension(pi)
  return { pi, requests }
}

const tick = () => new Promise((resolve) => setImmediate(resolve))

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) await tick()
}

const byMethod = (requests: CapturedRequest[], method: string) => requests.filter((r) => r.method === method)

describe("herdr extension", () => {
  test("#given no Herdr env #when a session starts #then nothing is sent", async () => {
    const { pi, requests } = harness({ env: {} })
    await pi.dispatch("session_start", { reason: "startup" }, makeCtx())
    await settle()
    expect(requests).toHaveLength(0)
  })

  test("#given a tui session #when it starts #then it reports session, metadata and idle state", async () => {
    const { pi, requests } = harness()
    await pi.dispatch("session_start", { reason: "startup" }, makeCtx())
    await settle()

    const sessions = byMethod(requests, "pane.report_agent_session")
    expect(sessions).toHaveLength(1)
    expect(sessions[0].params.agent).toBe("omo")
    expect(sessions[0].params.agent_session_path).toBe("/sessions/sess-1.jsonl")
    expect(sessions[0].params.session_start_source).toBe("startup")
    expect(sessions[0].params.resume_argv).toEqual(["omo", "--session", "sess-1", "--model", "anthropic/claude-opus-5:high"])
    expect(sessions[0].params.pane_id).toBe("pane-3")
    expect(sessions[0].params.source).toBe("custom:omo")

    const reports = byMethod(requests, "pane.report_agent")
    expect(reports).toHaveLength(1)
    expect(reports[0].params.state).toBe("idle")
    expect(reports[0].params.resume_argv).toEqual(["omo", "--session", "sess-1", "--model", "anthropic/claude-opus-5:high"])

    const metadata = byMethod(requests, "pane.report_metadata")
    expect(metadata).toHaveLength(1)
    expect(metadata[0].params.title).toBe("Test session")
    expect(metadata[0].params.display_agent).toBe("Test session")
  })

  test("#given no OMO_NATIVE #then the agent label and resume binary are senpi", async () => {
    const env: NodeJS.ProcessEnv = { ...HERDR_ENV, OMO_NATIVE: undefined }
    const { pi, requests } = harness({ env })
    await pi.dispatch("session_start", { reason: "startup" }, makeCtx())
    await settle()
    const session = byMethod(requests, "pane.report_agent_session")[0]
    expect(session.params.agent).toBe("senpi")
    expect((session.params.resume_argv as string[])[0]).toBe("senpi")
  })

  test("#given an active turn #then working reports; settled reports idle; repeats dedupe", async () => {
    const { pi, requests } = harness()
    const ctx = makeCtx()
    await pi.dispatch("session_start", { reason: "startup" }, ctx)
    await settle()
    await pi.dispatch("agent_start", {}, ctx)
    await pi.dispatch("agent_start", {}, ctx)
    await settle()
    const reports = byMethod(requests, "pane.report_agent")
    expect(reports.map((r) => r.params.state)).toEqual(["idle", "working"])
    await pi.dispatch("agent_settled", {}, ctx)
    await settle()
    expect(byMethod(requests, "pane.report_agent").map((r) => r.params.state)).toEqual(["idle", "working", "idle"])
  })

  test("#given a blocked bus event #then the pane reads blocked with its label until it clears", async () => {
    const { pi, requests } = harness()
    const ctx = makeCtx()
    await pi.dispatch("session_start", { reason: "startup" }, ctx)
    await settle()
    pi.emitBus("herdr:blocked", { active: true, id: "q1", label: "Pick an option" })
    await settle()
    expect(byMethod(requests, "pane.report_agent").at(-1)?.params).toMatchObject({ state: "blocked", message: "Pick an option" })
    // A second overlapping blocker keeps blocked without unblocking early.
    pi.emitBus("herdr:blocked", { active: true, id: "q2", label: "Confirm" })
    pi.emitBus("herdr:blocked", { active: false, id: "q1" })
    await settle()
    expect(byMethod(requests, "pane.report_agent").at(-1)?.params).toMatchObject({ state: "blocked", message: "Confirm" })
    pi.emitBus("herdr:blocked", { active: false, id: "q2" })
    await settle()
    expect(byMethod(requests, "pane.report_agent").at(-1)?.params.state).toBe("idle")
  })

  test("#given task children and monitors #then the working message lists them", async () => {
    const { pi, requests } = harness({ countChildren: 2 })
    const ctx = makeCtx()
    await pi.dispatch("session_start", { reason: "startup" }, ctx)
    await settle()
    pi.emitBus("terminal_monitor_state", { activeCount: 1 })
    await settle()
    expect(byMethod(requests, "pane.report_agent").at(-1)?.params).toMatchObject({
      state: "working",
      message: "2 subagents running + 1 monitor live",
    })
    pi.emitBus("terminal_monitor_state", { activeCount: 0 })
    await settle()
  })

  test("#given a quit shutdown #then the pane is released after draining reports", async () => {
    const { pi, requests } = harness()
    const ctx = makeCtx()
    await pi.dispatch("session_start", { reason: "startup" }, ctx)
    await settle()
    await pi.dispatch("session_shutdown", { reason: "quit" }, ctx)
    await settle()
    const releases = byMethod(requests, "pane.release_agent")
    expect(releases).toHaveLength(1)
    expect(releases[0].params.agent).toBe("omo")
    expect(requests.at(-1)?.method).toBe("pane.release_agent")
    // Nothing after release.
    await pi.dispatch("agent_start", {}, ctx)
    await settle()
    expect(byMethod(requests, "pane.release_agent")).toHaveLength(1)
  })

  test("#given a session switch #then no release fires and the next session re-binds", async () => {
    const { pi, requests } = harness()
    await pi.dispatch("session_start", { reason: "startup" }, makeCtx({ sessionId: "sess-1" }))
    await settle()
    await pi.dispatch("session_shutdown", { reason: "resume" }, makeCtx({ sessionId: "sess-1" }))
    await pi.dispatch("session_start", { reason: "resume" }, makeCtx({ sessionId: "sess-2" }))
    await settle()
    expect(byMethod(requests, "pane.release_agent")).toHaveLength(0)
    const sessions = byMethod(requests, "pane.report_agent_session")
    expect(sessions).toHaveLength(2)
    expect(sessions[1].params.agent_session_path).toBe("/sessions/sess-2.jsonl")
    expect((sessions[1].params.resume_argv as string[])[2]).toBe("sess-2")
  })

  test("#given a non-tui session or an omo child role #then nothing binds", async () => {
    for (const options of [
      { mode: "rpc" },
      { sessionContext: { role: "child" } },
      { sessionContext: { role: "member" } },
      { sessionContext: { role: "dag_child" } },
      { sessionContext: { host_warmup: "1" } },
    ] as HarnessOptions[]) {
      const { pi, requests } = harness(options)
      const ctx = makeCtx(options)
      await pi.dispatch("session_start", { reason: "startup" }, ctx)
      await pi.dispatch("agent_start", {}, ctx)
      await pi.dispatch("session_shutdown", { reason: "quit" }, ctx)
      await settle()
      expect(requests).toHaveLength(0)
    }
  })

  test("#given a title change #then metadata is re-reported", async () => {
    const { pi, requests } = harness({ sessionName: "first" })
    const ctx = makeCtx({ sessionName: "first" })
    await pi.dispatch("session_start", { reason: "startup" }, ctx)
    await settle()
    const renamed = makeCtx({ sessionName: "renamed" })
    renamed.sessionManager = (ctx.sessionManager as Record<string, unknown>)
    ;(renamed.sessionManager as { getSessionName: () => string }).getSessionName = () => "renamed"
    await pi.dispatch("session_info_changed", {}, renamed)
    await settle()
    const metadata = byMethod(requests, "pane.report_metadata")
    expect(metadata).toHaveLength(2)
    expect(metadata[1].params.title).toBe("renamed")
  })
})
