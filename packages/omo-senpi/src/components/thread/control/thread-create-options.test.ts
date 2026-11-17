import { afterEach, describe, expect, test } from "bun:test"
import type { ThreadToolResult } from "../contracts"
import { createRemoteThreadFixture } from "../thread-remote-fixture"

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
    expect(await run("thread_create", options)).toMatchObject({ kind: "ok", thread: "dur-created-here" })
    expect(await run("thread_create", { device: "studio", ...options })).toMatchObject({
      kind: "ok",
      thread: "dur-new-on-b",
      device: "b",
    })
    const launch = { provider: "anthropic", modelId: "claude-opus-5-5", thinkingLevel: "high" }
    expect(localOpens(openSession)).toEqual([expect.objectContaining(launch)])
    expect(openFrames(a.sent)).toEqual([expect.objectContaining(launch)])
    expect(types(a.sent)).toEqual(["open_session"])
  })

  test("#given a model the engine cannot resolve #when created here and on b #then each answers model_not_found and opens nothing", async () => {
    const refusal = "model_unavailable: no model anthropic/nope"
    const a = account({ openRefuse: refusal })
    const { run } = surface(a.remote, { openThrows: refusal })
    const here = await run("thread_create", { model: "anthropic/nope" })
    const there = await run("thread_create", { device: "studio", model: "anthropic/nope" })
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
      expect(await run("thread_create", { device: "studio", model })).toMatchObject({
        kind: "error",
        error: { code: "invalid_arguments" },
      })
    expect(await run("thread_create", { model: "opus" })).toMatchObject({ kind: "error" })
    expect(a.sent).toEqual([])
    expect(openSession).not.toHaveBeenCalled()
  })

  test("#given create options with an existing thread #when opened #then invalid_arguments: they apply to a new thread only", async () => {
    const a = account()
    const { run } = surface(a.remote)
    expect(await run("thread_create", { thread: "dur-on-b", model: "anthropic/claude-opus-5-5" })).toMatchObject({
      kind: "error",
      error: { code: "invalid_arguments" },
    })
    expect(await run("thread_create", { thread: "dur-on-b", prompt: "go" })).toMatchObject({
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
      const result = await run("thread_create", { device: "studio", permission_preset: asked })
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
    expect(await run("thread_create", { permission_preset: "read-only" })).toMatchObject({ kind: "ok" })
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
    expect(JSON.stringify(admitted[0]?.rpc)).toContain("build it")
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
    const { run, enqueuedFor } = surface(a.remote)
    const result = (await run("thread_create", { prompt: "build it" })) as { prompt?: Record<string, unknown> }
    expect(result).toMatchObject({ kind: "ok", thread: "dur-created-here" })
    expect(result.prompt).toMatchObject({ delivery: { kind: expect.any(String) } })
    expect(enqueuedFor("dur-created-here")).toBe(1)
  })

  test("#given one idempotency key #when the create with a prompt runs twice #then b opens once and is prompted once", async () => {
    const a = account()
    const { run } = surface(a.remote)
    const args = { device: "studio", prompt: "build it", idempotency_key: "create-and-start-1" }
    const first = await run("thread_create", args)
    const replay = await run("thread_create", args)
    expect(replay).toEqual(first)
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
