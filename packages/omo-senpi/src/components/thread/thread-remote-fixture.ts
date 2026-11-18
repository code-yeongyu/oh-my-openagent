import { mock } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { DeviceRow, RemoteClient, RemoteFailure, ServiceStatus } from "../remote"
import type { ThreadToolName, ThreadToolResult } from "./contracts"
import { createGatewayStore, type GatewayStore } from "./gateway/store"
import type {
  AliasHolder,
  AliasRegistry,
  AliasResult,
  JsonObject,
  RemoteCommandOutcome,
  RemoteDevice,
  RemoteSessionRow,
  RemoteThreadSurface,
  RemoteWatchEnd,
  RemoteWatchHandlers,
} from "./remote/ports"
import type { ThreadTranscriptEntry } from "./reader"
import { answerGetEntries, senpiProjector, type FakeEntryLog } from "./thread-remote-entries-fixture"
import { createThreadTools, type ThreadHost, type ThreadHostSession } from "./tools"
import type { ThreadCloseOutcome } from "./tools/ports"
import type { SessionWatchHandlers } from "./control/wait-settled"

// The listing key (what b's connector assigned) deliberately differs from the durable id (audit class C8, #13017): a test
// that passes with either id proves nothing about which one a tool path matched.
export const B_ROW: RemoteSessionRow = {
  device: "b",
  session_id: "rk-on-b",
  durable_id: "dur-on-b",
  title: "on b",
  project: "/work/b",
  path: "/home/b/.omo/agent/sessions/dur-on-b.jsonl",
  state: "idle",
  updated_ms: 1_700_000_000_000,
}

type Sent = {
  readonly via: "endpoint" | "session" | "read" | "watch" | "wake"
  readonly device: string
  readonly session?: string
  readonly rpc?: JsonObject
}

type Engine = {
  readonly messages: readonly ThreadTranscriptEntry[]
  readonly interrupt: JsonObject
  readonly streaming: boolean
  readonly pending: number
  readonly currentTurnId?: string
  readonly turnEpoch?: string
  readonly pendingQuestions?: readonly JsonObject[]
  readonly pendingDialogs?: readonly JsonObject[]
}

export const ENGINE: Engine = {
  messages: Array.from({ length: 30 }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: `message ${index} ${"x".repeat(60)}`,
  })),
  interrupt: { interrupted: false },
  streaming: false,
  pending: 0,
}

/** The levels both legs' engines run in these tests; `xhigh` is refused on both. */
const THINKING_LEVELS: readonly string[] = ["off", "low", "high"]

const unsupported = (member: string): RemoteFailure => ({
  kind: "error",
  code: "unsupported",
  message: `The fake remote client has no ${member}.`,
  next_action: "Fake it in the test that calls it.",
})

/**
 * The remote client of a fake account: its device service state and devices, this device on the self row. `fail` makes
 * every account read settle with that failure (a device service that cannot answer).
 */
export function fakeRemoteClient(account: {
  readonly state: () => string
  readonly here: string | null
  readonly devices: () => readonly RemoteDevice[]
  readonly fail?: RemoteFailure
  /** Only the device list fails with this (the service state still answers). */
  readonly devicesFail?: RemoteFailure
  /** Each account read, by member name, in call order. */
  readonly reads?: string[]
}): RemoteClient {
  const row = (device: RemoteDevice): DeviceRow => ({
    id: device.device,
    name: device.label,
    kind: "device",
    platform: "linux",
    online: device.online,
    last_seen_ms: null,
    ...(device.device === account.here ? { self: true as const } : {}),
    caps: { attach: true, machine: false, control: false },
  })
  const none =
    (member: string) =>
    async (..._args: unknown[]): Promise<RemoteFailure> =>
      unsupported(member)
  return {
    service: {
      info: none("service.info"),
      status: async () => {
        account.reads?.push("service.status")
        if (account.fail !== undefined) return account.fail
        const state = account.state() as ServiceStatus["state"]
        const device = account.here === null ? null : { id: account.here, name: account.here }
        return {
          kind: "ok",
          value: { state, since_ms: 0, device, origin_configured: true, enabled: true, service_version: "test" },
        }
      },
      setEnabled: none("service.setEnabled"),
      control: none("service.control"),
      setControl: none("service.setControl"),
      bootstrap: none("service.bootstrap"),
      wake: none("service.wake"),
      setWake: none("service.setWake"),
    },
    devices: {
      list: async () => {
        account.reads?.push("devices.list")
        return account.fail ?? account.devicesFail ?? { kind: "ok", value: account.devices().map(row) }
      },
      resolve: none("devices.resolve"),
    },
    sessions: {
      list: none("sessions.list"),
      resolve: none("sessions.resolve"),
      get: none("sessions.get"),
      open: none("sessions.open"),
      send: none("sessions.send"),
      read: none("sessions.read"),
      follow: () => ({
        [Symbol.asyncIterator]: async function* () {
          yield { kind: "failed" as const, failure: unsupported("sessions.follow") }
        },
        stop: () => {},
      }),
      wait: none("sessions.wait"),
      interrupt: none("sessions.interrupt"),
      setModel: none("sessions.setModel"),
      setReasoning: none("sessions.setReasoning"),
      close: none("sessions.close"),
      archive: none("sessions.archive"),
    },
    attach: none("attach"),
    aliases: { resolve: none("aliases.resolve"), set: none("aliases.set"), clear: none("aliases.clear") },
    close: () => {},
  }
}

export const comparable = (result: ThreadToolResult): unknown => {
  const { thread: _thread, link: _link, device: _device, ...rest } = result as Record<string, unknown>
  return rest
}

/**
 * A record the prompt's run writes, as senpi streams it: the prompt's own user message (`message_start`/`message_end`)
 * carries the client message id the prompt named, when it named one and the record names none.
 */
export const stampPromptRecord = (record: JsonObject, clientMessageId: unknown): JsonObject => {
  const message = record["message"]
  if (
    typeof clientMessageId !== "string" ||
    (record["type"] !== "message_start" && record["type"] !== "message_end") ||
    typeof message !== "object" ||
    message === null ||
    Array.isArray(message) ||
    (message as JsonObject)["role"] !== "user" ||
    "clientMessageId" in message
  )
    return record
  return { ...record, message: { ...(message as JsonObject), clientMessageId } }
}

export function createRemoteThreadFixture() {
  const directories: string[] = []
  const stores: GatewayStore[] = []
  const cleanup = async () => {
    await Promise.all(stores.splice(0).map((store) => store.dispose()))
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
  }

  function account(
    options: {
      plan?: string
      online?: boolean
      refuse?: string
      aliases?: Map<string, AliasHolder>
      noRegistry?: boolean
      engine?: Engine
      promptResponse?: JsonObject
      promptOutcome?: RemoteCommandOutcome
      admitRefuse?: string
      admitOutcome?: RemoteCommandOutcome
      heldDraft?: number
      openData?: JsonObject
      failSessionsList?: boolean
      failAliasesOf?: boolean
      failClaim?: boolean
      otherHolders?: number
      unwritten?: boolean
      unloadReason?: string
      terminal?: boolean
      rowState?: string
      live?: readonly string[]
      records?: readonly JsonObject[]
      /** Entries the session stores once its turn ran (a queued send is stored when the queue drains): served on reads after the turn's records went out. */
      entriesAfterAnswer?: readonly JsonObject[]
      /** The turn finishes before its prompt's reply reaches the sender: its records go out at once, before the aim. */
      recordsBeforeReply?: boolean
      rows?: readonly RemoteSessionRow[]
      /** b's session entries, which its engine pages through `get_entries` (#14047); absent: an engine that pages nothing. */
      entries?: FakeEntryLog
      /** Devices the account listing names as not answering this round. */
      incomplete?: readonly string[]
      /** Extra devices the account lists beyond this one and b. */
      devices?: readonly RemoteDevice[]
      /** The roster as relayd answers it: without this device (its row then comes from thisDeviceName). */
      rosterWithoutSelf?: boolean
      registryDown?: "refused" | "throws" | "signed_out"
      /** Only the claim fails (resolve and aliasesOf still answer): a token that expired between the two calls. */
      claimDown?: "refused" | "signed_out"
      chainCountLimit?: number
      relayKeys?: ReadonlyMap<string, string>
      /** omo#13037: sessions a device holds on disk but runs nowhere, by device then durable id, with that device's key. */
      ended?: Readonly<Record<string, Readonly<Record<string, string>>>>
      /** omo#13037: devices whose single-probe lookup gets no answer within the bound. */
      silent?: readonly string[]
      /** omo#13037: this device's service carries the wake mark and the single probe (both gates open). Off by default, as shipped. */
      wakeFeature?: boolean
      /** omo#13037: this device's service makes no single probe (the lookup is never made). */
      noLookup?: boolean
      /** omo#13037 review: a sessions port as before the lookup existed (no lookup, no capability read). */
      withoutLookup?: boolean
      /** omo#13037 review: the account's device list cannot be read. */
      devicesFail?: boolean
      /** This device's own id read (device.info): it fails, or the service answers without an id. */
      selfDevice?: "throws" | "unknown"
      /** omo#13037: this device's service cannot carry the wake target (no wake is sent; today's path). */
      noWake?: boolean
      /** omo#13037: the wake path's answer; default the consumer's queued envelope with `waiting_on: {kind: "wake"}`. */
      wakeOutcome?: RemoteCommandOutcome
      /** The `get_state` fields a live session reports beyond the engine defaults (`paused`, `holds`). */
      liveState?: JsonObject
      /** b's engine refuses every open_session with this error text (senpi names an unresolvable model `model_unavailable: ...`). */
      openRefuse?: string
      /** b knows a session it just opened only by its relay key (relayKeys), not by its durable id: a listing that has not caught up yet. */
      relayKeyOnly?: boolean
      /** The device service throws on b's admit_external_message (a lost connection mid-delivery). */
      admitThrows?: string
      /** Every get_state after b admitted a delivery is refused with this reason (the read after the admission fails). */
      stateRefusedAfterAdmit?: string
    } = {},
  ) {
    const engine = options.engine ?? ENGINE
    const sent: Sent[] = []
    // b's engine ledger of admitted delivery ids (senpi external-admission: a repeated id is already_admitted), and how many
    // admissions its user's open draft still holds (held_draft, taken by nothing).
    const admitted = new Set<string>()
    let heldDraft = options.heldDraft ?? 0
    // The session's records a prompt makes it write, held until the follower first reads after the answer: the
    // engine's turn records follow its reply out over the wire, and the CLI's read is the first observable hop after
    // its own bookkeeping for that reply.
    const watchers = new Set<RemoteWatchHandlers>()
    const ends = new Set<(end: RemoteWatchEnd) => void>()
    // Settles when the first watch opens, so a test triggers a status change only once something is watching.
    let watchStarted: () => void = () => {}
    const watching = new Promise<void>((resolve) => {
      watchStarted = resolve
    })
    let answeredPrompt = false
    let recordsOut = false
    // The client message id the answered prompt named: senpi stamps the prompt's own user message with it.
    let promptClientMessageId: unknown
    const writeRecords = () => {
      if (recordsOut) return
      recordsOut = true
      for (const record of options.records ?? [])
        for (const handlers of [...watchers]) handlers.record(stampPromptRecord(record, promptClientMessageId))
    }
    const hops: number[] = []
    const lookups: Array<{ readonly device: string; readonly durable_id: string }> = []
    const deviceReads = { thisDevice: 0, devices: 0 }
    // Account listing reads: `all` asks every device (one round across the account), `device` asks one device.
    const listings = { all: 0, device: 0 }
    const aliases = options.aliases ?? new Map<string, AliasHolder>()
    // The sessions b's engine holds. Its close rules are senpi's (2026.11.5-1): close_session from a connection that never
    // attached is refused unknown_session (senpi#1782); an attached close releases only that hold, so the session ends
    // only with no other holder; unload_session with force drains every hold, and refuses a session with no file yet.
    // b's engine knows its sessions by the listing key; rows a test builds with the durable id as key (titled(), the remote verbs' typed id) are live too.
    const live = new Set(
      options.live ?? [B_ROW.session_id, ...(B_ROW.durable_id === undefined ? [] : [B_ROW.durable_id])],
    )
    const answer = (rpc: JsonObject, attachedTo?: string): RemoteCommandOutcome => {
      // The engine's real reply envelope, as the device service hands it back (device-service-core's CommandResult.response):
      // every field the tools read lives under `data`.
      const ok = (data: JsonObject): RemoteCommandOutcome => ({
        kind: "ok",
        response: { type: "response", id: null, command: rpc["type"] ?? null, success: true, data },
      })
      if (options.refuse !== undefined) return { kind: "refused", reason: options.refuse }
      if (attachedTo !== undefined && !live.has(attachedTo)) return { kind: "refused", reason: "unknown_session" }
      // A terminal's engine takes no session lifecycle record (live-surface.ts `unsupported:` on this device): it answers the
      // failed envelope the device service reports as this refusal.
      if (options.terminal === true && (rpc["type"] === "close_session" || rpc["type"] === "unload_session"))
        return { kind: "refused", reason: "unsupported" }
      if (rpc["type"] === "close_session") {
        if (attachedTo === undefined) return { kind: "refused", reason: "unknown_session" }
        if ((options.otherHolders ?? 0) === 0) live.delete(attachedTo)
        return ok({})
      }
      if (rpc["type"] === "unload_session" && attachedTo !== undefined) {
        if (options.unloadReason !== undefined)
          return ok({ outcome: "refused", reason: options.unloadReason, detail: `refused: ${options.unloadReason}` })
        if (options.unwritten === true)
          return ok({ outcome: "refused", reason: "unsupported", detail: "the session has no file to reopen it by" })
        if ((options.otherHolders ?? 0) > 0 && rpc["force"] !== true)
          return ok({ outcome: "refused", reason: "attached", detail: "1 other client(s) attached" })
        live.delete(attachedTo)
        return ok({ outcome: "unloaded", sessionPath: B_ROW.path })
      }
      if (rpc["type"] === "open_session" && options.openRefuse !== undefined)
        return { kind: "refused", reason: options.openRefuse }
      if (rpc["type"] === "open_session") {
        const opened = rpc["sessionPath"] === undefined ? "dur-new-on-b" : "dur-on-b"
        const key = options.relayKeys?.get(opened) ?? opened
        for (const id of options.relayKeyOnly === true ? [key] : [opened, key]) live.add(id)
        return ok(options.openData ?? { sessionId: "rpc-9", state: { durableSessionId: opened } })
      }
      if (rpc["type"] === "get_state" && options.stateRefusedAfterAdmit !== undefined && admitted.size > 0)
        return { kind: "refused", reason: options.stateRefusedAfterAdmit }
      if (rpc["type"] === "get_state")
        return ok({
          isStreaming: engine.streaming,
          pendingMessageCount: engine.pending,
          ...(engine.currentTurnId === undefined ? {} : { currentTurnId: engine.currentTurnId }),
          ...(engine.pendingQuestions === undefined ? {} : { pendingQuestions: [...engine.pendingQuestions] }),
          ...(engine.pendingDialogs === undefined ? {} : { pendingDialogs: [...engine.pendingDialogs] }),
          ...options.liveState,
        })
      if (rpc["type"] === "get_messages") return ok({ messages: [...engine.messages] })
      if (rpc["type"] === "get_entries") {
        if (options.entries === undefined) return { kind: "refused", reason: "unsupported" }
        const paged = answerGetEntries(options.entries, rpc)
        return "refused" in paged ? { kind: "refused", reason: paged.refused } : ok(paged.data)
      }
      if (rpc["type"] === "interrupt") return ok(engine.interrupt)
      // b's user set `threads.chainCountLimit` (senpi S32): its engine answers `{success: false, errorCode: "chain_count_limit"}`,
      // which the device service hands back as this refusal (device-service.ts).
      if (
        rpc["type"] === "prompt" &&
        options.chainCountLimit !== undefined &&
        Number(rpc["chainCount"]) > options.chainCountLimit
      )
        return { kind: "refused", reason: "chain_count_limit" }
      if (rpc["type"] === "prompt" && options.promptOutcome !== undefined) return options.promptOutcome
      if (rpc["type"] === "prompt")
        return ok(
          options.promptResponse ??
            (engine.streaming ? { disposition: "queued" } : { disposition: "started", turnId: "turn-b" }),
        )
      if (rpc["type"] === "admit_external_message") {
        if (options.admitRefuse !== undefined) return { kind: "refused", reason: options.admitRefuse }
        if (options.admitOutcome !== undefined) return options.admitOutcome
        if (options.chainCountLimit !== undefined && Number(rpc["chainCount"]) > options.chainCountLimit)
          return { kind: "refused", reason: "chain_count_limit" }
        const epoch = engine.turnEpoch ?? engine.currentTurnId ?? "turn-b"
        const id = String(rpc["deliveryId"])
        if (admitted.has(id)) return ok({ kind: "already_admitted", turnId: epoch })
        if (heldDraft > 0) {
          heldDraft -= 1
          return ok({ kind: "held_draft", turnId: epoch })
        }
        if (rpc["deliverAs"] === "steer") {
          if (!engine.streaming || rpc["expectedTurnId"] !== engine.currentTurnId)
            return ok({ kind: "turn_conflict", turnId: epoch })
          admitted.add(id)
          return ok({ kind: "steered", turnId: epoch })
        }
        admitted.add(id)
        return ok(engine.streaming ? { kind: "queued", turnId: epoch } : { kind: "started", turnId: epoch })
      }
      if (rpc["type"] === "get_available_models")
        return ok({
          models: [
            { provider: "anthropic", id: "claude-opus", name: "Opus" },
            { provider: "openai", id: "gpt-6" },
          ],
        })
      if (rpc["type"] === "set_model") return ok({ provider: rpc["provider"] ?? null, id: rpc["modelId"] ?? null })
      if (rpc["type"] === "get_available_thinking_levels") return ok({ levels: [...THINKING_LEVELS] })
      // The engine refuses a level the active model cannot run with its text as the error (device-service.ts: errorCode, else error).
      if (rpc["type"] === "set_thinking_level")
        return THINKING_LEVELS.includes(String(rpc["level"]))
          ? ok({})
          : { kind: "refused", reason: `Thinking level ${String(rpc["level"])} is not supported by the active model.` }
      return ok({})
    }
    const devices: RemoteDevice[] = [
      ...(options.rosterWithoutSelf === true ? [] : [{ device: "here", label: "this mac", online: true }]),
      { device: "b", label: "studio", online: options.online ?? true },
      ...(options.devices ?? []),
    ]
    for (const device of [
      ...(options.rows ?? []).map((row) => row.device),
      ...Object.keys(options.ended ?? {}),
      ...(options.silent ?? []),
    ])
      if (!devices.some((known) => known.device === device)) devices.push({ device, label: device, online: true })
    const registryCalls: string[] = []
    const accountReads: string[] = []
    const down = <T>(): Promise<AliasResult<T>> =>
      options.registryDown === "throws"
        ? Promise.reject(new Error("alias registry connection reset"))
        : Promise.resolve({
            kind: "error",
            error: {
              code: "alias_registry_unavailable",
              message: "the alias registry could not be reached",
              details: { reason: options.registryDown === "signed_out" ? "sign_in" : "network" },
            },
          })
    const registry: AliasRegistry = {
      claim: async ({ alias, holder }) => {
        registryCalls.push("claim")
        if (options.registryDown !== undefined) return await down()
        if (options.claimDown !== undefined)
          return {
            kind: "error",
            error: {
              code: "alias_registry_unavailable",
              message: "the alias registry refused the claim",
              details: { reason: options.claimDown === "signed_out" ? "sign_in" : "network" },
            },
          }
        if (options.failClaim === true) throw new Error("alias registry failed")
        const held = aliases.get(alias)
        if (held !== undefined && held.session_id !== holder.session_id)
          return {
            kind: "error",
            error: { code: "alias_taken", message: `alias ${alias} is taken`, details: { holder: held } },
          }
        aliases.set(alias, holder)
        return { kind: "ok", value: { alias, holder } }
      },
      rename: async ({ session_id, from, to }) => {
        const held = aliases.get(to)
        if (held !== undefined && held.session_id !== session_id)
          return {
            kind: "error",
            error: { code: "alias_taken", message: `alias ${to} is taken`, details: { holder: held } },
          }
        const holder = aliases.get(from)
        if (holder === undefined) return { kind: "error", error: { code: "alias_not_found", message: "no such alias" } }
        aliases.delete(from)
        aliases.set(to, holder)
        return { kind: "ok", value: { alias: to, holder } }
      },
      release: async ({ alias }) => ({ kind: "ok", value: { released: aliases.delete(alias) } }),
      resolve: async (alias) => {
        registryCalls.push("resolve")
        if (options.registryDown !== undefined) return await down()
        const held = aliases.get(alias)
        return held === undefined
          ? { kind: "error", error: { code: "alias_not_found", message: "no such alias" } }
          : { kind: "ok", value: held }
      },
      aliasesOf: async (ids) =>
        registryCalls.push("aliasesOf") > 0 && options.failAliasesOf === true
          ? Promise.reject(new Error("alias registry failed"))
          : options.registryDown !== undefined
            ? await down()
            : {
                kind: "ok",
                value: new Map(
                  [...aliases]
                    .filter(([, holder]) => ids.includes(holder.session_id))
                    .map(([alias, holder]) => [holder.session_id, alias]),
                ),
              },
    }
    const remote: RemoteThreadSurface = {
      loadProjector: async () => senpiProjector,
      client: fakeRemoteClient({
        state: () => options.plan ?? "connected",
        // This device's own id comes from the same account read: unknown names no device, a failed read fails it.
        here: options.selfDevice === "unknown" ? null : "here",
        devices: () => devices,
        reads: accountReads,
        ...(options.selfDevice === "throws"
          ? { fail: { kind: "error", code: "host_unavailable", message: "device.info failed", next_action: "Retry." } }
          : {}),
        ...(options.devicesFail === true
          ? {
              devicesFail: {
                kind: "error",
                code: "host_unavailable",
                message: "closed",
                next_action: "Retry.",
              } as const,
            }
          : {}),
      }),
      sessions: {
        status: async () => {
          accountReads.push("port.status")
          return { state: options.plan ?? "connected" }
        },
        thisDevice: async () => {
          accountReads.push("port.thisDevice")
          deviceReads.thisDevice += 1
          if (options.selfDevice === "throws") throw new Error("device.info failed")
          return options.selfDevice === "unknown" ? null : "here"
        },
        thisDeviceName: async () => "this mac",
        devices: async () => {
          accountReads.push("port.devices")
          deviceReads.devices += 1
          if (options.devicesFail === true) throw new Error("closed")
          return devices
        },
        sessions: async (filter) => {
          if (filter?.device === undefined) listings.all += 1
          else listings.device += 1
          if (options.failSessionsList === true) throw new Error("account list failed")
          const rows = options.rows ?? [{ ...B_ROW, state: options.rowState ?? B_ROW.state }]
          return filter?.device === undefined ? rows : rows.filter((row) => row.device === filter.device)
        },
        listing: async () => {
          listings.all += 1
          if (options.failSessionsList === true) throw new Error("account list failed")
          return {
            rows: options.rows ?? [{ ...B_ROW, state: options.rowState ?? B_ROW.state }],
            incomplete: options.incomplete ?? [],
          }
        },
        endpointCommand: async (device, rpc) => {
          sent.push({ via: "endpoint", device, rpc })
          return answer(rpc)
        },
        // This fake device lists a created session by the id its create reply names.
        locate: async (_device, engineId) => {
          // A device's relay connector keys each session it lists by a relay key, kept beside the durable id (relayKeys).
          if (options.relayKeys === undefined) return { kind: "ok", sessionId: engineId }
          const key = options.relayKeys.get(engineId)
          return key === undefined ? { kind: "refused", reason: "session_not_found" } : { kind: "ok", sessionId: key }
        },
        sessionCommand: async (device, session, rpc) => {
          sent.push({ via: "session", device, session, rpc })
          if (rpc["type"] === "admit_external_message" && options.admitThrows !== undefined)
            throw new Error(options.admitThrows)
          const outcome = answer(rpc, session)
          if (rpc["type"] === "prompt" && outcome.kind === "ok") {
            answeredPrompt = true
            promptClientMessageId = rpc["clientMessageId"]
            if (options.recordsBeforeReply === true) writeRecords()
          }
          return outcome
        },
        watch: async (device, session, handlers, watchOptions) => {
          sent.push({ via: "watch", device, session })
          if (options.refuse !== undefined) return { kind: "refused", reason: options.refuse }
          watchers.add(handlers)
          let end: (reason: RemoteWatchEnd) => void = () => {}
          const ended = new Promise<RemoteWatchEnd>((resolve) => {
            end = resolve
          })
          ends.add(end)
          watchStarted()
          const initial =
            watchOptions?.baseline === true
              ? { initial: { status: engine.streaming ? "running" : "idle", sessionId: session } }
              : {}
          return {
            kind: "ok",
            watch: {
              ended,
              stop: () => {
                watchers.delete(handlers)
                end("stopped")
              },
              ...initial,
            },
          }
        },
        canLookup: async () => options.wakeFeature === true && options.noLookup !== true,
        lookup: async (device, durableId) => {
          if (options.noLookup === true || options.wakeFeature !== true) return { kind: "unavailable" }
          lookups.push({ device, durable_id: durableId })
          if (options.silent?.includes(device) === true) return { kind: "silent", reason: "host_not_answering" }
          const key = options.ended?.[device]?.[durableId]
          return key === undefined ? { kind: "none" } : { kind: "found", key }
        },
        canWake: async () => options.wakeFeature === true && options.noWake !== true,
        wake: async (device, durableId, rpc) => {
          if (options.noWake === true || options.wakeFeature !== true) return { kind: "unavailable" }
          sent.push({ via: "wake", device, session: durableId, rpc })
          return (
            options.wakeOutcome ?? {
              kind: "ok",
              response: {
                type: "response",
                success: true,
                data: {
                  kind: "queued",
                  stored_command_id: "stored-1",
                  deduplicated: false,
                  waiting_on: { kind: "wake" },
                },
              },
            }
          )
        },
        read: async (device, session) => {
          sent.push({ via: "read", device, session })
          const drained = recordsOut
          if (answeredPrompt) writeRecords()
          return {
            kind: "ok",
            response: {
              entries: [
                { role: "user", content: "hi b" },
                { role: "assistant", content: "hello from b" },
                ...(drained ? (options.entriesAfterAnswer ?? []) : []),
              ],
            },
          }
        },
      },
      ...(options.noRegistry === true ? {} : { aliases: registry }),
      // The field senpi's prompt record carries the count in (S32, rpc.md `chainCount`).
      chain: {
        stamp: (record, hop) => {
          hops.push(hop)
          return { ...record, chainCount: hop }
        },
      },
    }
    if (options.withoutLookup === true) {
      const { lookup: _lookup, canLookup: _canLookup, ...plain } = remote.sessions
      ;(remote as { sessions: typeof plain }).sessions = plain
    }
    const endWatches = (reason: RemoteWatchEnd) => {
      for (const end of [...ends]) end(reason)
    }
    return {
      remote,
      sent,
      hops,
      aliases,
      live,
      registryCalls,
      lookups,
      listings,
      deviceReads,
      watchers,
      watching,
      endWatches,
      accountReads,
    }
  }

  function surface(
    remote: RemoteThreadSurface | undefined,
    extra: {
      callerCause?: () => string | undefined
      callerChainHop?: () => number
      callerName?: () => string | undefined
      callerReplyTargets?: () => readonly string[]
      callerReplySenders?: () => readonly {
        readonly session_id: string
        readonly name?: string
        readonly device?: string
      }[]
      env?: Readonly<Record<string, string | undefined>>
      sessions?: ThreadHostSession[]
      engine?: Engine
      caller?: string
      diskSessions?: readonly string[]
      closeOutcome?: ThreadCloseOutcome
      /** Look session files up where senpi writes them, `<agentDir>/sessions`, as the component does. */
      sessionsDirectory?: boolean
      /** This device's engine refuses every open_session with this error text, as its host client throws it. */
      openThrows?: string
      /**
       * #14060: the first N opens CREATE the session (under the asked `durableSessionId`, as a host with that capability
       * does) and then lose the reply: the connection closes before the response arrives.
       */
      openLosesReply?: number
      /** With `openLosesReply`: the next listing after a lost reply fails too, so the create cannot recover on the spot. */
      listFailsAfterLostReply?: boolean
      /** With `openLosesReply`: the host has no `durable_session_id` capability and creates under an id of its own. */
      ignoresDurableSessionId?: boolean
    } = {},
  ) {
    const engine = extra.engine ?? ENGINE
    const local: ThreadHostSession = {
      sessionId: "route-local",
      durableSessionId: "dur-local",
      cwd: process.cwd(),
      name: "local peer",
      status: "open",
    }
    const sessions = extra.sessions ?? [local]
    let lostReplies = extra.openLosesReply ?? 0
    let listFails = false
    const openSession = mock(async (request: Parameters<ThreadHost["openSession"]>[0]) => {
      if (extra.openThrows !== undefined) throw new Error(extra.openThrows)
      // An engine opening a session file on disk resumes it under the id in that file's header, as senpi does.
      const resumed =
        "sessionPath" in request && typeof request.sessionPath === "string" && existsSync(request.sessionPath)
          ? (JSON.parse(readFileSync(request.sessionPath, "utf8").split("\n")[0] ?? "{}") as { id?: string }).id
          : undefined
      const losing = extra.openLosesReply !== undefined
      const created: ThreadHostSession = {
        sessionId: losing ? `route-created-${sessions.length}` : "route-created",
        durableSessionId:
          resumed ??
          (losing && extra.ignoresDurableSessionId !== true && request.durableSessionId !== undefined
            ? request.durableSessionId
            : losing
              ? `dur-created-${sessions.length}`
              : "dur-created-here"),
        cwd: process.cwd(),
        name: null,
        status: "open",
      }
      sessions.push(created)
      if (lostReplies > 0) {
        lostReplies -= 1
        listFails = extra.listFailsAfterLostReply === true
        throw new Error("thread RPC connection closed before the response arrived")
      }
      return created
    })
    const closed: Array<readonly [string, string | undefined]> = []
    // The interrupt records this device's endpoint received, as b's engine's arrive in `sent`.
    const interrupts: JsonObject[] = []
    const setSessionName = mock(async (_sessionId: string, _name: string) => {})
    // How often this device's endpoints were listed (the local enumeration a send can cost).
    let localListings = 0
    // How often a session on this device was prompted directly (a delivery never prompts; this counts any leak).
    let localPrompts = 0
    // The session watches open on this device's endpoint, as b's are in `watchers`; `watching` settles at the first.
    const watchers = new Set<SessionWatchHandlers>()
    const ends = new Set<(reason: string) => void>()
    let watchStarted: () => void = () => {}
    const watching = new Promise<void>((resolve) => {
      watchStarted = resolve
    })
    const host: ThreadHost = {
      socket: "/tmp/thread-remote-test.sock",
      listSessions: async () => {
        localListings += 1
        if (listFails) {
          listFails = false
          throw new Error("thread RPC connection closed before the response arrived")
        }
        return sessions
      },
      openSession,
      getMessages: async () => [...engine.messages],
      getState: async () => ({ isStreaming: false }),
      prompt: async () => {
        localPrompts += 1
        return { turnId: "turn-local" }
      },
      interrupt: async (_sessionId, request) => {
        interrupts.push({ type: "interrupt", ...request })
        return engine.interrupt
      },
      setSessionName,
      setModel: async (_s, provider, id) => ({ provider, id }),
      getAvailableModels: async () => [],
      setThinkingLevel: async (_s, level) => {
        if (!THINKING_LEVELS.includes(level))
          throw new Error(`thinking_level_unsupported:Thinking level ${level} is not supported by the active model.`)
      },
      getAvailableThinkingLevels: async () => [...THINKING_LEVELS],
      closeSession: async (sessionId, durableId) => {
        closed.push([sessionId, durableId])
        return extra.closeOutcome ?? "closed"
      },
      watchSession: async (_sessionId, handlers) => {
        watchers.add(handlers)
        let end: (reason: string) => void = () => {}
        const ended = new Promise<string>((resolve) => {
          end = resolve
        })
        ends.add(end)
        watchStarted()
        return {
          kind: "ok",
          watch: {
            ended,
            initial: { status: engine.streaming ? "running" : "idle" },
            stop: () => {
              watchers.delete(handlers)
              end("stopped")
            },
          },
        }
      },
    }
    const agentDir = mkdtempSync(join(tmpdir(), "thread-remote-"))
    directories.push(agentDir)
    const store = createGatewayStore({ agentDir })
    stores.push(store)
    // Session files with no live owner: the address book lists them from disk, and no host holds them.
    const disk = (extra.diskSessions ?? []).map((id) => ({
      durable_id: id,
      name: null,
      cwd: process.cwd(),
      created_at: "2026-11-01T00:00:00Z",
      updated_at: null,
      session_path: join(agentDir, `${id}.jsonl`),
      source_host: null,
    }))
    const caller = extra.caller ?? "dur-caller"
    // Every delivery the gateway takes for a session on this device, by target: a local thread_send's real call.
    const enqueued: Array<Parameters<GatewayStore["enqueue"]>[0]> = []
    const countedStore = new Proxy(store, {
      get: (target, property, receiver) =>
        property === "enqueue"
          ? (request: Parameters<GatewayStore["enqueue"]>[0]) => {
              enqueued.push(request)
              return target.enqueue(request)
            }
          : Reflect.get(target, property, receiver),
    })
    const tools = createThreadTools({
      host,
      store: countedStore,
      stateDirectory: join(agentDir, "state"),
      diskSessions: () => disk,
      ...(extra.sessionsDirectory === true ? { sessionsDirectory: () => join(agentDir, "sessions") } : {}),
      callerSessionId: () => caller,
      callerWorkspaceRoot: () => process.cwd(),
      remote,
      ...(extra.callerReplyTargets === undefined ? {} : { callerReplyTargets: extra.callerReplyTargets }),
      ...(extra.callerReplySenders === undefined ? {} : { callerReplySenders: extra.callerReplySenders }),
      ...(extra.callerCause === undefined ? {} : { callerCause: extra.callerCause }),
      ...(extra.callerChainHop === undefined ? {} : { callerChainHop: extra.callerChainHop }),
      ...(extra.callerName === undefined ? {} : { callerName: extra.callerName }),
      ...(extra.env === undefined ? {} : { env: extra.env }),
    })
    const run = async (name: ThreadToolName, args: unknown): Promise<ThreadToolResult> => {
      const tool = tools.find((candidate) => candidate.name === name)
      if (tool === undefined) throw new Error(`${name} is not registered`)
      return (
        await tool.execute(`call-${Math.random()}`, args, undefined, undefined, {
          sessionManager: { getSessionId: () => caller },
        } as never)
      ).details.result as ThreadToolResult
    }
    // What thread_send asks the engine's permission system for, before it runs (tools/reply-permission.ts).
    const permission = (args: Record<string, unknown>): unknown => {
      const parse = tools.find((candidate) => candidate.name === "thread_send")?.permissionParser
      if (parse === undefined) throw new Error("thread_send declares no permission parser")
      return parse(args, process.cwd())
    }
    return {
      run,
      permission,
      openSession,
      setSessionName,
      store,
      closed,
      interrupts,
      agentDir,
      listings: () => localListings,
      prompts: () => localPrompts,
      watchers,
      watching,
      endWatches: (reason: string) => {
        for (const end of [...ends]) end(reason)
      },
      enqueuedFor: (durableId: string) => enqueued.filter((request) => request.target_durable_id === durableId).length,
      enqueuedRequests: (durableId: string) => enqueued.filter((request) => request.target_durable_id === durableId),
    }
  }

  return { account, surface, cleanup }
}
