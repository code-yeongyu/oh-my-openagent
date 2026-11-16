import { afterEach, describe, expect, test } from "bun:test"
import { connectDeviceService } from "@oh-my-opencode/device-service-core/device-service"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { JsonObject } from "../../../../device-service-core/src/local-api/protocol.ts"
import {
  defaultWorld,
  PEER,
  SESSION_ID,
  type World,
} from "../../../../device-service-core/test/local-api/conformance/world.ts"
import { canonicalizeThreadHandle, handleOf } from "./seams"
import { clientOn, closeClients, failureOf, fakeClock, startOwner } from "./testing/fake-service"
import type { ThreadHandle } from "./types"

// The session members of #13414 unit U1 over the device service's conformance owner: the shared create path
// (open_session on the peer's engine endpoint), then send, read, close, interrupt, the session-scoped model and thinking
// level, get and archive on the session that open made or the world's live one.

const emptyDirs: string[] = []
afterEach(async () => {
  await closeClients()
  for (const dir of emptyDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const NEW_KEY = "bmV3LXNlc3Npb24ta2V5MQ"
const ENGINE_ID = "dur-new"

// One engine reply for every record a session takes on the delegated channel (the owner answers each with the same data):
// get_state's fields, a started prompt, an interrupt, a close ladder's unload, the model catalog and set_model's echo.
const SESSION_REPLY: JsonObject = {
  isStreaming: false,
  currentTurnId: "7",
  pendingMessageCount: 0,
  pendingDialogs: [],
  model: { provider: "anthropic", id: "claude" },
  thinkingLevel: "high",
  permissionPreset: "workspace",
  cwd: "/home/user/omo",
  disposition: "started",
  kind: "started",
  turnId: "7",
  interrupted: true,
  outcome: "unloaded",
  models: [{ provider: "anthropic", id: "claude" }],
  provider: "anthropic",
  id: "claude",
}

const world = (): World => {
  const base = defaultWorld()
  const live = base.sessions[0]
  if (live === undefined) throw new Error("the default world holds a live session")
  const replying = { ...live, delegated: { data: SESSION_REPLY, frames: [] } }
  return {
    ...base,
    endpoints: { [PEER]: ["ZW5kcG9pbnQta2V5LTAwMD"] },
    endpointCommand: {
      data: { sessionId: "engine-routing-1", state: { sessionId: ENGINE_ID, cwd: "/work" } },
      outcome: [{ state: "engine_applied", retryable: false }],
    },
    located: { [PEER]: { [ENGINE_ID]: NEW_KEY } },
    sessions: [replying, { ...replying, session_id: NEW_KEY }],
  }
}

const valueOf = async <T>(
  outcome: Promise<{ readonly kind: "ok"; readonly value: T } | { readonly kind: "error" }>,
): Promise<T> => {
  const settled = await outcome
  if (settled.kind !== "ok") throw new Error(`expected a value, got ${JSON.stringify(settled)}`)
  return settled.value
}

const onWorld = async () => {
  const owner = await startOwner(world())
  const sent = (type: string) => owner.state.commands.filter((rpc) => rpc["type"] === type)
  return { owner, sent }
}

const LIVE = handleOf(PEER, SESSION_ID)

describe("sessions.open", () => {
  test("#given a person's open with every field #when it opens on the peer #then one open_session carries the launch profile and first goes under its key", async () => {
    const { owner, sent } = await onWorld()
    const client = clientOn(owner.stateDir, fakeClock())
    const opened = await valueOf(
      client.sessions.open({
        device: PEER,
        workspace: "/work",
        name: "review",
        model: "anthropic/claude/opus",
        reasoning: "high",
        preset: "read-only",
        initial_skills: ["git-master"],
        first: { text: "start" },
        idempotency_key: "open-1",
      }),
    )
    expect(opened.thread).toBe(handleOf(PEER, NEW_KEY))
    expect(opened.device).toMatchObject({ id: PEER, name: "Studio" })
    expect(opened.receipt).toMatchObject({ thread: handleOf(PEER, NEW_KEY), lane: "started", turn_id: "7" })
    expect(sent("open_session")).toEqual([
      expect.objectContaining({
        cwd: "/work",
        provider: "anthropic",
        modelId: "claude/opus",
        thinkingLevel: "high",
        permissionPreset: "read-only",
        context: expect.any(Object),
      }),
    ])
    expect(sent("set_session_name")).toEqual([expect.objectContaining({ name: "review", sessionId: NEW_KEY })])
    expect(sent("prompt")).toEqual([expect.objectContaining({ message: "start", sessionId: NEW_KEY })])

    // The same key replays the open: no second session, no second prompt.
    const again = await valueOf(
      client.sessions.open({
        device: PEER,
        workspace: "/work",
        name: "review",
        model: "anthropic/claude/opus",
        reasoning: "high",
        preset: "read-only",
        initial_skills: ["git-master"],
        first: { text: "start" },
        idempotency_key: "open-1",
      }),
    )
    expect(again.thread).toBe(opened.thread)
    expect(sent("open_session")).toHaveLength(1)
    expect(sent("prompt")).toHaveLength(1)
  })

  test("#given a model that is not provider/id #when sessions.open runs #then invalid_arguments and nothing is sent", async () => {
    const { owner } = await onWorld()
    const client = clientOn(owner.stateDir, fakeClock())
    expect(failureOf(await client.sessions.open({ device: PEER, model: "claude" }))).toMatchObject({
      code: "invalid_arguments",
      details: { model: "claude" },
    })
    expect(owner.state.commands).toEqual([])
  })

  test("#given an engine that cannot run the model #when sessions.open runs #then model_not_found{model_unavailable} and no session is named", async () => {
    const { owner, sent } = await onWorld()
    // The peer's engine refuses the open as senpi does (open-session-model.ts): the real command outcome, the engine's
    // failed reply in place of the conformance owner's fixed one.
    const refusing = clientOn(owner.stateDir, fakeClock(), undefined, {
      connect: async (options) => {
        const svc = await connectDeviceService(options)
        return {
          ...svc,
          endpointCommand: async (device, rpc, endpointOptions) => ({
            ...(await svc.endpointCommand(device, rpc, endpointOptions)),
            response: {
              type: "response",
              command: "open_session",
              success: false,
              error: "open_failed: model_unavailable: anthropic/nope is not available",
            },
          }),
        }
      },
    })
    expect(failureOf(await refusing.sessions.open({ device: PEER, model: "anthropic/nope" }))).toMatchObject({
      code: "model_not_found",
      details: { reason: "model_unavailable", model: "anthropic/nope" },
    })
    expect(sent("open_session")).toHaveLength(1)
    expect(sent("set_session_name")).toEqual([])
  })

  test("#given a session client whose own mode is unknown #when it asks for a wider preset #then scope_denied permission_preset_wider and nothing is sent", async () => {
    const { owner } = await onWorld()
    const session = clientOn(owner.stateDir, fakeClock(), { kind: "session", id: "dur-caller" })
    expect(failureOf(await session.sessions.open({ device: PEER, preset: "workspace" }))).toMatchObject({
      code: "scope_denied",
      details: { reason: "permission_preset_wider", requested: "workspace" },
    })
    expect(owner.state.commands).toEqual([])
    expect((await valueOf(session.sessions.open({ device: PEER, preset: "ask" }))).thread).toBe(handleOf(PEER, NEW_KEY))
  })

  test("#given no device service on this device #when sessions.open runs #then local_only names the SDK step", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "rs-"))
    emptyDirs.push(stateDir)
    const failure = failureOf(await clientOn(stateDir, fakeClock()).sessions.open({ device: "local" }))
    expect(failure.code).toBe("local_only")
    expect(failure.next_action).toContain("service.bootstrap")
  })
})

describe("sessions.send and sessions.read", () => {
  test("#given the live session #when a person sends #then a prompt starts a turn and a repeat under the key sends nothing", async () => {
    const { owner, sent } = await onWorld()
    const client = clientOn(owner.stateDir, fakeClock())
    const receipt = await valueOf(client.sessions.send(LIVE, { text: "hello", idempotency_key: "k-1" }))
    expect(receipt).toMatchObject({ thread: LIVE, lane: "started", turn_id: "7", device: { id: PEER } })
    await valueOf(client.sessions.send(LIVE, { text: "hello", idempotency_key: "k-1" }))
    expect(sent("prompt")).toEqual([expect.objectContaining({ message: "hello", streamingBehavior: "followUp" })])
    expect(failureOf(await client.sessions.send(LIVE, { text: "other", idempotency_key: "k-1" })).code).toBe(
      "idempotency_conflict",
    )
  })

  // #13004 (decision 0027 section 3, carried from omo-native remote-session-verbs.test.ts): every delivery names the
  // device it was sent from, as the receiver parses it from the envelope header.
  test("#given a session client #when it sends #then its delivery's envelope names this device", async () => {
    // A service below the wake mark (0.1.31): the conformance owner does not model the mark a newer one carries.
    const owner = await startOwner({ ...world(), service_version: "0.1.30" })
    const sent = (type: string) => owner.state.commands.filter((rpc) => rpc["type"] === type)
    const session = clientOn(owner.stateDir, fakeClock(), { kind: "session", id: "dur-caller" })
    expect(await valueOf(session.sessions.send(LIVE, { text: "hello" }))).toMatchObject({ lane: "started" })
    const [admitted] = sent("admit_external_message")
    const header = /\[OMO_GATEWAY ([^\]]*)\]/.exec(String(admitted?.["text"]))?.[1]?.split(" ") ?? []
    expect(header).toContain('device="dev-self"')
    expect(header).toContain("sender_session=dur-caller")
  })

  test("#given an attachment or an author on a person client #when sessions.send runs #then it is refused typed and nothing is sent", async () => {
    const { owner } = await onWorld()
    const client = clientOn(owner.stateDir, fakeClock())
    const bytes = { bytes: new Uint8Array([1]), name: "a.bin" }
    expect(failureOf(await client.sessions.send(LIVE, { text: "x", attachments: [bytes] }))).toMatchObject({
      code: "unsupported",
      details: { feature: "attachments" },
    })
    const author = { platform_user_id: "U1", display: "Ada" }
    expect(failureOf(await client.sessions.send(LIVE, { text: "x", author })).code).toBe("invalid_arguments")
    expect(owner.state.commands).toEqual([])
  })

  test("#given the live session's history #when sessions.read pages before an entry #then it answers the device's page", async () => {
    const { owner } = await onWorld()
    const page = await valueOf(clientOn(owner.stateDir, fakeClock()).sessions.read(LIVE, { before: "e-3" }))
    expect(page.entries.map((entry) => entry.entry_id)).toEqual(["e-1", "e-2"])
    expect(page.next_before).toBeNull()
  })

  test("#given an address that names no device #when a session member runs #then invalid_arguments points at sessions.resolve", async () => {
    const { owner } = await onWorld()
    const parsed = canonicalizeThreadHandle("review", {})
    if (parsed.kind !== "ok") throw new Error("an address parses")
    const address: ThreadHandle = parsed.value.handle
    const failure = failureOf(await clientOn(owner.stateDir, fakeClock()).sessions.read(address))
    expect(failure.code).toBe("invalid_arguments")
    expect(failure.next_action).toContain("sessions.resolve")
  })
})

describe("sessions controls", () => {
  test("#given the live session #when sessions.close runs #then the close ladder unloads it", async () => {
    const { owner, sent } = await onWorld()
    expect(await valueOf(clientOn(owner.stateDir, fakeClock()).sessions.close(LIVE))).toEqual({ closed: true })
    expect(sent("unload_session")).toEqual([expect.objectContaining({ sessionId: SESSION_ID, force: true })])
  })

  test("#given an engine that reports no background jobs #when sessions.interrupt runs #then background is not_supported", async () => {
    const { owner, sent } = await onWorld()
    expect(await valueOf(clientOn(owner.stateDir, fakeClock()).sessions.interrupt(LIVE))).toEqual({
      thread_id: LIVE,
      turn_id: "7",
      interrupted: true,
      background: { status: "not_supported" },
      device: PEER,
    })
    expect(sent("interrupt")).toHaveLength(1)
  })

  test("#given the live session #when its model and reasoning are set #then set_model has scope session and set_thinking_level scope turn", async () => {
    const { owner, sent } = await onWorld()
    const client = clientOn(owner.stateDir, fakeClock())
    expect(await valueOf(client.sessions.setModel(LIVE, "anthropic/claude"))).toEqual({ model: "anthropic/claude" })
    expect(await valueOf(client.sessions.setReasoning(LIVE, "high"))).toEqual({ reasoning: "high" })
    expect(sent("set_model")).toEqual([
      expect.objectContaining({ provider: "anthropic", modelId: "claude", scope: "session" }),
    ])
    expect(sent("set_thinking_level")).toEqual([expect.objectContaining({ level: "high", scope: "turn" })])
  })

  test("#given the live session #when sessions.get reads #then the listing row joins the engine's state", async () => {
    const { owner } = await onWorld()
    const detail = await valueOf(clientOn(owner.stateDir, fakeClock()).sessions.get(LIVE))
    expect(detail).toMatchObject({
      thread: LIVE,
      title: "Live session",
      state: "running",
      device: { id: PEER },
      cwd: "/home/user/omo",
      model: "anthropic/claude",
      reasoning: "high",
      preset: "workspace",
      turn: { id: "7", state: "idle" },
      pending: { dialogs: 0, queued: 0 },
    })
  })

  test("#given no layer stores archive state #when sessions.archive runs #then unsupported{archive}", async () => {
    const { owner } = await onWorld()
    expect(failureOf(await clientOn(owner.stateDir, fakeClock()).sessions.archive(LIVE, true))).toMatchObject({
      code: "unsupported",
      details: { feature: "archive" },
    })
  })
})
