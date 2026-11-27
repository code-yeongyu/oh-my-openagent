import { afterEach, describe, expect, test } from "bun:test"
import type { ThreadToolResult } from "../contracts"
import { createRemoteThreadFixture, ENGINE } from "../thread-remote-fixture"

// omo#13409 / omo#13410: thread_create takes the new thread's model, reasoning level, approval mode and first prompt in
// the one create call, on this device and on another device alike. The model rides on the open_session frame (the
// engine's launch profile), so a model the device cannot run refuses the create and leaves no session behind.

const { account, surface, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)

type Sent = ReturnType<typeof account>["sent"]
const types = (sent: Sent) => sent.map((entry) => entry.rpc?.["type"])
const openFrames = (sent: Sent) => sent.filter((entry) => entry.rpc?.["type"] === "open_session").map((e) => e.rpc)
const localOpens = (openSession: ReturnType<typeof surface>["openSession"]) =>
  openSession.mock.calls.map((call) => (call as unknown as [Record<string, unknown>])[0])

describe("thread_create with a model and a reasoning level (#13409)", () => {
  test("#given a model and a level #when created here and on b #then both open_session frames carry them and no set_model follows", async () => {
    const a = account()
    const { run, openSession } = surface(a.remote)
    const options = { model: "anthropic/claude-opus-5-5", reasoning: "high" }
    expect(await run("thread_create", { name: "with-model-here", ...options })).toMatchObject({
      kind: "ok",
      thread: "dur-created-here",
    })
    expect(
      await run("thread_create", { name: "thread-create-options-24", device: "studio", ...options }),
    ).toMatchObject({
      kind: "ok",
      thread: "dur-new-on-b",
      device: "b",
    })
    const launch = { provider: "anthropic", modelId: "claude-opus-5-5", thinkingLevel: "high" }
    expect(localOpens(openSession)).toEqual([expect.objectContaining(launch)])
    expect(openFrames(a.sent)).toEqual([expect.objectContaining(launch)])
    // The name a create needs (#14050) is set after the open on b; no set_model follows.
    expect(types(a.sent)).toEqual(["open_session", "set_session_name"])
  })

  test("#given a model the engine cannot resolve #when created here and on b #then each answers model_not_found and opens nothing", async () => {
    const refusal = "model_unavailable: no model anthropic/nope"
    const a = account({ openRefuse: refusal })
    const { run } = surface(a.remote, { openThrows: refusal })
    const here = await run("thread_create", { name: "thread-create-options-38", model: "anthropic/nope" })
    const there = await run("thread_create", {
      name: "thread-create-options-39",
      device: "studio",
      model: "anthropic/nope",
    })
    for (const result of [here, there])
      expect(result).toMatchObject({
        kind: "error",
        error: { code: "model_not_found", details: { reason: "model_unavailable", model: "anthropic/nope" } },
      })
    expect(types(a.sent)).toEqual(["open_session"])
  })

  test("#given a model that is not provider/id #when created #then invalid_arguments and nothing is opened", async () => {
    const a = account()
    const { run, openSession } = surface(a.remote)
    for (const model of ["opus", "/opus", "anthropic/"])
      expect(await run("thread_create", { name: "thread-create-options-52", device: "studio", model })).toMatchObject({
        kind: "error",
        error: { code: "invalid_arguments" },
      })
    expect(await run("thread_create", { name: "thread-create-options-56", model: "opus" })).toMatchObject({
      kind: "error",
    })
    expect(a.sent).toEqual([])
    expect(openSession).not.toHaveBeenCalled()
  })

  test("#given launch options with an existing thread #when opened #then invalid_arguments: they apply to a new thread only; a prompt is not a launch option and goes to the thread (#14335)", async () => {
    const a = account()
    const { run } = surface(a.remote)
    expect(await run("thread_create", { thread: "dur-on-b", model: "anthropic/claude-opus-5-5" })).toMatchObject({
      kind: "error",
      error: { code: "invalid_arguments" },
    })
    expect(a.sent).toEqual([])
  })
})

describe("thread_create with an approval mode (#13409): the creator may keep or narrow its own mode, never widen it", () => {
  const cases: Array<[creator: string | undefined, asked: string, allowed: boolean]> = [
    ["workspace", "workspace", true],
    ["workspace", "accept-edits", true],
    ["workspace", "read-only", true],
    ["workspace", "ask", true],
    ["full-access", "auto", true],
    ["workspace", "full-access", false],
    ["read-only", "accept-edits", false],
    ["read-only", "auto", false],
    ["auto", "read-only", false],
    ["auto", "ask", true],
    ["ask", "read-only", false],
    [undefined, "ask", true],
    [undefined, "read-only", false],
  ]
  for (const [creator, asked, allowed] of cases)
    test(`#given a creator in ${creator ?? "an unknown mode"} #when it asks for ${asked} on b #then ${allowed ? "the frame names it" : "scope_denied, nothing opened"}`, async () => {
      const a = account()
      const { run } = surface(creator === undefined ? a.remote : { ...a.remote, permissionPreset: () => creator })
      const result = await run("thread_create", {
        name: "thread-create-options-96",
        device: "studio",
        permission_preset: asked,
      })
      if (allowed) {
        expect(result).toMatchObject({ kind: "ok" })
        expect(openFrames(a.sent)).toEqual([expect.objectContaining({ permissionPreset: asked })])
      } else {
        expect(result).toMatchObject({
          kind: "error",
          error: { code: "scope_denied", details: { reason: "permission_preset_wider", requested: asked } },
        })
        expect(a.sent).toEqual([])
      }
    })

  test("#given a creator in workspace #when it asks for read-only here #then this device's open names read-only", async () => {
    const a = account()
    const { run, openSession } = surface({ ...a.remote, permissionPreset: () => "workspace" })
    expect(
      await run("thread_create", { name: "thread-create-options-112", permission_preset: "read-only" }),
    ).toMatchObject({ kind: "ok" })
    expect(localOpens(openSession)).toEqual([expect.objectContaining({ permissionPreset: "read-only" })])
  })
})

describe("thread_create with a first prompt (#13410)", () => {
  test("#given a prompt #when created on b #then the prompt goes to the new thread and the result names its delivery", async () => {
    const a = account()
    const { run } = surface(a.remote)
    const result = (await run("thread_create", { device: "studio", prompt: "build it" })) as Extract<
      ThreadToolResult,
      { kind: "ok" }
    > & { prompt?: Record<string, unknown> }
    expect(result).toMatchObject({ kind: "ok", thread: "dur-new-on-b", device: "b" })
    expect(result.prompt).toMatchObject({ delivery: { kind: "started" }, deduplicated: false })
    // A peer session's message is an admitted delivery on b, as thread_send makes it (#12882), never a raw prompt.
    const admitted = a.sent.filter((entry) => entry.rpc?.["type"] === "admit_external_message")
    expect(admitted).toEqual([expect.objectContaining({ via: "session", device: "b" })])
    // #14045: the creator's brief is the new thread's own first message, not a relayed peer message under the gateway header.
    const text = String(admitted[0]?.rpc?.["text"])
    expect(text).toStartWith("build it")
    expect(text).not.toContain("OMO_GATEWAY")
    expect(admitted[0]?.rpc?.["displayText"]).toBe("build it")
  })

  test("#given a thread_send to a thread on b after a create there #when delivered #then it keeps the gateway header: only the create's prompt carries the creator's authority (#14045)", async () => {
    const a = account()
    const { run } = surface(a.remote)
    await run("thread_create", { device: "studio", prompt: "build it" })
    await run("thread_send", { thread: "dur-on-b", message: "and then this" })
    const texts = a.sent
      .filter((entry) => entry.rpc?.["type"] === "admit_external_message")
      .map((entry) => String(entry.rpc?.["text"]))
    expect(texts).toHaveLength(2)
    expect(texts[1]).toContain("OMO_GATEWAY")
  })

  // Found by the two-device relay proof: b knows a session it opened a moment ago only by the relay key its open reply named.
  test("#given b knows the new session only by its relay key #when created with a prompt #then the prompt is admitted on that key", async () => {
    const a = account({ relayKeys: new Map([["dur-new-on-b", "relay-key-9"]]), relayKeyOnly: true })
    const { run } = surface(a.remote)
    const result = (await run("thread_create", { device: "studio", prompt: "build it" })) as {
      prompt?: Record<string, unknown>
    }
    expect(result.prompt).toMatchObject({ delivery: { kind: "started" } })
    expect(a.sent.filter((entry) => entry.rpc?.["type"] === "admit_external_message")).toEqual([
      expect.objectContaining({ session: "relay-key-9" }),
    ])
  })

  test("#given a prompt #when created here #then the gateway takes one delivery for the new thread", async () => {
    const a = account()
    const { run, enqueuedRequests } = surface(a.remote)
    const result = (await run("thread_create", { prompt: "build it" })) as { prompt?: Record<string, unknown> }
    expect(result).toMatchObject({ kind: "ok", thread: "dur-created-here" })
    expect(result.prompt).toMatchObject({ delivery: { kind: "started" } })
    // #14045: the row carries the creator's authority, so the new thread's drain admits it as its own first message;
    // a later thread_send from the same session does not.
    await run("thread_send", { thread: "dur-created-here", message: "and then this" })
    expect(enqueuedRequests("dur-created-here").map((request) => request.authority)).toEqual(["creator", undefined])
  })

  test("#given one idempotency key #when the create with a prompt runs twice #then b opens once and is prompted once", async () => {
    const a = account()
    const { run } = surface(a.remote)
    const args = { device: "studio", prompt: "build it", idempotency_key: "create-and-start-1" }
    const first = await run("thread_create", args)
    const replay = await run("thread_create", args)
    const expectedReplay = { ...first, deduplicated: true }
    expect(replay).toEqual(expectedReplay)
    expect(types(a.sent).filter((type) => type === "open_session")).toHaveLength(1)
    expect(types(a.sent).filter((type) => type === "admit_external_message")).toHaveLength(1)
  })

  // Review L1 at 0571de8: a delivery that throws (not a typed refusal) must not turn the created thread into internal_error.
  test("#given the prompt's delivery throws #when created with one #then the thread is answered and the failure is the prompt's outcome", async () => {
    const a = account({ admitThrows: "connection lost" })
    const { run } = surface(a.remote)
    const result = (await run("thread_create", { device: "studio", prompt: "build it" })) as {
      prompt?: Record<string, unknown>
    }
    expect(result).toMatchObject({ kind: "ok", thread: "dur-new-on-b" })
    expect(result.prompt).toMatchObject({ error: { code: "internal_error" } })
  })

  test("#given b refuses the prompt #when created with one #then the thread is answered and the refusal is the prompt's outcome", async () => {
    const a = account({ admitRefuse: "session_busy" })
    const { run } = surface(a.remote)
    const result = (await run("thread_create", { device: "studio", prompt: "build it" })) as {
      prompt?: Record<string, unknown>
    }
    expect(result).toMatchObject({ kind: "ok", thread: "dur-new-on-b" })
    expect(result.prompt).toMatchObject({ error: { code: expect.any(String) } })
  })
})

// The held-thread report: thread_create({ prompt }) answered ok while its first prompt never ran (no client attached, the
// new session's control endpoint never drained the row). A create with a prompt either runs it or fails, typed.
describe("thread_create whose first prompt does not start", () => {
  test("#given a new session here whose control endpoint never drains #when created with a prompt #then the create fails prompt_not_started naming the thread, the delivery and its last state", async () => {
    const a = account()
    const { run, enqueuedRequests } = surface(a.remote, { firstPromptWaitMs: 50, createdNeverDrains: true })
    const result = await run("thread_create", { name: "never-drained", prompt: "build it" })
    expect(result).toMatchObject({
      kind: "error",
      error: {
        code: "prompt_not_started",
        details: { thread: "dur-created-here", delivery_id: expect.any(String), state: "queued" },
      },
    })
    // The prompt was taken once: the thread exists and the next step is a read or a send to it, never a second create.
    expect(enqueuedRequests("dur-created-here")).toHaveLength(1)
  })

  test("#given b answers the prompt queued behind a turn #when created on b with a prompt #then the create answers ok with the prompt queued: b admitted it, so it runs after that turn (#14363 review M1)", async () => {
    const queued = {
      kind: "ok",
      response: {
        type: "response",
        id: null,
        command: "admit_external_message",
        success: true,
        data: { kind: "queued", turnId: "turn-b" },
      },
    } as const
    const a = account({ admitOutcome: queued })
    const { run } = surface(a.remote)
    expect(await run("thread_create", { device: "studio", prompt: "build it" })).toMatchObject({
      kind: "ok",
      thread: "dur-new-on-b",
      prompt: { delivery: { kind: "queued" } },
    })
  })
})

// #14363 review M1: a first prompt the target ADMITTED to its follow-up queue (a follow_up to a busy thread, an auto send
// while the thread waits on a question) runs after what it waits on. The create answers ok with that delivery at once,
// never prompt_not_started with a resend that would deliver it twice.
describe("thread_create whose first prompt the thread admitted to its queue", () => {
  // A create that waited for the start would hold the call for this long and miss the test's own timeout.
  const LONG_WAIT_MS = 60_000

  test("#given the live thread here runs a turn #when thread_create opens it with a follow_up prompt #then ok at once, the prompt queued and taken once", async () => {
    const a = account()
    const { run, enqueuedRequests } = surface(a.remote, { firstPromptWaitMs: LONG_WAIT_MS, localDrainsIn: "mid_turn" })
    const result = (await run("thread_create", {
      thread: "dur-local",
      prompt: "after this",
      delivery: "follow_up",
    })) as {
      prompt?: { delivery?: { waiting_on?: unknown } }
    }
    expect(result).toMatchObject({ kind: "ok", deduplicated: true, prompt: { delivery: { kind: "queued" } } })
    expect(result.prompt?.delivery?.waiting_on).toBeUndefined()
    expect(enqueuedRequests("dur-local")).toHaveLength(1)
  })

  test("#given the live thread here waits on a question #when thread_create opens it with a prompt #then ok at once, the prompt queued waiting on that approval", async () => {
    const a = account()
    const { run } = surface(a.remote, { firstPromptWaitMs: LONG_WAIT_MS, localDrainsIn: "waiting_question" })
    expect(await run("thread_create", { thread: "dur-local", prompt: "after the answer" })).toMatchObject({
      kind: "ok",
      deduplicated: true,
      prompt: { delivery: { kind: "queued", waiting_on: { kind: "approval" } } },
    })
  })

  test("#given the live thread on b runs a turn #when thread_create opens it with a follow_up prompt #then ok, the prompt queued on b", async () => {
    const a = account({ engine: { ...ENGINE, streaming: true, currentTurnId: "turn-b" } })
    const { run } = surface(a.remote)
    expect(
      await run("thread_create", { thread: "dur-on-b", prompt: "after this", delivery: "follow_up" }),
    ).toMatchObject({ kind: "ok", deduplicated: true, prompt: { delivery: { kind: "queued" } } })
  })

  // #14363 delta review L1: b stored the prompt for a session its host parked and wakes it with the delivery, as a
  // thread_send to it answers. The create answers that same state, never prompt_not_started with a resend that would
  // wake the session with two copies.
  test("#given b parked the thread its listing reads live #when thread_create opens it with a prompt, twice under one key #then ok, the prompt queued waiting on b's wake with a do-not-resend next_action, and one wake carries it", async () => {
    const a = account({ live: [], unlistedReason: "route_unlisted", wakeFeature: true })
    const { run } = surface(a.remote)
    const args = { thread: "dur-on-b", prompt: "carry on", idempotency_key: "create-wake-1" }
    const first = await run("thread_create", args)
    expect(first).toMatchObject({
      kind: "ok",
      deduplicated: true,
      prompt: { delivery: { kind: "queued", waiting_on: { kind: "wake", device: "b" } } },
    })
    expect((first as { prompt?: { next_action?: string } }).prompt?.next_action).toEqual(
      expect.stringContaining("thread_read"),
    )
    expect(await run("thread_create", args)).toEqual(first)
    expect(a.sent.filter((entry) => entry.via === "wake")).toHaveLength(1)
  })

  test("#given the live thread on b waits on a question #when thread_create opens it with a prompt #then ok, the prompt queued waiting on that approval on b", async () => {
    const a = account({
      engine: {
        ...ENGINE,
        streaming: true,
        currentTurnId: "turn-b",
        pendingQuestions: [{ id: "q-1", kind: "permission" }],
      },
    })
    const { run } = surface(a.remote)
    expect(
      await run("thread_create", { thread: "dur-on-b", prompt: "after the answer", delivery: "follow_up" }),
    ).toMatchObject({
      kind: "ok",
      deduplicated: true,
      prompt: { delivery: { kind: "queued", waiting_on: { kind: "approval", device: "b" } } },
    })
  })
})

// #14335 / #14289: a create that opens a thread live already answered `deduplicated` from placement and returned
// before its prompt was sent: ok, with the prompt dropped. The prompt goes to the live thread and the create answers
// its real delivery, or fails prompt_not_started.
describe("thread_create naming a thread that is live already, with a prompt", () => {
  test("#given b runs the thread #when thread_create opens it with a prompt #then nothing is opened, the prompt is admitted on b once, and the create answers its delivery", async () => {
    const a = account()
    const { run } = surface(a.remote)
    const result = await run("thread_create", { thread: "dur-on-b", prompt: "carry on" })
    expect(result).toMatchObject({
      kind: "ok",
      thread: "dur-on-b",
      deduplicated: true,
      prompt: { delivery: { kind: "started" } },
    })
    expect(types(a.sent).filter((type) => type === "open_session")).toEqual([])
    expect(types(a.sent).filter((type) => type === "admit_external_message")).toHaveLength(1)
  })

  test("#given a thread live here that does not drain #when thread_create opens it with a prompt #then the prompt is taken once and the create fails prompt_not_started, never ok with the prompt dropped", async () => {
    const a = account()
    const { run, openSession, enqueuedRequests } = surface(a.remote)
    expect(await run("thread_create", { thread: "dur-local", prompt: "carry on" })).toMatchObject({
      kind: "error",
      error: { code: "prompt_not_started", details: { thread: "dur-local", state: "queued" } },
    })
    expect(openSession).not.toHaveBeenCalled()
    expect(enqueuedRequests("dur-local")).toHaveLength(1)
  })
})

// The owner's live lost-prompt case: thread_create({ ..., message: "<brief>" }) answered ok with no prompt and no error,
// because an unknown field was dropped silently. A field a tool does not take is refused, naming it and the field meant.
describe("thread tool fields the tool does not take", () => {
  test("#given a create that passes its brief as message #when created #then invalid_arguments names message, suggests prompt, and nothing is created", async () => {
    const a = account()
    const { run, openSession } = surface(a.remote)
    const here = await run("thread_create", { name: "misnamed-here", message: "build it" })
    const there = await run("thread_create", { name: "misnamed-there", device: "studio", message: "build it" })
    for (const result of [here, there])
      expect(result).toMatchObject({
        kind: "error",
        error: { code: "invalid_arguments", details: { field: "message", suggestion: "prompt" } },
      })
    expect(openSession).not.toHaveBeenCalled()
    expect(a.sent).toEqual([])
  })

  test("#given a create with a name and no prompt #when created #then the result says prompt null: nothing was sent", async () => {
    const a = account()
    const { run } = surface(a.remote)
    expect(await run("thread_create", { name: "no-prompt-here" })).toMatchObject({ kind: "ok", prompt: null })
    expect(await run("thread_create", { name: "no-prompt-there", device: "studio" })).toMatchObject({
      kind: "ok",
      prompt: null,
    })
  })

  test("#given a send with a field thread_send does not take #when sent #then invalid_arguments names the field and nothing is delivered", async () => {
    const a = account()
    const { run, enqueuedFor } = surface(a.remote)
    expect(await run("thread_send", { thread: "dur-local", message: "hi", priority: "high" })).toMatchObject({
      kind: "error",
      error: { code: "invalid_arguments", details: { field: "priority" } },
    })
    expect(await run("thread_send", { thread: "dur-local", prompt: "hi" })).toMatchObject({
      kind: "error",
      error: { code: "invalid_arguments", details: { field: "prompt", suggestion: "message" } },
    })
    expect(enqueuedFor("dur-local")).toBe(0)
  })
})
