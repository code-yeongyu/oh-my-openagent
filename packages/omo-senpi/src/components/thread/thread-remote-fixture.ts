import { mock } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ThreadToolName, ThreadToolResult } from "./contracts"
import { createGatewayStore, type GatewayStore } from "./gateway/store"
import type { AliasHolder, AliasRegistry, AliasResult, JsonObject, RemoteCommandOutcome, RemoteDevice, RemoteSessionRow, RemoteThreadSurface } from "./remote/ports"
import type { ThreadTranscriptEntry } from "./reader"
import { createThreadTools, type ThreadHost, type ThreadHostSession } from "./tools"
import type { ThreadCloseOutcome } from "./tools/ports"

export const B_ROW: RemoteSessionRow = { device: "b", session_id: "dur-on-b", title: "on b", project: "/work/b", path: "/home/b/.omo/agent/sessions/dur-on-b.jsonl", state: "idle", updated_ms: 1_700_000_000_000 }

type Sent = { readonly via: "endpoint" | "session" | "read" | "watch"; readonly device: string; readonly session?: string; readonly rpc?: JsonObject }

type Engine = { readonly messages: readonly ThreadTranscriptEntry[]; readonly interrupt: JsonObject; readonly streaming: boolean; readonly pending: number; readonly currentTurnId?: string; readonly turnEpoch?: string }

export const ENGINE: Engine = { messages: Array.from({ length: 30 }, (_, index) => ({ role: index % 2 === 0 ? "user" : "assistant", content: `message ${index} ${"x".repeat(60)}` })), interrupt: { interrupted: false }, streaming: false, pending: 0 }

export const comparable = (result: ThreadToolResult): unknown => {
  const { thread_id: _id, link: _link, device: _device, ...rest } = result as Record<string, unknown>
  return rest
}

export function createRemoteThreadFixture() {
  const directories: string[] = []
  const stores: GatewayStore[] = []
  const cleanup = async () => {
    await Promise.all(stores.splice(0).map((store) => store.dispose()))
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
  }

  function account(options: { plan?: string; online?: boolean; refuse?: string; aliases?: Map<string, AliasHolder>; noRegistry?: boolean; engine?: Engine; promptResponse?: JsonObject; promptOutcome?: RemoteCommandOutcome; admitRefuse?: string; admitOutcome?: RemoteCommandOutcome; heldDraft?: number; openData?: JsonObject; failSessionsList?: boolean; failAliasesOf?: boolean; failClaim?: boolean; otherHolders?: number; unwritten?: boolean; rowState?: string; live?: readonly string[]; records?: readonly JsonObject[]; rows?: readonly RemoteSessionRow[]; registryDown?: "refused" | "throws"; chainCountLimit?: number; relayKeys?: ReadonlyMap<string, string> } = {}) {
    const engine = options.engine ?? ENGINE
    const sent: Sent[] = []
    // b's engine ledger of admitted delivery ids (senpi external-admission: a repeated id is already_admitted), and how many
    // admissions its user's open draft still holds (held_draft, taken by nothing).
    const admitted = new Set<string>()
    let heldDraft = options.heldDraft ?? 0
    // The session's records a prompt makes it write, delivered to every watch after the prompt is answered.
    const watchers = new Set<(record: JsonObject) => void>()
    const writeRecords = () => queueMicrotask(() => { for (const record of options.records ?? []) for (const listener of [...watchers]) listener(record) })
    const hops: number[] = []
    const aliases = options.aliases ?? new Map<string, AliasHolder>()
    // The sessions b's engine holds. Its close rules are senpi's (2026.11.5-1): close_session from a connection that never
    // attached is refused unknown_session (senpi#1782); an attached close releases only that hold, so the session ends
    // only with no other holder; unload_session with force drains every hold, and refuses a session with no file yet.
    const live = new Set(options.live ?? [B_ROW.session_id])
    const answer = (rpc: JsonObject, attachedTo?: string): RemoteCommandOutcome => {
      // The engine's real reply envelope, as the device service hands it back (device-service-core's CommandResult.response):
      // every field the tools read lives under `data`.
      const ok = (data: JsonObject): RemoteCommandOutcome => ({ kind: "ok", response: { type: "response", id: null, command: rpc["type"] ?? null, success: true, data } })
      if (options.refuse !== undefined) return { kind: "refused", reason: options.refuse }
      if (attachedTo !== undefined && !live.has(attachedTo)) return { kind: "refused", reason: "unknown_session" }
      if (rpc["type"] === "close_session") {
        if (attachedTo === undefined) return { kind: "refused", reason: "unknown_session" }
        if ((options.otherHolders ?? 0) === 0) live.delete(attachedTo)
        return ok({})
      }
      if (rpc["type"] === "unload_session" && attachedTo !== undefined) {
        if (options.unwritten === true) return ok({ outcome: "refused", reason: "unsupported", detail: "the session has no file to reopen it by" })
        if ((options.otherHolders ?? 0) > 0 && rpc["force"] !== true) return ok({ outcome: "refused", reason: "attached", detail: "1 other client(s) attached" })
        live.delete(attachedTo)
        return ok({ outcome: "unloaded", sessionPath: B_ROW.path })
      }
      if (rpc["type"] === "open_session") {
        const opened = rpc["sessionPath"] === undefined ? "dur-new-on-b" : "dur-on-b"
        live.add(opened)
        return ok(options.openData ?? { sessionId: "rpc-9", state: { durableSessionId: opened } })
      }
      if (rpc["type"] === "get_state") return ok({ isStreaming: engine.streaming, pendingMessageCount: engine.pending, ...(engine.currentTurnId === undefined ? {} : { currentTurnId: engine.currentTurnId }) })
      if (rpc["type"] === "get_messages") return ok({ messages: [...engine.messages] })
      if (rpc["type"] === "interrupt") return ok(engine.interrupt)
      // b's user set `threads.chainCountLimit` (senpi S32): its engine answers `{success: false, errorCode: "chain_count_limit"}`,
      // which the device service hands back as this refusal (device-service.ts).
      if (rpc["type"] === "prompt" && options.chainCountLimit !== undefined && Number(rpc["chainCount"]) > options.chainCountLimit) return { kind: "refused", reason: "chain_count_limit" }
      if (rpc["type"] === "prompt" && options.promptOutcome !== undefined) return options.promptOutcome
      if (rpc["type"] === "prompt") return ok(options.promptResponse ?? (engine.streaming ? { disposition: "queued" } : { disposition: "started", turnId: "turn-b" }))
      if (rpc["type"] === "admit_external_message") {
        if (options.admitRefuse !== undefined) return { kind: "refused", reason: options.admitRefuse }
        if (options.admitOutcome !== undefined) return options.admitOutcome
        if (options.chainCountLimit !== undefined && Number(rpc["chainCount"]) > options.chainCountLimit) return { kind: "refused", reason: "chain_count_limit" }
        const epoch = engine.turnEpoch ?? engine.currentTurnId ?? "turn-b"
        const id = String(rpc["deliveryId"])
        if (admitted.has(id)) return ok({ kind: "already_admitted", turnId: epoch })
        if (heldDraft > 0) { heldDraft -= 1; return ok({ kind: "held_draft", turnId: epoch }) }
        if (rpc["deliverAs"] === "steer") {
          if (!engine.streaming || rpc["expectedTurnId"] !== engine.currentTurnId) return ok({ kind: "turn_conflict", turnId: epoch })
          admitted.add(id)
          return ok({ kind: "steered", turnId: epoch })
        }
        admitted.add(id)
        return ok(engine.streaming ? { kind: "queued", turnId: epoch } : { kind: "started", turnId: epoch })
      }
      if (rpc["type"] === "get_available_models") return ok({ models: [{ provider: "anthropic", id: "claude-opus", name: "Opus" }, { provider: "openai", id: "gpt-6" }] })
      if (rpc["type"] === "set_model") return ok({ provider: rpc["provider"] ?? null, id: rpc["modelId"] ?? null })
      return ok({})
    }
    const devices: RemoteDevice[] = [{ device: "here", label: "this mac", online: true }, { device: "b", label: "studio", online: options.online ?? true }]
    for (const row of options.rows ?? []) if (!devices.some((known) => known.device === row.device)) devices.push({ device: row.device, label: row.device, online: true })
    const registryCalls: string[] = []
    const down = <T>(): Promise<AliasResult<T>> => options.registryDown === "throws"
      ? Promise.reject(new Error("alias registry connection reset"))
      : Promise.resolve({ kind: "error", error: { code: "alias_registry_unavailable", message: "the alias registry could not be reached", details: { reason: "sign_in" } } })
    const registry: AliasRegistry = {
      claim: async ({ alias, holder }) => {
        registryCalls.push("claim")
        if (options.registryDown !== undefined) return await down()
        if (options.failClaim === true) throw new Error("alias registry failed")
        const held = aliases.get(alias)
        if (held !== undefined && held.session_id !== holder.session_id) return { kind: "error", error: { code: "alias_taken", message: `alias ${alias} is taken`, details: { holder: held } } }
        aliases.set(alias, holder)
        return { kind: "ok", value: { alias, holder } }
      },
      rename: async ({ session_id, from, to }) => {
        const held = aliases.get(to)
        if (held !== undefined && held.session_id !== session_id) return { kind: "error", error: { code: "alias_taken", message: `alias ${to} is taken`, details: { holder: held } } }
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
        return held === undefined ? { kind: "error", error: { code: "alias_not_found", message: "no such alias" } } : { kind: "ok", value: held }
      },
      aliasesOf: async (ids) => registryCalls.push("aliasesOf") > 0 && options.failAliasesOf === true ? Promise.reject(new Error("alias registry failed")) : ({ kind: "ok", value: new Map([...aliases].filter(([, holder]) => ids.includes(holder.session_id)).map(([alias, holder]) => [holder.session_id, alias])) }),
    }
    const remote: RemoteThreadSurface = {
      sessions: {
        status: async () => ({ state: options.plan ?? "connected" }),
        thisDevice: async () => "here",
        devices: async () => devices,
        sessions: async () => { if (options.failSessionsList === true) throw new Error("account list failed"); return options.rows ?? [{ ...B_ROW, state: options.rowState ?? B_ROW.state }] },
        endpointCommand: async (device, rpc) => { sent.push({ via: "endpoint", device, rpc }); return answer(rpc) },
        // This fake device lists a created session by the id its create reply names.
        locate: async (_device, engineId) => {
          // A device's relay connector keys each session it lists by a relay key, kept beside the durable id (relayKeys).
          if (options.relayKeys === undefined) return { kind: "ok", sessionId: engineId }
          const key = options.relayKeys.get(engineId)
          return key === undefined ? { kind: "refused", reason: "session_not_found" } : { kind: "ok", sessionId: key }
        },
        sessionCommand: async (device, session, rpc) => {
          sent.push({ via: "session", device, session, rpc })
          const outcome = answer(rpc, session)
          if (rpc["type"] === "prompt" && outcome.kind === "ok") writeRecords()
          return outcome
        },
        watch: async (device, session, listener) => {
          sent.push({ via: "watch", device, session })
          if (options.refuse !== undefined) return { kind: "refused", reason: options.refuse }
          watchers.add(listener)
          return { kind: "ok", watch: { ended: new Promise<string>(() => {}), stop: () => { watchers.delete(listener) } } }
        },
        read: async (device, session) => { sent.push({ via: "read", device, session }); return { kind: "ok", response: { entries: [{ role: "user", content: "hi b" }, { role: "assistant", content: "hello from b" }] } } },
      },
      ...(options.noRegistry === true ? {} : { aliases: registry }),
      // The field senpi's prompt record carries the count in (S32, rpc.md `chainCount`).
      chain: { stamp: (record, hop) => { hops.push(hop); return { ...record, chainCount: hop } } },
    }
    return { remote, sent, hops, aliases, live, registryCalls }
  }

  function surface(remote: RemoteThreadSurface | undefined, extra: { callerCause?: () => string | undefined; callerChainHop?: () => number; callerName?: () => string | undefined; env?: Readonly<Record<string, string | undefined>>; sessions?: ThreadHostSession[]; engine?: Engine; caller?: string; diskSessions?: readonly string[]; closeOutcome?: ThreadCloseOutcome } = {}) {
    const engine = extra.engine ?? ENGINE
    const local: ThreadHostSession = { sessionId: "route-local", durableSessionId: "dur-local", cwd: process.cwd(), name: "local peer", status: "open" }
    const sessions = extra.sessions ?? [local]
    const openSession = mock(async () => {
      const created: ThreadHostSession = { sessionId: "route-created", durableSessionId: "dur-created-here", cwd: process.cwd(), name: null, status: "open" }
      sessions.push(created)
      return created
    })
    const closed: Array<readonly [string, string | undefined]> = []
    const host: ThreadHost = {
      socket: "/tmp/thread-remote-test.sock",
      listSessions: async () => sessions,
      openSession,
      getMessages: async () => [...engine.messages],
      getState: async () => ({ isStreaming: false }),
      prompt: async () => ({ turnId: "turn-local" }),
      interrupt: async () => engine.interrupt,
      setSessionName: async () => {},
      setModel: async (_s, provider, id) => ({ provider, id }),
      getAvailableModels: async () => [],
      setThinkingLevel: async () => {},
      getAvailableThinkingLevels: async () => [],
      closeSession: async (sessionId, durableId) => { closed.push([sessionId, durableId]); return extra.closeOutcome ?? "closed" },
    }
    const agentDir = mkdtempSync(join(tmpdir(), "thread-remote-"))
    directories.push(agentDir)
    const store = createGatewayStore({ agentDir })
    stores.push(store)
    // Session files with no live owner: the address book lists them from disk, and no host holds them.
    const disk = (extra.diskSessions ?? []).map((id) => ({ durable_id: id, name: null, cwd: process.cwd(), created_at: "2026-11-01T00:00:00Z", updated_at: null, session_path: join(agentDir, `${id}.jsonl`), source_host: null }))
    const caller = extra.caller ?? "dur-caller"
    const tools = createThreadTools({ host, store, stateDirectory: join(agentDir, "state"), diskSessions: () => disk, callerSessionId: () => caller, callerWorkspaceRoot: () => process.cwd(), remote, ...(extra.callerCause === undefined ? {} : { callerCause: extra.callerCause }), ...(extra.callerChainHop === undefined ? {} : { callerChainHop: extra.callerChainHop }), ...(extra.callerName === undefined ? {} : { callerName: extra.callerName }), ...(extra.env === undefined ? {} : { env: extra.env }) })
    const run = async (name: ThreadToolName, args: unknown): Promise<ThreadToolResult> => {
      const tool = tools.find((candidate) => candidate.name === name)
      if (tool === undefined) throw new Error(`${name} is not registered`)
      return (await tool.execute(`call-${Math.random()}`, args, undefined, undefined, { sessionManager: { getSessionId: () => caller } } as never)).details.result as ThreadToolResult
    }
    return { run, openSession, store, closed, agentDir }
  }

  return { account, surface, cleanup }
}
