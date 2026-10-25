import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { SenpiExtensionAPI } from "../../extension/types"
import type { FeedbackDraft } from "./draft"
import { createFeedbackComponent, FEEDBACK_PREPARE_RPC_METHOD, FEEDBACK_SUBMIT_RPC_METHOD } from "./index"
import { noticeFor } from "./runtime"
import { expectUserOnly } from "./report-file.test-support"


type Handler = (data: unknown) => unknown | Promise<unknown>

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function host(options: { withRedactor: boolean; extraEnv?: Record<string, string>; noStateDir?: boolean }) {
  const pi = new FakeExtensionAPI()
  const handlers = new Map<string, Handler>()
  const api = pi as unknown as SenpiExtensionAPI
  Object.assign(api, {
    rpc: { emit: () => undefined, handle: (name: string, handler: Handler) => handlers.set(name, handler) },
    ...(options.withRedactor
      ? {
          redactForUpload: (text: string) => {
            let n = 0
            const out = text.replace(/sk-[A-Za-z0-9]{10,}/g, () => {
              n++
              return "<redacted>"
            })
            return { text: out, counts: { credential: n } }
          },
        }
      : {}),
  })
  const stateDir = mkdtempSync(join(tmpdir(), "omo-feedback-component-"))
  dirs.push(stateDir)
  const homeDir = mkdtempSync(join(tmpdir(), "omo-feedback-home-"))
  dirs.push(homeDir)
  const sent: string[] = []
  const requests: RequestInit[] = []
  const component = createFeedbackComponent({
    env: { HOME: homeDir, OMO_CODING_AGENT_DIR: join(stateDir, "agent"), DO_NOT_TRACK: "1", ...options.extraEnv },
    ...(options.noStateDir === true ? {} : { stateDir }),
    omoVersion: "5.1.36",
    senpiVersion: "2026.10.18-1",
    channel: "beta",
    transport: async (_url, init) => {
      sent.push(String(init.body))
      requests.push(init)
      return new Response(JSON.stringify({ id: "rpt_9" }), { status: 201 })
    },
  })
  return { pi, api, handlers, component, sent, requests, stateDir, homeDir }
}

const sessionCtx = {
  cwd: "/tmp/project",
  model: { provider: "anthropic", id: "claude-opus-5-5" },
  sessionManager: {
    getSessionId: () => "ses_1",
    getBranch: () => [
      { type: "message", timestamp: "2026-10-19T02:00:00.000Z", message: { role: "user", content: [{ type: "text", text: "deploy with key sk-abcdefghijkl" }] } },
      { type: "custom", customType: "omo-memory", data: { note: "private memory note" } },
    ],
  },
}

describe("feedback component", () => {
  test("#given a host without the upload redactor #when the desktop asks for a draft #then it is told feedback is unavailable instead of sending unredacted text", async () => {
    const { api, handlers, component } = host({ withRedactor: false })
    await component.register(api, { logger: console, config: { getFlag: () => undefined } })

    const answer = await handlers.get(FEEDBACK_PREPARE_RPC_METHOD)?.({})

    expect(answer).toMatchObject({ kind: "unavailable" })
  })

  test("#given a session with a key in it and a memory entry #when the desktop prepares and submits #then one report is sent with the key removed, the desktop's logs included and no memory", async () => {
    const { pi, api, handlers, component, sent } = host({ withRedactor: true })
    await component.register(api, { logger: console, config: { getFlag: () => undefined } })
    await pi.dispatch("session_start", {}, sessionCtx)

    const draft = (await handlers.get(FEEDBACK_PREPARE_RPC_METHOD)?.({
      accessToken: "at_1",
      sections: [{ id: "logs", text: "desktop-main: renderer crashed, token sk-zzzzzzzzzzzz" }],
    })) as { draftId: string; sections: { id: string; text: string }[] }
    const result = await handlers.get(FEEDBACK_SUBMIT_RPC_METHOD)?.({ draftId: draft.draftId, kind: "bug", description: "it froze", accessToken: "at_1" })

    expect(result).toEqual({ kind: "sent", reportId: "rpt_9" })
    expect(sent).toHaveLength(1)
    const body = sent[0] ?? ""
    expect(body).not.toContain("sk-abcdefghijkl")
    expect(body).not.toContain("sk-zzzzzzzzzzzz")
    expect(body).not.toContain("private memory note")
    const ids = JSON.parse(body).sections.map((section: { id: string }) => section.id)
    expect(ids).toEqual(expect.arrayContaining(["description", "identity", "environment", "session", "logs", "config"]))
    expect(body).toContain("renderer crashed")
  })

  test("#given the feedback sidecar fails to load #when the desktop prepares and the user runs /bug #then both get a clear error naming the missing artifact instead of a crash", async () => {
    const pi = new FakeExtensionAPI()
    const handlers = new Map<string, Handler>()
    const api = pi as unknown as SenpiExtensionAPI
    Object.assign(api, {
      rpc: { emit: () => undefined, handle: (name: string, handler: Handler) => handlers.set(name, handler) },
      redactForUpload: (text: string) => ({ text, counts: {} }),
    })
    const component = createFeedbackComponent({
      env: { DO_NOT_TRACK: "1" },
      omoVersion: "5.1.36",
      senpiVersion: "2026.10.18-1",
      loadRuntime: () => Promise.reject(new Error("Cannot find module '#omo-feedback-runtime'")),
    })
    await component.register(api, { logger: console, config: { getFlag: () => undefined } })
    const notices: { message: string; type?: string }[] = []
    const ctx = { ...sessionCtx, ui: { input: async () => "x", select: async () => "Send report", notify: (message: string, type?: string) => notices.push({ message, type }) } }

    await expect(Promise.resolve(handlers.get(FEEDBACK_PREPARE_RPC_METHOD)?.({}))).rejects.toThrow("extensions/omo-feedback.js")
    await (pi.commands.find((entry) => entry.name === "bug")?.options.handler as (args: string, ctx: unknown) => Promise<void>)("it broke", ctx)

    expect(notices).toHaveLength(1)
    expect(notices[0]?.type).toBe("error")
    expect(notices[0]?.message).toContain("Cannot find module '#omo-feedback-runtime'")
  })

  test("#given a draft that was already submitted #when it is submitted again #then nothing more is sent", async () => {
    const { pi, api, handlers, component, sent } = host({ withRedactor: true })
    await component.register(api, { logger: console, config: { getFlag: () => undefined } })
    await pi.dispatch("session_start", {}, sessionCtx)
    const draft = (await handlers.get(FEEDBACK_PREPARE_RPC_METHOD)?.({})) as { draftId: string }

    await handlers.get(FEEDBACK_SUBMIT_RPC_METHOD)?.({ draftId: draft.draftId, description: "a" })
    const second = await handlers.get(FEEDBACK_SUBMIT_RPC_METHOD)?.({ draftId: draft.draftId, description: "a" })

    expect(sent).toHaveLength(1)
    expect(second).toEqual({ kind: "refused", reason: "unavailable" })
  })

  test("#given the TUI #when the user runs /feedback with a description and chooses Send #then the same core sends one report and the user sees the report id", async () => {
    const { pi, api, component, sent } = host({ withRedactor: true })
    await component.register(api, { logger: console, config: { getFlag: () => undefined } })
    const notices: string[] = []
    const ctx = {
      ...sessionCtx,
      ui: {
        input: async () => undefined,
        select: async () => "Send report",
        notify: (message: string) => notices.push(message),
      },
    }

    const command = pi.commands.find((entry) => entry.name === "feedback")
    await (command?.options.handler as (args: string, ctx: unknown) => Promise<void>)("the answer stopped", ctx)

    expect(sent).toHaveLength(1)
    expect(JSON.parse(sent[0] ?? "{}").sections[0]).toEqual({ id: "description", text: "the answer stopped" })
    expect(notices.at(-1)).toContain("rpt_9")
  })

  test("#given uploads are off and a custom agent dir #when a report is saved #then the file lands under that agent dir, never under HOME", async () => {
    const { pi, api, handlers, component, stateDir, homeDir } = host({ withRedactor: true, extraEnv: { OMO_DISABLE_FEEDBACK: "1" }, noStateDir: true })
    await component.register(api, { logger: console, config: { getFlag: () => undefined } })
    await pi.dispatch("session_start", {}, sessionCtx)
    const draft = (await handlers.get(FEEDBACK_PREPARE_RPC_METHOD)?.({})) as { draftId: string }

    const result = (await handlers.get(FEEDBACK_SUBMIT_RPC_METHOD)?.({ draftId: draft.draftId, description: "x" })) as { kind: string; path: string }

    expect(result.kind).toBe("saved")
    expect(result.path.startsWith(join(stateDir, "agent"))).toBe(true)
    expect(existsSync(join(homeDir, ".omo"))).toBe(false)
    expectUserOnly(result.path, join(stateDir, "agent"))
    expect(noticeFor((await handlers.get(FEEDBACK_PREPARE_RPC_METHOD)?.({})) as FeedbackDraft)).not.toContain("logs")
  })

  test("#given recent engine log lines #when a report is prepared #then a logs section carries them and the TUI notice names logs", async () => {
    const { pi, api, handlers, component, stateDir } = host({ withRedactor: true })
    const logs = join(stateDir, "agent", "logs")
    mkdirSync(logs, { recursive: true })
    writeFileSync(join(logs, "session.log"), `${JSON.stringify({ ts: new Date().toISOString(), level: "error", event: "turn_failed" })}\n`)
    await component.register(api, { logger: console, config: { getFlag: () => undefined } })
    await pi.dispatch("session_start", {}, sessionCtx)

    const draft = (await handlers.get(FEEDBACK_PREPARE_RPC_METHOD)?.({})) as { sections: { id: string; text: string }[] }

    expect(draft.sections.find((section) => section.id === "logs")?.text).toContain("turn_failed")
    expect(noticeFor(draft as unknown as FeedbackDraft)).toContain("recent logs")
    expect(readdirSync(logs)).toEqual(["session.log"])
  })

  test("#given a desktop client sends free text as an identity section #when the report is prepared #then that text is not trusted: it is either dropped or redacted, never sent verbatim", async () => {
    const { pi, api, handlers, component } = host({ withRedactor: true })
    await component.register(api, { logger: console, config: { getFlag: () => undefined } })
    await pi.dispatch("session_start", {}, sessionCtx)

    const draft = (await handlers.get(FEEDBACK_PREPARE_RPC_METHOD)?.({
      sections: [{ id: "identity", text: "note sk-abcdefghijklmnop" }],
    })) as { sections: { id: string; text: string }[] }

    expect(JSON.stringify(draft)).not.toContain("sk-abcdefghijklmnop")
  })

  test("#given structured identity fields from the desktop #when the report is prepared #then the engine renders them, keeps the email, redacts free-text fields and drops malformed ids", async () => {
    const { pi, api, handlers, component } = host({ withRedactor: true })
    await component.register(api, { logger: console, config: { getFlag: () => undefined } })
    await pi.dispatch("session_start", {}, sessionCtx)

    const draft = (await handlers.get(FEEDBACK_PREPARE_RPC_METHOD)?.({
      identity: { accountId: "acc_1", userId: "usr 1\ninjected", email: "dana@example.com", displayName: "Dana sk-abcdefghijklmnop", plan: "pro", deviceId: "dev_1", deviceName: "Dana's Mac" },
    })) as { sections: { id: string; text: string }[] }

    const identity = draft.sections.find((section) => section.id === "identity")?.text ?? ""
    expect(identity).toContain("acc_1")
    expect(identity).toContain("dana@example.com")
    expect(identity).toContain("Dana's Mac")
    expect(identity).not.toContain("sk-abcdefghijklmnop")
    expect(identity).not.toContain("injected")
  })

  test("#given two sessions started on one host and the first shut down #when the desktop prepares for a named session #then that session's transcript is used and a shut-down session is never read", async () => {
    const { pi, api, handlers, component } = host({ withRedactor: true })
    await component.register(api, { logger: console, config: { getFlag: () => undefined } })
    const sessionFor = (id: string, text: string, disposed: { value: boolean }) => ({
      cwd: "/tmp/project",
      sessionManager: {
        getSessionId: () => id,
        getBranch: () => {
          if (disposed.value) throw new Error(`session ${id} was disposed`)
          return [{ type: "message", timestamp: "2026-10-19T02:00:00.000Z", message: { role: "user", content: [{ type: "text", text }] } }]
        },
      },
    })
    const aDisposed = { value: false }
    const a = sessionFor("ses_a", "message from A", aDisposed)
    const b = sessionFor("ses_b", "message from B", { value: false })
    await pi.dispatch("session_start", {}, a)
    await pi.dispatch("session_start", {}, b)

    const forA = (await handlers.get(FEEDBACK_PREPARE_RPC_METHOD)?.({ sessionId: "ses_a" })) as { sections: { id: string; text: string }[] }
    expect(forA.sections.find((section) => section.id === "session")?.text).toContain("message from A")

    await pi.dispatch("session_shutdown", {}, a)
    aDisposed.value = true
    const afterShutdown = (await handlers.get(FEEDBACK_PREPARE_RPC_METHOD)?.({ sessionId: "ses_a" })) as { sections: { id: string; text: string }[] }
    expect(afterShutdown.sections.find((section) => section.id === "session")).toBeUndefined()
  })

  test("#given a send that failed because the service was unavailable #when the user tries again with the same draft #then it is sent", async () => {
    const pi = new FakeExtensionAPI()
    const handlers = new Map<string, Handler>()
    const api = pi as unknown as SenpiExtensionAPI
    Object.assign(api, {
      rpc: { emit: () => undefined, handle: (name: string, handler: Handler) => handlers.set(name, handler) },
      redactForUpload: (text: string) => ({ text, counts: {} }),
    })
    const stateDir = mkdtempSync(join(tmpdir(), "omo-feedback-retry-"))
    dirs.push(stateDir)
    let calls = 0
    const component = createFeedbackComponent({
      env: { OMO_CODING_AGENT_DIR: join(stateDir, "agent"), DO_NOT_TRACK: "1" },
      stateDir,
      transport: async () => {
        calls++
        return calls === 1 ? new Response("{}", { status: 503 }) : new Response(JSON.stringify({ id: "rpt_retry" }), { status: 201 })
      },
    })
    await component.register(api, { logger: console, config: { getFlag: () => undefined } })
    const draft = (await handlers.get(FEEDBACK_PREPARE_RPC_METHOD)?.({})) as { draftId: string }

    const first = await handlers.get(FEEDBACK_SUBMIT_RPC_METHOD)?.({ draftId: draft.draftId, description: "x" })
    const second = await handlers.get(FEEDBACK_SUBMIT_RPC_METHOD)?.({ draftId: draft.draftId, description: "x" })

    expect(first).toEqual({ kind: "refused", reason: "unavailable" })
    expect(second).toEqual({ kind: "sent", reportId: "rpt_retry" })
  })

  test("#given a client that prepares many drafts #when it keeps preparing #then the engine keeps only a bounded number and the oldest stops being submittable", async () => {
    const { api, handlers, component } = host({ withRedactor: true })
    await component.register(api, { logger: console, config: { getFlag: () => undefined } })
    const ids: string[] = []
    for (let index = 0; index < 20; index++) ids.push(((await handlers.get(FEEDBACK_PREPARE_RPC_METHOD)?.({})) as { draftId: string }).draftId)

    expect(await handlers.get(FEEDBACK_SUBMIT_RPC_METHOD)?.({ draftId: ids[0], description: "x" })).toEqual({ kind: "refused", reason: "unavailable" })
    expect(await handlers.get(FEEDBACK_SUBMIT_RPC_METHOD)?.({ draftId: ids.at(-1), description: "x" })).toEqual({ kind: "sent", reportId: "rpt_9" })
  })

  test("#given the TUI #when the user runs /bug and /feedback #then they are sent as a bug and as feedback", async () => {
    const { pi, api, component, sent } = host({ withRedactor: true })
    await component.register(api, { logger: console, config: { getFlag: () => undefined } })
    const ctx = { ...sessionCtx, ui: { input: async () => undefined, select: async () => "Send report", notify: () => undefined } }
    const handlerOf = (name: string) => pi.commands.find((entry) => entry.name === name)?.options.handler as (args: string, ctx: unknown) => Promise<void>

    await handlerOf("bug")("it broke", ctx)
    await handlerOf("feedback")("an idea", ctx)

    expect(sent.map((body) => JSON.parse(body).kind)).toEqual(["bug", "feedback"])
  })

  test("#given the desktop reports from a thread that is not an OmO session #when it asks for no session #then no conversation is attached even though a session is live", async () => {
    const { pi, api, handlers, component } = host({ withRedactor: true })
    await component.register(api, { logger: console, config: { getFlag: () => undefined } })
    await pi.dispatch("session_start", {}, sessionCtx)

    const draft = (await handlers.get(FEEDBACK_PREPARE_RPC_METHOD)?.({ sessionId: null })) as { sections: { id: string }[] }

    expect(draft.sections.map((section) => section.id)).not.toContain("session")
  })

  test("#given token-shaped values in id and email identity fields #when the report is prepared #then they go through the redactor and are dropped instead of sent", async () => {
    const pi = new FakeExtensionAPI()
    const handlers = new Map<string, Handler>()
    const api = pi as unknown as SenpiExtensionAPI
    const redacted: string[] = []
    Object.assign(api, {
      rpc: { emit: () => undefined, handle: (name: string, handler: Handler) => handlers.set(name, handler) },
      redactForUpload: (text: string) => {
        redacted.push(text)
        let n = 0
        const out = text.replace(/(sk-proj-[A-Za-z0-9]{8,}|ghp_[A-Za-z0-9]{8,})/g, () => {
          n++
          return "<redacted>"
        })
        return { text: out, counts: { credential: n } }
      },
    })
    const stateDir = mkdtempSync(join(tmpdir(), "omo-feedback-idtok-"))
    dirs.push(stateDir)
    const component = createFeedbackComponent({ env: { OMO_CODING_AGENT_DIR: join(stateDir, "agent"), DO_NOT_TRACK: "1" }, stateDir })
    await component.register(api, { logger: console, config: { getFlag: () => undefined } })

    const draft = (await handlers.get(FEEDBACK_PREPARE_RPC_METHOD)?.({
      identity: { accountId: "sk-proj-abcdefghijkl", userId: "ghp_abcdefghijklmnop", email: "ghp_abcdefghijklmnop@x.dev", deviceId: "dev_1", plan: "pro" },
    })) as { sections: { id: string; text: string }[] }

    const body = JSON.stringify(draft)
    expect(body).not.toContain("sk-proj-abcdefghijkl")
    expect(body).not.toContain("ghp_abcdefghijklmnop")
    expect(draft.sections.find((section) => section.id === "identity")?.text).toContain("dev_1")
    expect(redacted).toEqual(expect.arrayContaining(["sk-proj-abcdefghijkl", "ghp_abcdefghijklmnop", "dev_1", "pro"]))
  })

  test("#given the latest session shut down while another is still live #when the desktop omits the session #then the other live session is used", async () => {
    const { pi, api, handlers, component } = host({ withRedactor: true })
    await component.register(api, { logger: console, config: { getFlag: () => undefined } })
    const sessionFor = (id: string, text: string) => ({
      sessionManager: {
        getSessionId: () => id,
        getBranch: () => [{ type: "message", timestamp: "2026-10-19T02:00:00.000Z", message: { role: "user", content: [{ type: "text", text }] } }],
      },
    })
    const a = sessionFor("ses_a", "message from A")
    const b = sessionFor("ses_b", "message from B")
    await pi.dispatch("session_start", {}, a)
    await pi.dispatch("session_start", {}, b)
    await pi.dispatch("session_shutdown", {}, b)

    const draft = (await handlers.get(FEEDBACK_PREPARE_RPC_METHOD)?.({})) as { sections: { id: string; text: string }[] }

    expect(draft.sections.find((section) => section.id === "session")?.text).toContain("message from A")
  })

  test("#given a live session whose history cannot be read #when the report is prepared #then a draft without the conversation comes back instead of an error", async () => {
    const { pi, api, handlers, component } = host({ withRedactor: true })
    await component.register(api, { logger: console, config: { getFlag: () => undefined } })
    await pi.dispatch("session_start", {}, { sessionManager: { getSessionId: () => "ses_x", getBranch: () => { throw new Error("broken") } } })

    const draft = (await handlers.get(FEEDBACK_PREPARE_RPC_METHOD)?.({})) as { draftId?: string; sections: { id: string }[] }

    expect(typeof draft.draftId).toBe("string")
    expect(draft.sections.map((section) => section.id)).not.toContain("session")
  })

  test("#given the desktop retries with the key it kept from an unknown send #when submit runs on a freshly prepared draft #then the kept key is used, and a malformed key is ignored", async () => {
    const { api, handlers, component, requests: sent } = host({ withRedactor: true })
    await component.register(api, { logger: console, config: { getFlag: () => undefined } })

    const first = (await handlers.get(FEEDBACK_PREPARE_RPC_METHOD)?.({})) as { draftId: string }
    await handlers.get(FEEDBACK_SUBMIT_RPC_METHOD)?.({ draftId: first.draftId, description: "x", idempotencyKey: "feedback-drf_kept-1" })
    const second = (await handlers.get(FEEDBACK_PREPARE_RPC_METHOD)?.({})) as { draftId: string }
    await handlers.get(FEEDBACK_SUBMIT_RPC_METHOD)?.({ draftId: second.draftId, description: "x", idempotencyKey: "not a key\nx" })

    expect(new Headers(sent[0]?.headers).get("idempotency-key")).toBe("feedback-drf_kept-1")
    expect(new Headers(sent[1]?.headers).get("idempotency-key")).toBe(`feedback-${second.draftId}`)
  })
})

