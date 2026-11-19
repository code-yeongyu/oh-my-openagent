import { afterEach, describe, expect, test } from "bun:test"
import { connectDeviceService } from "@oh-my-opencode/device-service-core/device-service"
import { mkdtempSync, rmSync } from "node:fs"
import type { Socket } from "node:net"
import { tmpdir, userInfo } from "node:os"
import { join } from "node:path"
import type { JsonObject, ListingRow } from "../../../../device-service-core/src/local-api/protocol.ts"
import {
  defaultWorld,
  PEER,
  SESSION_ID,
  type World,
} from "../../../../device-service-core/test/local-api/conformance/world.ts"
import { type ContractHost, withContractHost } from "../../../../senpi-task/src/runners/rpc-host/testing/contract-host"
import { createLiveThreadSurface } from "../thread/live-surface"
import { DEADLINES } from "./deadlines"
import { createLocalSessions } from "./local-sessions"
import { canonicalizeThreadHandle, handleOf } from "./seams"
import { personIdentity, resolveSessionTarget } from "./sessions"
import {
  clientOn,
  closeClients,
  failureOf,
  fakeClock,
  type FakeClock,
  startModeOwner,
  startOwner,
} from "./testing/fake-service"
import type { ThreadHost, ThreadHostSession } from "../thread/tools/ports"
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

const openedRow = (rows: readonly ListingRow[]): ListingRow => {
  const live = rows.find((row) => row.device === PEER)
  if (live === undefined) throw new Error("the default world lists the peer's live session")
  return { ...live, session_id: NEW_KEY, title: "review", durable_id: ENGINE_ID }
}

const world = (): World => {
  const base = defaultWorld()
  const live = base.sessions[0]
  if (live === undefined) throw new Error("the default world holds a live session")
  const replying = { ...live, delegated: { data: SESSION_REPLY, frames: [] } }
  return {
    ...base,
    endpoints: { [PEER]: ["ZW5kcG9pbnQta2V5LTAwMD"] },
    primary: { [PEER]: "ZW5kcG9pbnQta2V5LTAwMD" },
    endpointCommand: {
      data: { sessionId: "engine-routing-1", state: { sessionId: ENGINE_ID, cwd: "/work" } },
      outcome: [{ state: "engine_applied", retryable: false }],
    },
    located: { [PEER]: { [ENGINE_ID]: NEW_KEY } },
    // The opened session as its device lists it once the listing caught up: its key, and its durable id beside it.
    listing: {
      ...base.listing,
      revisions: base.listing.revisions.map((revision, index, all) =>
        index < all.length - 1 ? revision : { ...revision, rows: [...revision.rows, openedRow(revision.rows)] },
      ),
    },
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

/** Awaits `signal`, failing the test with what never came if it has not settled within 5 s. */
const within = <T>(signal: Promise<T>, what: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const breaker = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`waited 5 s for ${what}; it never came`)), 5_000)
  })
  return Promise.race([signal, breaker]).finally(() => clearTimeout(timer))
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

  test("#given a session client told its own mode #when it opens #then it may keep or narrow it, never widen it, and keeps it by default", async () => {
    const { owner, sent } = await onWorld()
    const session = clientOn(
      owner.stateDir,
      fakeClock(),
      { kind: "session", id: "dur-caller" },
      {
        permissionPreset: () => "accept-edits",
      },
    )
    expect(failureOf(await session.sessions.open({ device: PEER, preset: "workspace" }))).toMatchObject({
      code: "scope_denied",
      details: { reason: "permission_preset_wider", requested: "workspace", own: "accept-edits" },
    })
    await valueOf(session.sessions.open({ device: PEER, preset: "read-only" }))
    await valueOf(session.sessions.open({ device: PEER }))
    expect(sent("open_session").map((rpc) => rpc["permissionPreset"])).toEqual(["read-only", "accept-edits"])
  })

  test("#given a device that cannot name the new session's listing key #when sessions.open runs #then the session is answered with a warning", async () => {
    const owner = await startOwner({ ...world(), located: { [PEER]: {} } })
    const opened = await valueOf(clientOn(owner.stateDir, fakeClock()).sessions.open({ device: PEER }))
    expect(opened.thread).toBe(handleOf(PEER, ENGINE_ID))
    expect(opened.warnings).toEqual([expect.stringContaining("did not name its relay key")])
  })

  test("#given no device service on this device #when sessions.open runs #then local_only names the SDK step", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "rs-"))
    emptyDirs.push(stateDir)
    const client = clientOn(stateDir, fakeClock())
    const failure = failureOf(await client.sessions.open({ device: "local" }))
    expect(failure.code).toBe("local_only")
    expect(failure.next_action).toContain("service.bootstrap")
    // Another device's id is not this device: with no service it names no device (#13787 review L5).
    expect(failureOf(await client.sessions.open({ device: PEER }))).toMatchObject({
      code: "not_found",
      details: { kind: "device" },
    })
  })
})

describe("sessions.send and sessions.read", () => {
  test("#given the live session #when a person sends #then a prompt starts a turn and a repeat under the key sends nothing", async () => {
    const { owner, sent } = await onWorld()
    const client = clientOn(owner.stateDir, fakeClock())
    const receipt = await valueOf(client.sessions.send(LIVE, { text: "hello", idempotency_key: "k-1" }))
    expect(receipt).toMatchObject({ thread: LIVE, lane: "started", turn_id: "7", device: { id: PEER } })
    // The replay names the prompt that was sent: the same client message id.
    expect((await valueOf(client.sessions.send(LIVE, { text: "hello", idempotency_key: "k-1" }))).delivery_id).toBe(
      receipt.delivery_id,
    )
    expect(sent("prompt")).toEqual([
      expect.objectContaining({
        message: "hello",
        streamingBehavior: "followUp",
        clientMessageId: receipt.delivery_id,
      }),
    ])
    expect(failureOf(await client.sessions.send(LIVE, { text: "other", idempotency_key: "k-1" })).code).toBe(
      "idempotency_conflict",
    )
  })

  test("#given a steer whose state read ends uncertain #when the same key is retried #then it reads the device again instead of replaying the failure, and sends no prompt (#12925)", async () => {
    const base = world()
    const owner = await startOwner({
      ...base,
      sessions: base.sessions.map((session) => ({
        ...session,
        outcome: [{ state: "uncertain", reason: "request_gone", retryable: false }],
      })),
    })
    const sent = (type: string) => owner.state.commands.filter((rpc) => rpc["type"] === type)
    const client = clientOn(owner.stateDir, fakeClock())
    const steer = { text: "s", mode: "steer", idempotency_key: "k-probe" } as const
    const first = failureOf(await client.sessions.send(LIVE, steer))
    const second = failureOf(await client.sessions.send(LIVE, steer))
    expect([first.code, second.code]).toEqual(["host_unavailable", "host_unavailable"])
    expect(sent("get_state")).toHaveLength(2)
    expect(sent("prompt")).toEqual([])
  })

  test("#given a person's sends #when each is delivered #then its prompt carries a fresh clientMessageId, returned as the receipt's delivery_id", async () => {
    const { owner, sent } = await onWorld()
    const client = clientOn(owner.stateDir, fakeClock())
    const first = await valueOf(client.sessions.send(LIVE, { text: "one" }))
    const second = await valueOf(client.sessions.send(LIVE, { text: "two" }))
    expect(typeof first.delivery_id).toBe("string")
    expect(sent("prompt").map((rpc) => String(rpc["clientMessageId"]))).toEqual([
      String(first.delivery_id),
      String(second.delivery_id),
    ])
    expect(first.delivery_id).not.toBe(second.delivery_id)
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

  test("#given the live session #when sessions.read asks for a page the service refuses #then invalid_arguments, as attach's read answers", async () => {
    const { owner } = await onWorld()
    const failure = failureOf(await clientOn(owner.stateDir, fakeClock()).sessions.read(LIVE, { tail: 0 }))
    expect(failure).toMatchObject({ code: "invalid_arguments", details: { local_api_code: "invalid_request" } })
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
    expect(await valueOf(clientOn(owner.stateDir, fakeClock()).sessions.close(LIVE))).toEqual({
      closed: true,
      dropped_deliveries: [],
    })
    expect(sent("unload_session")).toEqual([expect.objectContaining({ sessionId: SESSION_ID, force: true })])
  })

  test("#given an engine that reports no background jobs #when sessions.interrupt runs #then background is not_supported", async () => {
    const { owner, sent } = await onWorld()
    expect(await valueOf(clientOn(owner.stateDir, fakeClock()).sessions.interrupt(LIVE))).toEqual({
      thread: LIVE,
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

  test("#given a session just opened that the listing does not carry yet #when sessions.get reads its handle #then its device answers its state (#13756 L2)", async () => {
    const owner = await startOwner({ ...world(), listing: defaultWorld().listing })
    const client = clientOn(owner.stateDir, fakeClock())
    const { thread } = await valueOf(client.sessions.open({ device: PEER }))
    expect(await valueOf(client.sessions.get(thread))).toMatchObject({
      thread,
      device: { id: PEER },
      source: "live",
      state: "idle",
      cwd: "/home/user/omo",
      model: "anthropic/claude",
      reasoning: "high",
      preset: "workspace",
    })
  })

  test("#given the live session #when sessions.archive archives then unarchives it #then each sends set_session_archived to it and answers the flag", async () => {
    const { owner, sent } = await onWorld()
    const client = clientOn(owner.stateDir, fakeClock())
    expect(await valueOf(client.sessions.archive(LIVE, true))).toEqual({ archived: true })
    expect(await valueOf(client.sessions.archive(LIVE, false))).toEqual({ archived: false })
    expect(sent("set_session_archived")).toEqual([
      expect.objectContaining({ archived: true }),
      expect.objectContaining({ archived: false }),
    ])
  })
})

describe("durable-id addressing", () => {
  // A handle's session part is the device's listing key or the session's durable id (what open's engine reply names);
  // every session member resolves it through resolveSessionTarget to the key the device lists it by.
  const opened = async () => {
    const { owner, sent } = await onWorld()
    const client = clientOn(owner.stateDir, fakeClock())
    expect((await valueOf(client.sessions.open({ device: PEER }))).thread).toBe(handleOf(PEER, NEW_KEY))
    return { client, sent }
  }

  for (const [label, session] of [
    ["durable id", ENGINE_ID],
    ["listing key", NEW_KEY],
  ] as const)
    test(`#given a session just opened #when send, setModel, interrupt and close address it by its ${label} #then every record reaches its listing key`, async () => {
      const { client, sent } = await opened()
      const thread = handleOf(PEER, session)
      expect(await valueOf(client.sessions.send(thread, { text: "go" }))).toMatchObject({ lane: "started" })
      expect(await valueOf(client.sessions.setModel(thread, "anthropic/claude"))).toEqual({ model: "anthropic/claude" })
      expect(await valueOf(client.sessions.interrupt(thread))).toMatchObject({ interrupted: true })
      expect(await valueOf(client.sessions.close(thread))).toEqual({ closed: true, dropped_deliveries: [] })
      for (const type of ["prompt", "set_model", "interrupt", "unload_session"])
        expect(sent(type).map((rpc) => rpc["sessionId"])).toEqual([NEW_KEY])
    })

  test("#given a session its device does not hold #when a member addresses it #then not_found{session} names sessions.list, never an update", async () => {
    const { client } = await opened()
    // A well-formed listing key the device does not hold: a service with #1350 refuses an id that is no key at all as
    // invalid_request before any lookup.
    const nowhere = handleOf(PEER, "bm90LWhlbGQta2V5LTAwMQ")
    for (const settled of [
      await client.sessions.interrupt(nowhere),
      await client.sessions.setModel(nowhere, "anthropic/claude"),
      await client.sessions.get(nowhere),
    ]) {
      const failure = failureOf(settled)
      expect(failure).toMatchObject({ code: "not_found", details: { kind: "session", device: PEER } })
      expect(failure.next_action).toContain("sessions.list")
    }
  })

  test("#given resolveSessionTarget #when it takes a durable id the listing carries #then it answers the listing key and row", async () => {
    // The resolver resolve.ts reuses, at its own seam: a person client's core is what sessionMembers is built from.
    const { owner } = await onWorld()
    const client = clientOn(owner.stateDir, fakeClock())
    const core = {
      sender: { kind: "person", uid: "user-1" },
      timers: fakeClock(),
      deps: { version: "5.1.70" },
      dial: () => Promise.reject(new Error("the listing alone resolves a listed durable id")),
      member: () => Promise.reject(new Error("the listing alone resolves a listed durable id")),
      sessionsList: client.sessions.list,
      devicesList: client.devices.list,
      self: () => client,
      localSessions: () => Promise.reject(new Error("the listing alone resolves a listed durable id")),
    } as const
    expect(await valueOf(resolveSessionTarget(core, PEER, ENGINE_ID))).toMatchObject({
      device: PEER,
      session: NEW_KEY,
      row: { title: "review", durable_id: ENGINE_ID },
    })
  })
})

describe("#13756 review", () => {
  test("#given a cli client and no session mode #when it opens with full-access #then the open frame carries it (M1)", async () => {
    const { owner, sent } = await onWorld()
    const cli = clientOn(owner.stateDir, fakeClock(), { kind: "cli", uid: "501" })
    await valueOf(cli.sessions.open({ device: PEER, preset: "full-access" }))
    expect(sent("open_session").map((rpc) => rpc["permissionPreset"])).toEqual(["full-access"])
  })

  test("#given a session client not told its own mode #when it opens without a preset #then the frame asks for ask, never the device default (M1)", async () => {
    const { owner, sent } = await onWorld()
    const session = clientOn(owner.stateDir, fakeClock(), { kind: "session", id: "dur-caller" })
    await valueOf(session.sessions.open({ device: PEER }))
    expect(sent("open_session").map((rpc) => rpc["permissionPreset"])).toEqual(["ask"])
  })

  test("#given sessions.open with and without a first prompt #when each opens #then its open_session dials its own connection, closed once it settles, and the first prompt attaches on the shared one (dev #13761 parity, M1 of 6473ed9)", async () => {
    const { owner } = await onWorld()
    // Per dialed connection: its endpoint records, the sessions it attached, and the records sent on those attaches.
    type Dialed = {
      readonly endpoint: string[]
      readonly attached: string[]
      readonly commands: string[]
      closed: boolean
    }
    const dialed: Dialed[] = []
    const client = clientOn(owner.stateDir, fakeClock(), undefined, {
      connect: async (options) => {
        const svc = await connectDeviceService(options)
        const entry: Dialed = { endpoint: [], attached: [], commands: [], closed: false }
        dialed.push(entry)
        return {
          ...svc,
          endpointCommand: async (device, rpc, endpointOptions) => {
            entry.endpoint.push(String(rpc["type"]))
            return await svc.endpointCommand(device, rpc, endpointOptions)
          },
          attach: async (device, sessionId) => {
            entry.attached.push(sessionId)
            const attach = await svc.attach(device, sessionId)
            return {
              ...attach,
              command: async (rpc, mark) => {
                entry.commands.push(String(rpc["type"]))
                return await attach.command(rpc, mark)
              },
            }
          },
          close: () => {
            entry.closed = true
            svc.close()
          },
        }
      },
    })
    // Opening on the shared connection attaches the host's delegated engine connection to it, so every streamed delta
    // would arrive twice there (#12777): the open rides a connection of its own, which the shared one outlives. The
    // attach that follows the open rides the shared one.
    await valueOf(client.sessions.open({ device: PEER }))
    expect(dialed).toEqual([
      { endpoint: [], attached: [NEW_KEY], commands: [], closed: false },
      { endpoint: ["open_session"], attached: [], commands: [], closed: true },
    ])
    // The first prompt is a send (deliverTo -> core.member -> legOf): it goes on an attach of the shared connection,
    // which then carries one copy per delta, never on the open's own connection that just closed.
    const opened = await valueOf(client.sessions.open({ device: PEER, first: { text: "start" } }))
    expect(opened.receipt).toMatchObject({ lane: "started" })
    expect(dialed).toEqual([
      { endpoint: [], attached: [NEW_KEY], commands: ["prompt"], closed: false },
      { endpoint: ["open_session"], attached: [], commands: [], closed: true },
      { endpoint: ["open_session"], attached: [], commands: [], closed: true },
    ])
  })

  test("#given a person's uid #when the client builds its sender #then it is the CLI's one identity: that uid and this user's name (L1)", () => {
    expect(personIdentity("501")).toEqual({
      sender: { kind: "person", uid: 501, user: userInfo().username },
      caller: "person:501",
    })
  })

  test("#given more keyed opens than the client keeps #when the oldest key is reused #then it opens again while a recent one replays (L2)", async () => {
    const { owner, sent } = await onWorld()
    const client = clientOn(owner.stateDir, fakeClock())
    for (let index = 0; index <= 256; index++)
      await valueOf(client.sessions.open({ device: PEER, idempotency_key: `k-${index}` }))
    expect(sent("open_session")).toHaveLength(257)
    await valueOf(client.sessions.open({ device: PEER, idempotency_key: "k-256" }))
    expect(sent("open_session")).toHaveLength(257)
    await valueOf(client.sessions.open({ device: PEER, idempotency_key: "k-0" }))
    expect(sent("open_session")).toHaveLength(258)
  })

  test("#given a keyed send then a long run of unkeyed sends #when the key is retried #then it replays within the last 256 receipts and reaches the device again past them (L37)", async () => {
    // Every unkeyed send keeps a receipt under a fresh key nobody can retry: the store keeps the newest 256 settled ones.
    const { owner, sent } = await onWorld()
    const client = clientOn(owner.stateDir, fakeClock())
    const keyed = { text: "keep", idempotency_key: "k-keep" }
    await valueOf(client.sessions.send(LIVE, keyed))
    for (let index = 0; index < 255; index++) await valueOf(client.sessions.send(LIVE, { text: `run ${index}` }))
    expect(sent("prompt")).toHaveLength(256)
    await valueOf(client.sessions.send(LIVE, keyed))
    expect(sent("prompt")).toHaveLength(256)
    await valueOf(client.sessions.send(LIVE, { text: "one more" }))
    await valueOf(client.sessions.send(LIVE, keyed))
    expect(sent("prompt")).toHaveLength(258)
  })

  test("#given a slow listing then a command with no final state #when close runs with deadlineMs N #then it settles timeout by N (L3)", async () => {
    const clock = fakeClock()
    const { owner, withheld } = await startModeOwner("ack-no-final", world())
    const listing = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const client = clientOn(owner.stateDir, clock, undefined, {
      connect: async (options) => {
        const svc = await connectDeviceService(options)
        return {
          ...svc,
          sessions: async (filter) => {
            listing.resolve(undefined)
            await release.promise
            return await svc.sessions(filter)
          },
        }
      },
    })
    // Small enough that no local API bound beneath it (they run on the same fake clock) fires while the listing is held.
    const N = 15_000
    const settling = client.sessions.close(LIVE, { deadlineMs: N })
    await listing.promise
    clock.advance(N * 0.6)
    release.resolve(undefined)
    await withheld("final_state")
    clock.advance(N * 0.4)
    // Every timer due by N fired synchronously in advance(); one macrotask lets the settled chain resolve.
    const flushed = new Promise<"pending">((resolve) => setImmediate(() => resolve("pending")))
    expect(await Promise.race([settling.then((outcome) => outcome.kind), flushed])).toBe("error")
    expect(failureOf(await settling)).toMatchObject({ code: "timeout" })
  })
})

describe("an open on this device", () => {
  // The two-device proofs' field failures: the account listing (devices()) leaves out this device, which only
  // thisDevice() names, and the relay cannot route to the device that asks. A session here is served by this device's
  // own operator endpoint (the contract host, which names the session it opens dur-selected).
  const SELF = "dev-self"
  const SELF_SESSION = handleOf(SELF, "dur-selected")
  const selfWorld = world
  // The same world with this device on the account's roster, under the kind and platform the roster reports.
  const listedSelfWorld = (): World => {
    const base = selfWorld()
    const here = {
      device: SELF,
      label: "This Mac",
      kind: "desktop",
      platform: "darwin",
      last_seen_ms: 1_790_000_000_000,
      online: true,
    }
    return { ...base, devices: [here, ...base.devices] }
  }
  const rosters = [
    ["omits this device", selfWorld],
    ["lists this device", listedSelfWorld],
  ] as const

  test("#given a connected service whose device listing omits this device #when devices.list reads #then the self row is not the no-service row", async () => {
    const owner = await startOwner(selfWorld())
    const [self] = await valueOf(clientOn(owner.stateDir, fakeClock()).devices.list())
    // This device's own id and name, online with its service; no kind is invented for it (#13402).
    expect(self).toMatchObject({ id: SELF, self: true, online: true })
    expect(self?.kind).toBeUndefined()
  })

  type Fault = (frame: Record<string, unknown>, socket: Socket) => void
  // This device's operator endpoint (the contract host), over the socket the open watches, with a fault injected after a
  // frame of a given type is written.
  const localClient = async (
    host: ContractHost,
    world: World = selfWorld(),
    fault?: Fault,
    socketOf: () => string = () => host.socket,
    clock: FakeClock = fakeClock(),
  ) => {
    const owner = await startOwner(world)
    const client = clientOn(owner.stateDir, clock, undefined, {
      localSessions: async () =>
        createLocalSessions(async (connect) =>
          createLiveThreadSurface(undefined, {
            env: { OMO_CODING_AGENT_DIR: host.root, SENPI_RPC_SOCKET: socketOf(), SENPI_RPC_KEY_ROOT: host.root },
            statusAll: async () => undefined,
            registry: async () => [],
            connect: (path) => {
              const socket = connect(path)
              if (fault === undefined) return socket
              socket.write = new Proxy(socket.write, {
                apply: (write, self, args: unknown[]) => {
                  const written = Reflect.apply(write, self, args)
                  const [chunk] = args
                  if (typeof chunk === "string")
                    for (const line of chunk.split("\n").filter((text) => text.startsWith("{")))
                      fault(JSON.parse(line) as Record<string, unknown>, socket)
                  return written
                },
              })
              return socket
            },
          }),
        ),
    })
    return { owner, client }
  }
  const opensOn = (host: ContractHost) => host.frames.filter(({ frame }) => frame["type"] === "open_session")

  for (const [roster, worldOf] of rosters)
    test(`#given a connected service whose roster ${roster} #when sessions.open names this device's own id #then it opens on this device's own host, never not_found and never through the relay to itself`, async () => {
      await withContractHost({}, async (host) => {
        const { owner, client } = await localClient(host, worldOf())
        const opened = await valueOf(client.sessions.open({ device: SELF, workspace: host.root, preset: "read-only" }))
        expect(opened.thread).toBe(SELF_SESSION)
        // The device it names is devices.list's own row for this device, as an open elsewhere names that device's row.
        const [self] = await valueOf(client.devices.list())
        expect(opened.device).toEqual(self)
        expect(self).toMatchObject({ id: SELF, self: true })
        expect(owner.state.commands.filter((rpc) => rpc["type"] === "open_session")).toEqual([])
        expect(opensOn(host)).toEqual([
          expect.objectContaining({
            frame: expect.objectContaining({ cwd: host.root, permissionPreset: "read-only" }),
          }),
        ])
      })
    })

  test("#given the open's connection drops after the open_session frame was written #when sessions.open runs #then it is uncertain and the same key does not open twice (#13787 M1)", async () => {
    await withContractHost({}, async (host) => {
      const { client } = await localClient(host, selfWorld(), (frame, socket) => {
        if (frame["type"] === "open_session") socket.destroy()
      })
      const request = { device: SELF, workspace: host.root, idempotency_key: "local-1" }
      const failure = failureOf(await client.sessions.open(request))
      expect(failure).toMatchObject({ code: "unconfirmed", uncertain: true, details: { phase: "send" } })
      expect(failure.next_action).toContain("sessions.list")
      expect(failureOf(await client.sessions.open(request))).toEqual(failure)
      expect(opensOn(host).length).toBeLessThanOrEqual(1)
    })
  })

  test("#given an open answered but its read-back failed #when sessions.open runs #then it is uncertain: a session may exist (#13787 M1)", async () => {
    await withContractHost({}, async (host) => {
      const { client } = await localClient(host, selfWorld(), (frame, socket) => {
        if (frame["type"] === "list_sessions") socket.destroy()
      })
      expect(failureOf(await client.sessions.open({ device: SELF, workspace: host.root }))).toMatchObject({
        code: "unconfirmed",
        uncertain: true,
        details: { phase: "read_back" },
      })
      expect(opensOn(host)).toHaveLength(1)
    })
  })

  test("#given this device's engine refuses the open #when sessions.open runs #then the refusal maps as on the relay leg (#13787 M1)", async () => {
    await withContractHost({}, async (host) => {
      const refusal = "open_failed: model_unavailable: anthropic/nope is not available"
      const { client } = await localClient(host, selfWorld(), (frame, socket) => {
        if (frame["type"] !== "open_session") return
        const reply = { id: frame["id"], type: "response", command: "open_session", success: false, error: refusal }
        socket.emit("data", Buffer.from(`${JSON.stringify(reply)}\n`))
      })
      const failure = failureOf(
        await client.sessions.open({ device: SELF, workspace: host.root, model: "anthropic/nope" }),
      )
      // The same details the relay leg answers (#13787 review L4): the reason code and the model asked for.
      expect(failure).toMatchObject({
        code: "model_not_found",
        details: { device: SELF, reason: "model_unavailable", model: "anthropic/nope" },
      })
      expect(failure.uncertain).toBeUndefined()
    })
  })

  test("#given a worktree open whose connection drops after open_session and whose worktree cannot be removed #when sessions.open runs #then it is uncertain, never a certain failure (#13787 review L5)", async () => {
    const repo = mkdtempSync(join(tmpdir(), "rs-repo-"))
    emptyDirs.push(repo)
    const git = (...args: string[]) => {
      const run = Bun.spawnSync(["git", ...args], {
        cwd: repo,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "t",
          GIT_AUTHOR_EMAIL: "t@t",
          GIT_COMMITTER_NAME: "t",
          GIT_COMMITTER_EMAIL: "t@t",
        },
      })
      if (run.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr.toString()}`)
    }
    git("init", "-q")
    git("commit", "-q", "--allow-empty", "-m", "base")
    // The host takes the open and never answers it, as one whose reply is lost.
    await withContractHost({ silent: ["open_session"] }, async (host) => {
      let worktree = ""
      // The open was written; the worktree is then locked, so the open's cleanup cannot remove it.
      const { client } = await localClient(host, selfWorld(), (frame, socket) => {
        if (frame["type"] !== "open_session") return
        worktree = String(frame["cwd"])
        socket.destroy()
        git("worktree", "lock", worktree)
      })
      const failure = failureOf(
        await client.sessions.open({ device: SELF, workspace: repo, worktree: { branch: "rs-l5" } }),
      )
      expect(failure).toMatchObject({ code: "unconfirmed", uncertain: true })
      git("worktree", "unlock", worktree)
      git("worktree", "remove", "--force", worktree)
    })
  })

  test("#given no operator endpoint answers on this device #when sessions.open runs #then host_unavailable, certain, and the key stays free (#13787 L1)", async () => {
    await withContractHost({}, async (host) => {
      // The endpoint is missing for the first open, then up: the retry under the same key reaches it.
      let socket = join(host.root, "absent.sock")
      const { client } = await localClient(host, selfWorld(), undefined, () => socket)
      const request = { device: SELF, workspace: host.root, idempotency_key: "local-2" }
      const failure = failureOf(await client.sessions.open(request))
      expect(failure).toMatchObject({ code: "host_unavailable", details: { device: SELF } })
      expect(failure.uncertain).toBeUndefined()
      expect(opensOn(host)).toEqual([])
      socket = host.socket
      expect((await valueOf(client.sessions.open(request))).thread).toBe(SELF_SESSION)
      expect(opensOn(host)).toHaveLength(1)
    })
  })

  test("#given a session opened on this device #when send, get, read, interrupt, setReasoning and close address it #then each runs on this device's own host and the relay is never asked (#13787)", async () => {
    await withContractHost({ auth: true }, async (host) => {
      const { owner, client } = await localClient(host)
      expect((await valueOf(client.sessions.open({ device: SELF, workspace: host.root }))).thread).toBe(SELF_SESSION)
      const receipt = await valueOf(client.sessions.send(SELF_SESSION, { text: "hello here" }))
      expect(receipt).toMatchObject({
        thread: SELF_SESSION,
        device: { id: SELF, self: true },
        lane: "queued",
      })
      expect(await valueOf(client.sessions.get(SELF_SESSION))).toMatchObject({
        thread: SELF_SESSION,
        device: { id: SELF },
        state: "idle",
        source: "live",
      })
      expect(await valueOf(client.sessions.read(SELF_SESSION))).toEqual({ entries: [], next_before: null })
      expect(await valueOf(client.sessions.interrupt(SELF_SESSION))).toMatchObject({
        interrupted: true,
        background: { status: "not_supported" },
        device: SELF,
      })
      expect(await valueOf(client.sessions.setReasoning(SELF_SESSION, "high"))).toEqual({ reasoning: "high" })
      expect(await valueOf(client.sessions.close(SELF_SESSION))).toEqual({ closed: true, dropped_deliveries: [] })
      expect(host.mutations.map((frame) => frame["type"])).toEqual([
        "prompt",
        "interrupt",
        "set_thinking_level",
        "unload_session",
      ])
      expect(host.mutations[0]).toMatchObject({ message: "hello here", streamingBehavior: "followUp" })
      expect(typeof host.mutations[0]?.["clientMessageId"]).toBe("string")
      expect(host.mutations[0]?.["clientMessageId"]).toBe(receipt.delivery_id)
      expect(owner.state.commands).toEqual([])
    })
  })

  test("#given a session on this device #when setModel addresses it, or a session client sends to it #then each is refused, typed, before anything runs (#13787)", async () => {
    await withContractHost({}, async (host) => {
      const { owner, client } = await localClient(host)
      expect(failureOf(await client.sessions.setModel(SELF_SESSION, "p/m"))).toMatchObject({
        code: "unsupported",
        details: { feature: "session_model_on_this_device" },
      })
      const session = clientOn(owner.stateDir, fakeClock(), { kind: "session", id: "dur-caller" })
      expect(failureOf(await session.sessions.send(SELF_SESSION, { text: "x" })).code).toBe("local_only")
      expect(host.mutations).toEqual([])
      expect(owner.state.commands).toEqual([])
    })
  })

  // #13787 review LOWs on the local leg.
  const fakeReply = (socket: Socket, frame: Record<string, unknown>, reply: Record<string, unknown>) =>
    socket.emit(
      "data",
      Buffer.from(`${JSON.stringify({ id: frame["id"], type: "response", command: frame["type"], ...reply })}\n`),
    )

  test("#given this device's engine refuses a read of the session #when get reads it #then not_found{session}, not an unreachable host (L2)", async () => {
    await withContractHost({ silent: ["get_state"] }, async (host) => {
      const { client } = await localClient(host, selfWorld(), (frame, socket) => {
        if (frame["type"] === "get_state") fakeReply(socket, frame, { success: false, error: "unknown_session" })
      })
      expect(failureOf(await client.sessions.get(SELF_SESSION))).toMatchObject({
        code: "not_found",
        details: { kind: "session", device: SELF },
      })
    })
  })

  test("#given a prompt this device's engine took #when the queue read after it fails #then the send is queued, not uncertain (L3)", async () => {
    await withContractHost({ silent: ["get_state"] }, async (host) => {
      // The host never answers get_state itself: the first read finds the session idle, the one after the prompt fails.
      let reads = 0
      const { client } = await localClient(host, selfWorld(), (frame, socket) => {
        if (frame["type"] !== "get_state") return
        reads += 1
        fakeReply(
          socket,
          frame,
          reads === 1 ? { success: true, data: { isStreaming: false } } : { success: false, error: "busy" },
        )
      })
      expect(await valueOf(client.sessions.send(SELF_SESSION, { text: "q" }))).toMatchObject({
        lane: "queued",
        queue_position: 1,
      })
    })
  })

  test("#given a running turn #when a person steers a session on this device #then the prompt names that turn (L4)", async () => {
    // The host never answers get_state itself: the running turn is the reply put on the socket.
    await withContractHost({ silent: ["get_state"] }, async (host) => {
      const { client } = await localClient(host, selfWorld(), (frame, socket) => {
        if (frame["type"] === "get_state")
          fakeReply(socket, frame, { success: true, data: { isStreaming: true, currentTurnId: "5" } })
      })
      expect(await valueOf(client.sessions.send(SELF_SESSION, { text: "s", mode: "steer" }))).toMatchObject({
        lane: "steered",
        turn_id: "5",
      })
      expect(host.mutations).toEqual([expect.objectContaining({ type: "prompt", expectedTurnId: "5" })])
    })
  })

  test("#given a session client #when it opens on its own device with a first prompt #then local_only before anything is opened (L5)", async () => {
    await withContractHost({}, async (host) => {
      const { owner } = await localClient(host)
      const session = clientOn(owner.stateDir, fakeClock(), { kind: "session", id: "dur-caller" })
      expect(
        failureOf(await session.sessions.open({ device: SELF, workspace: host.root, first: { text: "go" } })).code,
      ).toBe("local_only")
      expect(opensOn(host)).toEqual([])
    })
  })

  test("#given a person's send on this device under an idempotency key #when it is repeated #then it replays, and other text under it conflicts (L6)", async () => {
    await withContractHost({}, async (host) => {
      const { client } = await localClient(host)
      const first = await valueOf(client.sessions.send(SELF_SESSION, { text: "once", idempotency_key: "lk-1" }))
      expect(await valueOf(client.sessions.send(SELF_SESSION, { text: "once", idempotency_key: "lk-1" }))).toEqual(
        first,
      )
      expect(failureOf(await client.sessions.send(SELF_SESSION, { text: "twice", idempotency_key: "lk-1" })).code).toBe(
        "idempotency_conflict",
      )
      expect(host.mutations.filter((frame) => frame["type"] === "prompt")).toHaveLength(1)
    })
  })

  for (const [roster, worldOf] of rosters)
    test(`#given a roster that ${roster} #when sessions.list reads the whole account #then each row's device is devices.list's row for that id, this device's own sessions as another device's`, async () => {
      await withContractHost({}, async (host) => {
        const { client } = await localClient(host, worldOf())
        const devices = new Map((await valueOf(client.devices.list())).map((row) => [row.id, row]))
        const { rows } = await valueOf(client.sessions.list())
        const here = rows.filter((row) => row.device.id === SELF)
        const there = rows.filter((row) => row.device.id === PEER)
        expect(here.length).toBeGreaterThan(0)
        expect(there.length).toBeGreaterThan(0)
        for (const row of rows) expect(devices.get(row.device.id)).toEqual(row.device)
        // The same row fields on both legs: a remote row its device publishes a durable id for, and a local one.
        const remote = there.find((row) => row.durable_id !== undefined)
        expect(Object.keys(here[0] ?? {}).sort()).toEqual(Object.keys(remote ?? {}).sort())
      })
    })

  test("#given a session this device's host holds #when sessions.list reads this device #then the local host's session is listed, the relay's listing aside", async () => {
    await withContractHost({}, async (host) => {
      const { client } = await localClient(host)
      const mine = await valueOf(client.sessions.list({ device: SELF }))
      expect(mine.rows).toEqual([
        expect.objectContaining({
          thread: SELF_SESSION,
          durable_id: "dur-selected",
          name: "target",
          device: expect.objectContaining({ id: SELF, self: true }),
          project: host.root,
          source: "live",
        }),
      ])
      // The whole account lists it beside the other devices' rows.
      const all = await valueOf(client.sessions.list())
      expect(all.rows.map((row) => String(row.thread))).toContain(String(SELF_SESSION))
      expect(all.rows.map((row) => row.device.id)).toContain(PEER)
    })
  })

  test("#given a client built without this device's operator endpoint #when sessions.list reads the whole account and members address a session here #then this device is unanswered, never dropped, and each member answers unsupported{local_sessions} with nothing sent to its host", async () => {
    await withContractHost({}, async (host) => {
      const { owner } = await localClient(host)
      const client = clientOn(owner.stateDir, fakeClock(), undefined, { localSessions: undefined })
      const listing = await valueOf(client.sessions.list())
      expect(listing.rows.map((row) => row.device.id)).toContain(PEER)
      expect(listing.rows.filter((row) => row.device.id === SELF)).toEqual([])
      expect(listing.unanswered).toContainEqual(expect.objectContaining({ id: SELF, self: true }))
      const absent = { code: "unsupported", details: { feature: "local_sessions", device: SELF } }
      expect(failureOf(await client.sessions.open({ device: SELF, workspace: host.root }))).toMatchObject(absent)
      expect(failureOf(await client.sessions.send(SELF_SESSION, { text: "q" }))).toMatchObject(absent)
      expect(failureOf(await client.sessions.close(SELF_SESSION))).toMatchObject(absent)
      expect(host.frames).toEqual([])
    })
  })

  test("#given this device's host takes list_sessions and never answers it #when sessions.list reads the whole account #then the other devices' rows come back before the listing's deadline and this device is unanswered (#13787 review L1)", async () => {
    await withContractHost({ silent: ["list_sessions"] }, async (host) => {
      const clock = fakeClock()
      let asked = (): void => {}
      const listAsked = new Promise<void>((resolve) => {
        asked = resolve
      })
      const { client } = await localClient(
        host,
        selfWorld(),
        (frame) => {
          if (frame["type"] === "list_sessions") asked()
        },
        undefined,
        clock,
      )
      const settling = client.sessions.list()
      await within(listAsked, "this device's list_sessions")
      const pending = () => new Promise<"pending">((resolve) => setImmediate(() => resolve("pending")))
      // Just short of this device's own bound the listing still waits; at the bound it answers, well inside the
      // listing's own deadline (#13787 review L3: the clamp alone would only fire at sessionsList - 1).
      // The bound is the same 10 s the thread tools give one endpoint's list (a default contract), so it is pinned here.
      const localListBoundMs = 10_000
      expect(localListBoundMs).toBeLessThan(DEADLINES.sessionsList)
      clock.advance(localListBoundMs - 1)
      expect(await Promise.race([settling.then((outcome) => outcome.kind), pending()])).toBe("pending")
      clock.advance(1)
      expect(await Promise.race([settling.then((outcome) => outcome.kind), pending()])).toBe("ok")
      const listing = await valueOf(settling)
      expect(listing.rows.map((row) => row.device.id)).toContain(PEER)
      expect(listing.rows.filter((row) => row.device.id === SELF)).toEqual([])
      expect(listing.unanswered).toContainEqual(expect.objectContaining({ id: SELF, self: true }))
    })
  })

  test("#given a keyed send on this device still in flight #when more than 256 other keyed sends settle #then its retry joins it instead of sending again, and the oldest settled key is the one forgotten (#13787 review L2)", async () => {
    // This device's host, controllable: the prompt "held" is answered only when the test releases it.
    const prompts: string[] = []
    let release = (): void => {}
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    let heldAsked = (): void => {}
    const heldPrompted = new Promise<void>((resolve) => {
      heldAsked = resolve
    })
    const session: ThreadHostSession = {
      sessionId: "rpc-1",
      durableSessionId: "dur-selected",
      cwd: "/w",
      name: "target",
    }
    const unused = async (): Promise<never> => {
      throw new Error("not used by a send")
    }
    const fakeHost: ThreadHost = {
      socket: "fake.sock",
      listSessions: async () => [session],
      openSession: unused,
      getMessages: unused,
      getState: async () => ({ isStreaming: false }),
      prompt: async (_routing, message) => {
        prompts.push(message)
        if (message === "held") {
          heldAsked()
          await released
        }
        return { turnId: String(prompts.length) }
      },
      interrupt: unused,
      setSessionName: unused,
      setModel: unused,
      getAvailableModels: unused,
      setThinkingLevel: unused,
      getAvailableThinkingLevels: unused,
    }
    const owner = await startOwner(selfWorld())
    const client = clientOn(owner.stateDir, fakeClock(), undefined, {
      localSessions: async () => createLocalSessions(async () => fakeHost),
    })
    const held = { text: "held", idempotency_key: "held" }
    const first = client.sessions.send(SELF_SESSION, held)
    await within(heldPrompted, "the held prompt")
    for (let index = 0; index < 256; index++)
      await valueOf(client.sessions.send(SELF_SESSION, { text: `t-${index}`, idempotency_key: `k-${index}` }))
    const retry = client.sessions.send(SELF_SESSION, held)
    release()
    expect(await valueOf(retry)).toEqual(await valueOf(first))
    expect(prompts.filter((text) => text === "held")).toHaveLength(1)
    // The store stays bounded: the oldest settled key was dropped in the in-flight one's place, a newer one replays.
    await valueOf(client.sessions.send(SELF_SESSION, { text: "t-255", idempotency_key: "k-255" }))
    expect(prompts.filter((text) => text === "t-255")).toHaveLength(1)
    await valueOf(client.sessions.send(SELF_SESSION, { text: "t-0", idempotency_key: "k-0" }))
    expect(prompts.filter((text) => text === "t-0")).toHaveLength(2)
  })

  test("#given a handle this device's host does not hold #when close addresses it #then not_found{session}", async () => {
    await withContractHost({}, async (host) => {
      const { client } = await localClient(host)
      expect(failureOf(await client.sessions.close(handleOf(SELF, "dur-nowhere")))).toMatchObject({
        code: "not_found",
        details: { kind: "session", device: SELF },
      })
      expect(host.mutations).toEqual([])
    })
  })
})
