import { afterEach, describe, expect, test } from "bun:test"
import { connectDeviceService } from "@oh-my-opencode/device-service-core/device-service"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir, userInfo } from "node:os"
import { join } from "node:path"
import type { JsonObject, ListingRow } from "../../../../device-service-core/src/local-api/protocol.ts"
import {
  defaultWorld,
  PEER,
  SESSION_ID,
  type World,
} from "../../../../device-service-core/test/local-api/conformance/world.ts"
import { withContractHost } from "../../../../senpi-task/src/runners/rpc-host/testing/contract-host"
import { createLiveThreadSurface } from "../thread/live-surface"
import { canonicalizeThreadHandle, handleOf } from "./seams"
import { personIdentity, resolveSessionTarget } from "./sessions"
import { clientOn, closeClients, failureOf, fakeClock, startModeOwner, startOwner } from "./testing/fake-service"
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

  test("#given no layer stores archive state #when sessions.archive runs #then unsupported{archive}", async () => {
    const { owner } = await onWorld()
    expect(failureOf(await clientOn(owner.stateDir, fakeClock()).sessions.archive(LIVE, true))).toMatchObject({
      code: "unsupported",
      details: { feature: "archive" },
    })
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
      expect(await valueOf(client.sessions.close(thread))).toEqual({ closed: true })
      for (const type of ["prompt", "set_model", "interrupt", "unload_session"])
        expect(sent(type).map((rpc) => rpc["sessionId"])).toEqual([NEW_KEY])
    })

  test("#given a session its device does not hold #when a member addresses it #then not_found{session} names sessions.list, never an update", async () => {
    const { client } = await opened()
    for (const settled of [
      await client.sessions.interrupt(handleOf(PEER, "dur-nowhere")),
      await client.sessions.setModel(handleOf(PEER, "dur-nowhere"), "anthropic/claude"),
      await client.sessions.get(handleOf(PEER, "dur-nowhere")),
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
      member: () => Promise.reject(new Error("the listing alone resolves a listed durable id")),
      sessionsList: client.sessions.list,
      devicesList: client.devices.list,
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

  test("#given a slow listing then a command with no final state #when close runs with deadlineMs N #then it settles timeout by N (L3)", async () => {
    const clock = fakeClock()
    const { owner, withheld } = await startModeOwner("ack-no-final", world())
    const listing = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const client = clientOn(owner.stateDir, clock, undefined, {
      connect: async (options) => {
        const svc = await connectDeviceService(options)
        return {
          ...svc,
          sessions: async (filter) => {
            listing.resolve()
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
    release.resolve()
    await withheld("final_state")
    clock.advance(N * 0.4)
    // Every timer due by N fired synchronously in advance(); one macrotask lets the settled chain resolve.
    const flushed = new Promise<"pending">((resolve) => setImmediate(() => resolve("pending")))
    expect(await Promise.race([settling.then((outcome) => outcome.kind), flushed])).toBe("error")
    expect(failureOf(await settling)).toMatchObject({ code: "timeout" })
  })
})

describe("an open on this device", () => {
  // The two-device proof's field failure: the account listing (devices()) leaves out this device, which only
  // thisDevice() names; a connected service must still open here through the relay host, never local_only.
  const SELF = "dev-self"
  const selfWorld = (): World => {
    const base = world()
    const live = base.sessions[0]
    if (live === undefined) throw new Error("the world holds a live session")
    return {
      ...base,
      endpoints: { ...base.endpoints, [SELF]: ["ZW5kcG9pbnQta2V5LTAwMD"] },
      // The contract host names the session it opens dur-selected.
      located: { ...base.located, [SELF]: { "dur-selected": NEW_KEY } },
      sessions: [...base.sessions, { ...live, device: SELF, session_id: NEW_KEY }],
    }
  }

  test("#given a connected service whose device listing omits this device #when devices.list reads #then the self row is not the no-service row", async () => {
    const owner = await startOwner(selfWorld())
    const [self] = await valueOf(clientOn(owner.stateDir, fakeClock()).devices.list())
    expect(self).toMatchObject({ id: SELF, self: true, kind: "cli" })
  })

  test("#given a connected service #when sessions.open names this device #then it opens on this device's own host, never through the relay to itself", async () => {
    await withContractHost({}, async (host) => {
      const owner = await startOwner(selfWorld())
      const client = clientOn(owner.stateDir, fakeClock(), undefined, {
        localThreadHost: async () =>
          createLiveThreadSurface(undefined, {
            env: { OMO_CODING_AGENT_DIR: host.root, SENPI_RPC_SOCKET: host.socket, SENPI_RPC_KEY_ROOT: host.root },
            statusAll: async () => undefined,
            registry: async () => [],
          }),
      })
      const opened = await valueOf(client.sessions.open({ device: SELF, workspace: host.root, preset: "read-only" }))
      expect(opened.thread).toBe(handleOf(SELF, NEW_KEY))
      expect(opened.device).toMatchObject({ id: SELF, self: true })
      expect(owner.state.commands.filter((rpc) => rpc["type"] === "open_session")).toEqual([])
      expect(host.frames.filter(({ frame }) => frame["type"] === "open_session")).toEqual([
        expect.objectContaining({ frame: expect.objectContaining({ cwd: host.root, permissionPreset: "read-only" }) }),
      ])
    })
  })
})
