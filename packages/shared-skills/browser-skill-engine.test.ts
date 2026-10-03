/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import {
  BROWSER_CONFIRMATION_POLICY,
  BrowserActionDeclinedError,
  BrowserEngineRefusal,
  BrowserNotConnectedError,
  BrowserUserStoppedError,
  guardOmowright,
} from "./skills/browser/scripts/omowright.mjs"

type Json = Record<string, unknown>

class DaemonError extends Error {
  readonly code: string
  constructor(code: string, message = code) {
    super(message)
    this.name = "BskRpcError"
    this.code = code
  }
}

interface SessionScript {
  readonly descriptors?: Json[]
  readonly html?: string
  readonly failOn?: { readonly method: string; readonly error: Error }
}

function fakeSession(script: SessionScript = {}) {
  const calls: Array<[string, ...unknown[]]> = []
  const descriptors = [...(script.descriptors ?? [])]
  const record = async (method: string, ...args: unknown[]) => {
    calls.push([method, ...args])
    if (script.failOn?.method === method) throw script.failOn.error
    return { ok: true }
  }
  const session = {
    sessionId: "ckhg",
    stopped: false,
    calls,
    navigate: (...args: unknown[]) => record("navigate", ...args),
    back: (...args: unknown[]) => record("back", ...args),
    click: (...args: unknown[]) => record("click", ...args),
    press: (...args: unknown[]) => record("press", ...args),
    fill: (...args: unknown[]) => record("fill", ...args),
    observe: async () => ({ tree: "tree" }),
    getHtml: async (options: unknown) => {
      calls.push(["getHtml", options])
      return { html: script.html ?? "" }
    },
    evaluate: async (expression: string) => {
      calls.push(["evaluate", expression])
      return { ok: true, value: descriptors.shift() ?? null }
    },
    tool: async (name: string, params: unknown) => {
      calls.push(["tool", name, params])
      return { ok: true }
    },
    tabList: async () => ({
      tabs: [
        { id: 3, url: "https://other.example/", title: "Other", active: false },
        { id: 7, url: "https://shop.example/cart", title: "Cart", favicon_url: "https://shop.example/f.ico", active: true },
      ],
    }),
    stop: async () => {
      calls.push(["stop"])
      session.stopped = true
      return null
    },
  }
  return session
}

function fakeRaw(connect: () => Promise<unknown>) {
  const connectCalls: unknown[] = []
  const raw = {
    connectCalls,
    launched: [] as string[],
    connectBrowserSkill: async (options?: unknown) => {
      connectCalls.push(options)
      return connect()
    },
    snapshotSessions: [] as unknown[],
    bskSnapshot: async (session: unknown) => {
      raw.snapshotSessions.push(session)
      return { tree: "tree", refs: {}, css: {} }
    },
    connectPipe: async () => {
      raw.launched.push("connectPipe")
      return {}
    },
    connectCloakProfile: async () => {
      raw.launched.push("connectCloakProfile")
      return {}
    },
    connect: async () => {
      raw.launched.push("connect")
      return {}
    },
    createCua: () => {
      raw.launched.push("createCua")
      return {}
    },
    emulate: async () => {
      raw.launched.push("emulate")
    },
    futureLauncher: async () => {
      raw.launched.push("futureLauncher")
    },
    compactSnapshot: (tree: string) => tree.trim(),
    bskDoctor: async () => ({ ready: true }),
    BskRpcError: DaemonError,
    DEVICE_PRESETS: { phone: { width: 390 } },
  }
  return raw
}

type AskVariant = "ask_user_question" | "request_user_input" | "none"

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function assertQuestionShape(tool: AskVariant, args: Json): void {
  const questions = args.questions as Array<Json>
  const question = questions[0] as Json
  const options = question.options as Array<Json>
  const waits = tool === "request_user_input" ? args.wait_for_answer : args.waitForAnswer
  if (waits !== true) throw new Error("the question must pause the cell until answered")
  if (questions.length !== 1) throw new Error("exactly one question")
  if (String(question.header).length > 12 || String(question.header).length === 0) throw new Error("header must be 1-12 characters")
  if (options.length < 2 || options.length > (tool === "request_user_input" ? 3 : 4)) throw new Error("option count outside the tool's range")
  if (tool === "request_user_input" && !/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/.test(String(question.id))) throw new Error("id must be snake_case")
  if (tool === "request_user_input" && options.some((option) => typeof option.description !== "string")) throw new Error("codex options need a description")
}

function fakeHost(options: { ask?: AskVariant; answers?: string[]; status?: string } = {}) {
  const log: Array<{ tool: string; args: Json }> = []
  const events: Json[] = []
  let stopped = false
  let held: ReturnType<typeof deferred> | undefined
  const answers = [...(options.answers ?? [])]
  const askVariant = options.ask ?? "ask_user_question"
  return {
    log,
    events,
    setStopped: (value: boolean) => {
      stopped = value
    },
    holdAnswers: () => {
      held = deferred()
      return held
    },
    async listTools(): Promise<string[]> {
      return ["omo_browser_bridge", ...(askVariant === "none" ? [] : [askVariant])]
    },
    async callTool(tool: string, args: Json): Promise<Json> {
      log.push({ tool, args })
      if (tool === "omo_browser_bridge") {
        if (args.op === "state") events.push(args.data as Json)
        if (args.op === "stopped") stopped = true
        return { details: { ok: true, stopped } }
      }
      assertQuestionShape(tool as AskVariant, args)
      if (held) await held.promise
      const question = (args.questions as Array<Json>)[0] as Json
      const answer = answers.shift() ?? "Don't allow"
      const status = options.status ?? "answered"
      if (tool === "request_user_input") {
        return { details: { status, answers: { [String(question.id)]: { answers: [answer] } }, unanswered: [] } }
      }
      return { details: { status, answers: { [String(question.question)]: answer }, unanswered: [] } }
    },
  }
}

const statusActions = (events: Json[]) => events.map((event) => [event.status, event.action ?? null])
const asked = (host: ReturnType<typeof fakeHost>) => host.log.filter((entry) => entry.tool !== "omo_browser_bridge")

async function connected(host: ReturnType<typeof fakeHost> | undefined, script: SessionScript = {}, env: Json = { OMO_BROWSER_ENGINE: "connected" }) {
  const session = fakeSession(script)
  const raw = fakeRaw(async () => session)
  const guarded = guardOmowright(raw, { env, host })
  const guardedSession = await guarded.connectBrowserSkill({ name: "task", focused: false })
  return { session, raw, guarded, guardedSession }
}

describe("browser engine selection", () => {
  test("#given no OMO_BROWSER_ENGINE #when the skill connects #then today's behaviour: the raw session, no events, no questions", async () => {
    const host = fakeHost()
    const session = fakeSession()
    const raw = fakeRaw(async () => session)

    const guarded = guardOmowright(raw, { env: {}, host })
    const got = await guarded.connectBrowserSkill({ name: "task" })
    await got.click("#send")

    expect(guarded).toBe(raw)
    expect(got).toBe(session)
    expect(host.log).toEqual([])
    expect(session.calls.map((call) => call[0])).toEqual(["click"])
  })

  test("#given the user's browser is not connected #when the skill connects #then a Connect-your-browser error and never another browser", async () => {
    const host = fakeHost()
    const raw = fakeRaw(async () => {
      throw new DaemonError("no_browser_connected", "no extension attached")
    })

    const guarded = guardOmowright(raw, { env: { OMO_BROWSER_ENGINE: "connected" }, host })
    const error = await guarded.connectBrowserSkill({ name: "task" }).then(() => undefined, (cause: unknown) => cause)

    expect(error).toBeInstanceOf(BrowserNotConnectedError)
    expect(raw.connectCalls).toHaveLength(1)
    expect(raw.launched).toEqual([])
    expect(statusActions(host.events)).toEqual([["connect_failed", null]])
    expect(host.events[0]?.reason).toBe("no_browser_connected")
  })

  test.each(["no_daemon", "unsupported"])("#given the daemon is unavailable (%s) #when the skill connects #then the same connect error, no fallback", async (code) => {
    const raw = fakeRaw(async () => {
      throw new DaemonError(code)
    })
    const guarded = guardOmowright(raw, { env: { OMO_BROWSER_ENGINE: "connected" }, host: fakeHost() })

    const error = await guarded.connectBrowserSkill({}).then(() => undefined, (cause: unknown) => cause)

    expect(error).toBeInstanceOf(BrowserNotConnectedError)
    expect(raw.launched).toEqual([])
  })

  test("#given a connect failure that is not about the browser #when the skill connects #then the daemon's own error is kept", async () => {
    const original = new DaemonError("permission_denied")
    const raw = fakeRaw(async () => {
      throw original
    })
    const guarded = guardOmowright(raw, { env: { OMO_BROWSER_ENGINE: "connected" }, host: fakeHost() })

    const error = await guarded.connectBrowserSkill({}).then(() => undefined, (cause: unknown) => cause)

    expect(error).toBe(original)
  })

  test("#given the app's built-in browser #when the skill connects #then BrowserSkill is never called and the model is told to use the app's tools", async () => {
    const raw = fakeRaw(async () => fakeSession())
    const guarded = guardOmowright(raw, { env: { OMO_BROWSER_ENGINE: "builtin" }, host: fakeHost() })

    const error = await guarded.connectBrowserSkill({}).then(() => undefined, (cause: unknown) => cause)

    expect(error).toBeInstanceOf(BrowserEngineRefusal)
    expect((error as BrowserEngineRefusal).code).toBe("browser_engine_builtin")
    expect(raw.connectCalls).toEqual([])
  })

  test("#given browser access is off #when the skill connects #then a refusal that says so and nothing is called", async () => {
    const raw = fakeRaw(async () => fakeSession())
    const guarded = guardOmowright(raw, { env: { OMO_BROWSER_ENGINE: "none" }, host: fakeHost() })

    const error = await guarded.connectBrowserSkill({}).then(() => undefined, (cause: unknown) => cause)

    expect(error).toBeInstanceOf(BrowserEngineRefusal)
    expect((error as BrowserEngineRefusal).code).toBe("browser_engine_none")
    expect(raw.connectCalls).toEqual([])
  })

  test("#given an engine value nobody defined #when the skill connects #then it is refused, never read as unset", async () => {
    const raw = fakeRaw(async () => fakeSession())
    const guarded = guardOmowright(raw, { env: { OMO_BROWSER_ENGINE: "chrome" }, host: fakeHost() })

    const error = await guarded.connectBrowserSkill({}).then(() => undefined, (cause: unknown) => cause)

    expect(error).toBeInstanceOf(BrowserEngineRefusal)
    expect((error as BrowserEngineRefusal).code).toBe("browser_engine_unsupported")
    expect(raw.connectCalls).toEqual([])
  })

})

describe("the owned browser and every other way to reach a browser", () => {
  const creators = ["connectPipe", "connectCloakProfile", "connect"] as const
  const engines = ["none", "connected", "builtin", "chrome"] as const

  for (const engine of engines) {
    for (const creator of creators) {
      test(`#given ${engine} #when ${creator} is called #then no owned browser starts and the refusal names the engine`, async () => {
        const raw = fakeRaw(async () => fakeSession())
        const guarded = guardOmowright(raw, { env: { OMO_BROWSER_ENGINE: engine }, host: fakeHost() })

        const error = await (guarded as unknown as Record<string, () => Promise<unknown>>)[creator]?.().then(() => undefined, (cause: unknown) => cause)

        expect(error).toBeInstanceOf(BrowserEngineRefusal)
        expect((error as BrowserEngineRefusal).code).toBe("browser_engine_owned_blocked")
        expect((error as BrowserEngineRefusal & { engine?: string }).engine).toBe(engine)
        expect(raw.launched).toEqual([])
      })
    }
  }

  test("#given an engine is chosen #when an export the guard does not know is called #then it is refused instead of passed through", async () => {
    const raw = fakeRaw(async () => fakeSession())
    const guarded = guardOmowright(raw, { env: { OMO_BROWSER_ENGINE: "connected" }, host: fakeHost() }) as unknown as Record<string, () => Promise<unknown>>

    const future = await guarded.futureLauncher?.().then(() => undefined, (cause: unknown) => cause)
    const page = await guarded.emulate?.().then(() => undefined, (cause: unknown) => cause)
    const driver = await guarded.createCua?.().then(() => undefined, (cause: unknown) => cause)

    expect(future).toBeInstanceOf(BrowserEngineRefusal)
    expect((future as BrowserEngineRefusal).code).toBe("browser_engine_export_blocked")
    expect(page).toBeInstanceOf(BrowserEngineRefusal)
    expect(driver).toBeInstanceOf(BrowserEngineRefusal)
    expect(raw.launched).toEqual([])
  })

  test("#given an engine is chosen #when setup, error classes, pure helpers and data are used #then they still work", async () => {
    const raw = fakeRaw(async () => fakeSession())
    const guarded = guardOmowright(raw, { env: { OMO_BROWSER_ENGINE: "none" }, host: fakeHost() })

    expect(await guarded.bskDoctor()).toEqual({ ready: true })
    expect(guarded.BskRpcError).toBe(DaemonError)
    expect(guarded.compactSnapshot("  tree  ")).toBe("tree")
    expect(guarded.DEVICE_PRESETS).toEqual({ phone: { width: 390 } })
  })

  test("#given no engine is chosen #when the owned browser is launched #then terminal use is exactly as before", async () => {
    const raw = fakeRaw(async () => fakeSession())

    const guarded = guardOmowright(raw, { env: {}, host: fakeHost() })
    await guarded.connectPipe()
    await guarded.connectCloakProfile()

    expect(guarded).toBe(raw)
    expect(raw.launched).toEqual(["connectPipe", "connectCloakProfile"])
  })
})

describe("browser state events", () => {
  test("#given a navigate and a click #when the session is used and stopped #then the app sees each step in order with the tab", async () => {
    const host = fakeHost()
    const { guardedSession } = await connected(host)

    await guardedSession.navigate("https://shop.example/cart", { waitUntil: "load" })
    await guardedSession.click("#next")
    await guardedSession.stop()

    expect(statusActions(host.events)).toEqual([
      ["started", null],
      ["acting", "navigate"],
      ["navigated", "navigate"],
      ["idle", "navigate"],
      ["acting", "click"],
      ["idle", "click"],
      ["stopped", null],
    ])
    expect(host.events.every((event) => event.engine === "connected")).toBe(true)
    expect(host.events[2]?.tab).toEqual({ id: 7, url: "https://shop.example/cart", title: "Cart", favicon: "https://shop.example/f.ico" })
  })

  test("#given an action the daemon rejects #when it fails #then the app is told why and the error reaches the model unchanged", async () => {
    const host = fakeHost()
    const original = new DaemonError("not_found", "stale ref")
    const { guardedSession } = await connected(host, { failOn: { method: "fill", error: original } })

    const error = await guardedSession.fill("#name", "x").then(() => undefined, (cause: unknown) => cause)

    expect(error).toBe(original)
    expect(statusActions(host.events)).toEqual([["started", null], ["acting", "fill"], ["failed", "fill"]])
    expect(host.events[2]?.reason).toBe("not_found")
  })

  test("#given the app cannot take events #when the skill acts #then the action still happens", async () => {
    const { session, guardedSession } = await connected(undefined)

    await guardedSession.navigate("https://example.com/")
    await guardedSession.click("#next")

    expect(session.calls.map((call) => call[0])).toContain("navigate")
    expect(session.calls.map((call) => call[0])).toContain("click")
  })

  test("#given the event bridge throws #when the skill acts #then the action still happens", async () => {
    const host = fakeHost()
    const failing = { ...host, callTool: async () => { throw new Error("bridge down") }, listTools: async () => ["omo_browser_bridge"] }
    const { session, guardedSession } = await connected(failing as unknown as ReturnType<typeof fakeHost>)

    await guardedSession.click("#next")

    expect(session.calls.map((call) => call[0])).toContain("click")
  })
})

describe("confirmation before irreversible actions", () => {
  test("#given the policy constant #when read #then it names the one policy", () => {
    expect(BROWSER_CONFIRMATION_POLICY).toBe("ask-before-irreversible")
  })

  test("#given a pay button #when the model clicks it #then a question is asked and the click waits for the answer", async () => {
    const host = fakeHost({ answers: ["Allow"] })
    const hold = host.holdAnswers()
    const { session, guardedSession } = await connected(host, { descriptors: [{ tag: "button", text: "Pay now" }] })

    const clicking = guardedSession.click("#pay")
    await Promise.resolve()
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(asked(host)).toHaveLength(1)
    expect(session.calls.map((call) => call[0])).not.toContain("click")
    expect(statusActions(host.events).at(-1)).toEqual(["awaiting_confirmation", "click"])

    hold.resolve()
    await clicking

    expect(session.calls.map((call) => call[0])).toContain("click")
  })

  test("#given the user says no #when the model clicks a payment control #then the click never happens and the refusal is typed", async () => {
    const host = fakeHost({ answers: ["Don't allow"] })
    const { session, guardedSession } = await connected(host, { descriptors: [{ tag: "button", text: "Place order" }] })

    const error = await guardedSession.click("#order").then(() => undefined, (cause: unknown) => cause)

    expect(error).toBeInstanceOf(BrowserActionDeclinedError)
    expect((error as BrowserActionDeclinedError).code).toBe("user_declined")
    expect(session.calls.map((call) => call[0])).not.toContain("click")
  })

  test.each(["cancelled", "timed_out", "unavailable"])("#given the question ends as %s #when the model clicks a delete control #then nothing is clicked", async (status) => {
    const host = fakeHost({ answers: ["Allow"], status })
    const { session, guardedSession } = await connected(host, { descriptors: [{ tag: "button", text: "Delete account" }] })

    const error = await guardedSession.click("#delete").then(() => undefined, (cause: unknown) => cause)

    expect(error).toBeInstanceOf(BrowserActionDeclinedError)
    expect(session.calls.map((call) => call[0])).not.toContain("click")
  })

  test("#given an answer that is not exactly Allow #when asked #then it counts as no", async () => {
    const host = fakeHost({ answers: ["Allow, but only after I look"] })
    const { session, guardedSession } = await connected(host, { descriptors: [{ tag: "button", text: "Send message" }] })

    const error = await guardedSession.click("#send").then(() => undefined, (cause: unknown) => cause)

    expect(error).toBeInstanceOf(BrowserActionDeclinedError)
    expect(session.calls.map((call) => call[0])).not.toContain("click")
  })

  test("#given the engine has no question tool #when the model clicks a send control #then it fails closed", async () => {
    const host = fakeHost({ ask: "none" })
    const { session, guardedSession } = await connected(host, { descriptors: [{ tag: "button", text: "Send message" }] })

    const error = await guardedSession.click("#send").then(() => undefined, (cause: unknown) => cause)

    expect(error).toBeInstanceOf(BrowserActionDeclinedError)
    expect((error as BrowserActionDeclinedError).code).toBe("confirmation_unavailable")
    expect(session.calls.map((call) => call[0])).not.toContain("click")
  })

  test("#given no kernel host at all #when the model clicks a pay control #then it fails closed", async () => {
    const { session, guardedSession } = await connected(undefined, { descriptors: [{ tag: "button", text: "Pay now" }] })

    const error = await guardedSession.click("#pay").then(() => undefined, (cause: unknown) => cause)

    expect(error).toBeInstanceOf(BrowserActionDeclinedError)
    expect((error as BrowserActionDeclinedError).code).toBe("confirmation_unavailable")
    expect(session.calls.map((call) => call[0])).not.toContain("click")
  })

  test.each(["ask_user_question", "request_user_input"] as const)("#given the %s question tool #when the user allows #then the click goes through", async (ask) => {
    const host = fakeHost({ ask, answers: ["Allow"] })
    const { session, guardedSession } = await connected(host, { descriptors: [{ tag: "button", text: "Publish post" }] })

    await guardedSession.click("#publish")

    expect(asked(host)[0]?.tool).toBe(ask)
    expect(session.calls.map((call) => call[0])).toContain("click")
  })

  test.each([
    "Send message",
    "Publish post",
    "Post comment",
    "Pay now",
    "Place order",
    "Subscribe",
    "Delete account",
    "Remove item",
    "Cancel subscription",
    "Close account",
    "결제하기",
    "삭제",
  ])("#given a %s control #when clicked #then the user is asked first", async (label) => {
    const host = fakeHost({ answers: ["Allow"] })
    const { guardedSession } = await connected(host, { descriptors: [{ tag: "button", text: label }] })

    await guardedSession.click("#control")

    expect(asked(host)).toHaveLength(1)
  })

  test.each(["Next page", "Search", "Sign in", "Add to cart", "Show details", "Open menu"])("#given a %s control #when clicked #then nothing is asked", async (label) => {
    const host = fakeHost()
    const { session, guardedSession } = await connected(host, { descriptors: [{ tag: "button", text: label }] })

    await guardedSession.click("#control")

    expect(asked(host)).toHaveLength(0)
    expect(session.calls.map((call) => call[0])).toContain("click")
  })

  test("#given a daemon ref #when the model clicks it #then the control is read from its markup before the click", async () => {
    const host = fakeHost({ answers: ["Allow"] })
    const { session, guardedSession } = await connected(host, { html: '<button type="submit">Place order</button>' })

    await guardedSession.click("@e7")

    expect(session.calls[0]).toEqual(["getHtml", { ref: "@e7", maxBytes: 4096 }])
    expect(asked(host)).toHaveLength(1)
  })

  test("#given Enter in a form that sends #when pressed #then the user is asked, and other keys are not", async () => {
    const host = fakeHost({ answers: ["Allow"] })
    const { session, guardedSession } = await connected(host, {
      descriptors: [{ tag: "input", text: "", form: { action: "https://mail.example/send", method: "post", submitLabels: ["Send message"] } }],
    })

    await guardedSession.press("Tab")
    expect(asked(host)).toHaveLength(0)
    expect(session.calls.map((call) => call[0])).toEqual(["press"])

    await guardedSession.press("Enter")
    expect(asked(host)).toHaveLength(1)
    expect(session.calls.map((call) => call[0])).toEqual(["press", "evaluate", "press"])
  })

  test("#given typing into a field #when the model fills it #then nothing is asked", async () => {
    const host = fakeHost()
    const { session, guardedSession } = await connected(host)

    await guardedSession.fill("#note", "hello")

    expect(asked(host)).toHaveLength(0)
    expect(session.calls.map((call) => call[0])).toEqual(["fill"])
  })
})

describe("the user stops browser use", () => {
  test("#given the user pressed Stop #when an action is rejected as user_aborted #then the model is told, and no new session starts this turn", async () => {
    const host = fakeHost()
    const session = fakeSession({ failOn: { method: "click", error: new DaemonError("user_aborted") } })
    const raw = fakeRaw(async () => session)
    const guarded = guardOmowright(raw, { env: { OMO_BROWSER_ENGINE: "connected" }, host })
    const guardedSession = await guarded.connectBrowserSkill({ name: "task" })

    const error = await guardedSession.click("#next").then(() => undefined, (cause: unknown) => cause)

    expect(error).toBeInstanceOf(BrowserUserStoppedError)
    expect((error as BrowserUserStoppedError).code).toBe("user_stopped")
    expect(host.log.some((entry) => entry.tool === "omo_browser_bridge" && entry.args.op === "stopped")).toBe(true)
    expect(host.events.some((event) => event.status === "user_stopped")).toBe(true)

    const again = await guarded.connectBrowserSkill({ name: "retry" }).then(() => undefined, (cause: unknown) => cause)
    expect(again).toBeInstanceOf(BrowserUserStoppedError)
    expect(raw.connectCalls).toHaveLength(1)
  })

  test("#given the user stopped browser use #when they send a new message #then a session may start again", async () => {
    const host = fakeHost()
    host.setStopped(true)
    const session = fakeSession()
    const raw = fakeRaw(async () => session)
    const guarded = guardOmowright(raw, { env: { OMO_BROWSER_ENGINE: "connected" }, host })

    const blocked = await guarded.connectBrowserSkill({}).then(() => undefined, (cause: unknown) => cause)
    expect(blocked).toBeInstanceOf(BrowserUserStoppedError)

    host.setStopped(false)
    const allowed = await guarded.connectBrowserSkill({})

    expect(allowed.sessionId).toBe("ckhg")
    expect(raw.connectCalls).toHaveLength(1)
  })
})

describe("what the policy cannot be bypassed through", () => {
  test("#given the user stopped browser use from the app #when the model acts on the live session #then the action is not performed", async () => {
    const host = fakeHost()
    const { session, guardedSession } = await connected(host)
    host.setStopped(true)

    const error = await guardedSession.click("#next").then(() => undefined, (cause: unknown) => cause)

    expect(error).toBeInstanceOf(BrowserUserStoppedError)
    expect(session.calls.map((call) => call[0])).not.toContain("click")
    expect(session.calls.map((call) => call[0])).toContain("stop")
  })

  test("#given a script that clicks #when the model evaluates it #then the user is asked first, and a no stops it", async () => {
    const host = fakeHost({ answers: ["Don't allow"] })
    const { session, guardedSession } = await connected(host)

    const error = await guardedSession.evaluate("document.querySelector('button.buy').click()").then(() => undefined, (cause: unknown) => cause)

    expect(error).toBeInstanceOf(BrowserActionDeclinedError)
    expect(asked(host)).toHaveLength(1)
    expect(session.calls.map((call) => call[0])).not.toContain("evaluate")
  })

  test.each(["document.title", "[...document.querySelectorAll('a')].map((a) => a.href)", "fetch('/api/items')"])("#given a read-only script (%s) #when evaluated #then nothing is asked", async (expression) => {
    const host = fakeHost()
    const { session, guardedSession } = await connected(host)

    await guardedSession.evaluate(expression)

    expect(asked(host)).toHaveLength(0)
    expect(session.calls.map((call) => call[0])).toContain("evaluate")
  })

  test("#given a script that posts with the user's cookies #when evaluated #then the user is asked", async () => {
    const host = fakeHost({ answers: ["Allow"] })
    const { guardedSession } = await connected(host)

    await guardedSession.evaluate("fetch('/api/messages', { method: 'POST', body: '{}' })")

    expect(asked(host)).toHaveLength(1)
  })

  test("#given the daemon's raw tool entry #when it names click, press or evaluate #then it is refused, and read tools pass", async () => {
    const host = fakeHost()
    const { session, guardedSession } = await connected(host)

    const refused = await guardedSession.tool("click", { selector: "#pay" }).then(() => undefined, (cause: unknown) => cause)
    await guardedSession.tool("screenshot", {})

    expect(refused).toBeInstanceOf(BrowserEngineRefusal)
    expect(session.calls.filter((call) => call[0] === "tool").map((call) => call[1])).toEqual(["screenshot"])
  })

  test("#given the page snapshot helper #when it runs on a guarded session #then it reads through the raw session and asks nothing", async () => {
    const host = fakeHost()
    const { session, raw, guarded, guardedSession } = await connected(host)

    await guarded.bskSnapshot(guardedSession, { interactive: true })

    expect(raw.snapshotSessions).toEqual([session])
    expect(asked(host)).toHaveLength(0)
  })

  test("#given a click at screenshot coordinates #when the target cannot be read #then the user is asked", async () => {
    const host = fakeHost({ answers: ["Allow"] })
    const { session, guardedSession } = await connected(host)

    await guardedSession.click({ captureId: "c1", x: 10, y: 20 })

    expect(asked(host)).toHaveLength(1)
    expect(session.calls.map((call) => call[0])).toContain("click")
  })

  test("#given the page cannot be inspected #when the model clicks #then it asks instead of guessing", async () => {
    const host = fakeHost({ answers: ["Allow"] })
    const session = fakeSession()
    session.evaluate = async () => {
      throw new DaemonError("cdp_failed")
    }
    const raw = fakeRaw(async () => session)
    const guarded = guardOmowright(raw, { env: { OMO_BROWSER_ENGINE: "connected" }, host })
    const guardedSession = await guarded.connectBrowserSkill({})

    await guardedSession.click("#mystery")

    expect(asked(host)).toHaveLength(1)
  })

  test.each(["Control+Enter", "Meta+Enter"])("#given %s #when pressed #then the user is asked, since that chord sends in chat apps", async (chord) => {
    const host = fakeHost({ answers: ["Allow"] })
    const { guardedSession } = await connected(host, { descriptors: [{ tag: "textarea", text: "" }] })

    await guardedSession.press(chord)

    expect(asked(host)).toHaveLength(1)
  })

  test("#given Shift+Enter in a message box #when pressed #then nothing is asked, since it only adds a line", async () => {
    const host = fakeHost()
    const { session, guardedSession } = await connected(host, { descriptors: [{ tag: "textarea", text: "", editable: true }] })

    await guardedSession.press("Shift+Enter")

    expect(asked(host)).toHaveLength(0)
    expect(session.calls.map((call) => call[0])).toContain("press")
  })

  test.each([
    ["a textarea composer", { tag: "textarea", text: "", editable: true }],
    ["a contenteditable composer", { tag: "div", text: "", editable: true }],
    ["a role=textbox composer", { tag: "div", text: "", editable: true }],
    ["a composer inside a POST form", { tag: "textarea", text: "", editable: true, form: { action: "/comments", method: "post", submitLabels: ["Go"] } }],
  ])("#given Enter in %s #when pressed #then the user is asked, since that sends in many apps", async (_name, descriptor) => {
    const host = fakeHost({ answers: ["Allow"] })
    const { session, guardedSession } = await connected(host, { descriptors: [descriptor] })

    await guardedSession.press("Enter")

    expect(asked(host)).toHaveLength(1)
    expect(session.calls.map((call) => call[0])).toContain("press")
  })

  test("#given a No on Enter in a message box #when pressed #then the message is not sent", async () => {
    const host = fakeHost({ answers: ["Don't allow"] })
    const { session, guardedSession } = await connected(host, { descriptors: [{ tag: "div", text: "", editable: true }] })

    const error = await guardedSession.press("Enter").then(() => undefined, (cause: unknown) => cause)

    expect(error).toBeInstanceOf(BrowserActionDeclinedError)
    expect(session.calls.map((call) => call[0])).not.toContain("press")
  })

  test("#given Enter in a search box inside a GET form #when pressed #then nothing is asked", async () => {
    const host = fakeHost()
    const { session, guardedSession } = await connected(host, {
      descriptors: [{ tag: "input", text: "", editable: true, form: { action: "/search", method: "get", submitLabels: ["Search"] } }],
    })

    await guardedSession.press("Enter")

    expect(asked(host)).toHaveLength(0)
    expect(session.calls.map((call) => call[0])).toContain("press")
  })

  test("#given Enter on a daemon ref to a contenteditable composer #when pressed #then the user is asked, and a plain button is not", async () => {
    const editable = fakeHost({ answers: ["Allow"] })
    const composer = await connected(editable, { html: '<div contenteditable="true" role="textbox"></div>' })
    await composer.guardedSession.press("Enter", { target: "@e4" })
    expect(asked(editable)).toHaveLength(1)

    const plain = fakeHost()
    const button = await connected(plain, { html: "<button>Next</button>" })
    await button.guardedSession.press("Enter", { target: "@e5" })
    expect(asked(plain)).toHaveLength(0)
  })
})

describe("what else a cooperating session could do by accident", () => {
  test.each(["observe", "snapshot", "get_html", "screenshot", "tab_list", "console", "network"])("#given the daemon's raw %s tool #when called #then it is a read and passes", async (name) => {
    const host = fakeHost()
    const { session, guardedSession } = await connected(host)

    await guardedSession.tool(name, {})

    expect(session.calls.filter((call) => call[0] === "tool").map((call) => call[1])).toEqual([name])
  })

  test.each(["click", "press", "evaluate", "fill", "select", "wheel", "tab_close", "navigate", "some_future_acting_tool"])("#given the daemon's raw %s tool #when called #then it is refused, since only reads are allowed through it", async (name) => {
    const host = fakeHost()
    const { session, guardedSession } = await connected(host)

    const error = await guardedSession.tool(name, {}).then(() => undefined, (cause: unknown) => cause)

    expect(error).toBeInstanceOf(BrowserEngineRefusal)
    expect((error as BrowserEngineRefusal).code).toBe("browser_tool_blocked")
    expect(session.calls.filter((call) => call[0] === "tool")).toEqual([])
  })

  test("#given a script that beacons data out #when evaluated #then the user is asked, since sendBeacon always posts", async () => {
    const host = fakeHost({ answers: ["Allow"] })
    const { guardedSession } = await connected(host)

    await guardedSession.evaluate("navigator.sendBeacon('/track', data)")

    expect(asked(host)).toHaveLength(1)
  })

  test.each(["Submit", "Submit order", "Confirm purchase", "Checkout", "Transfer funds", "Approve request", "Merge pull request", "Sign contract", "승인", "송금"])("#given a %s control #when clicked #then the user is asked first", async (label) => {
    const host = fakeHost({ answers: ["Allow"] })
    const { guardedSession } = await connected(host, { descriptors: [{ tag: "button", text: label }] })

    await guardedSession.click("#control")

    expect(asked(host)).toHaveLength(1)
  })

  test.each(["Sign in", "Sign up", "Log in", "Continue", "Learn more"])("#given a %s control #when clicked #then nothing is asked", async (label) => {
    const host = fakeHost()
    const { guardedSession } = await connected(host, { descriptors: [{ tag: "button", text: label }] })

    await guardedSession.click("#control")

    expect(asked(host)).toHaveLength(0)
  })
})
