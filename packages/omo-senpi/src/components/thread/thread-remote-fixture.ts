import { mock } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ThreadToolName, ThreadToolResult } from "./contracts"
import { createGatewayStore, type GatewayStore } from "./gateway/store"
import type { AliasHolder, AliasRegistry, JsonObject, RemoteCommandOutcome, RemoteDevice, RemoteSessionRow, RemoteThreadSurface } from "./remote/ports"
import type { ThreadTranscriptEntry } from "./reader"
import { createThreadTools, type ThreadHost, type ThreadHostSession } from "./tools"
import type { ThreadCloseOutcome } from "./tools/ports"

export const B_ROW: RemoteSessionRow = { device: "b", session_id: "dur-on-b", title: "on b", project: "/work/b", path: "/home/b/.omo/agent/sessions/dur-on-b.jsonl", state: "idle", updated_ms: 1_700_000_000_000 }

type Sent = { readonly via: "endpoint" | "session" | "read"; readonly device: string; readonly session?: string; readonly rpc?: JsonObject }

type Engine = { readonly messages: readonly ThreadTranscriptEntry[]; readonly interrupt: JsonObject; readonly streaming: boolean; readonly pending: number; readonly currentTurnId?: string }

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

  function account(options: { plan?: string; online?: boolean; refuse?: string; aliases?: Map<string, AliasHolder>; noRegistry?: boolean; engine?: Engine; promptResponse?: JsonObject; promptOutcome?: RemoteCommandOutcome; openData?: JsonObject; failSessionsList?: boolean; failAliasesOf?: boolean; failClaim?: boolean; otherHolders?: number; unwritten?: boolean; rowState?: string; live?: readonly string[] } = {}) {
    const engine = options.engine ?? ENGINE
    const sent: Sent[] = []
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
      if (attachedTo !== undefined && !live.has(attachedTo)) return { kind: "refused", reason: "session_not_found" }
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
      if (rpc["type"] === "prompt" && options.promptOutcome !== undefined) return options.promptOutcome
      if (rpc["type"] === "prompt") return ok(options.promptResponse ?? (engine.streaming ? { disposition: "queued" } : { disposition: "started", turnId: "turn-b" }))
      if (rpc["type"] === "get_available_models") return ok({ models: [{ provider: "anthropic", id: "claude-opus", name: "Opus" }, { provider: "openai", id: "gpt-6" }] })
      if (rpc["type"] === "set_model") return ok({ provider: rpc["provider"] ?? null, id: rpc["modelId"] ?? null })
      return ok({})
    }
    const devices: RemoteDevice[] = [{ device: "here", label: "this mac", online: true }, { device: "b", label: "studio", online: options.online ?? true }]
    const registry: AliasRegistry = {
      claim: async ({ alias, holder }) => {
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
        const held = aliases.get(alias)
        return held === undefined ? { kind: "error", error: { code: "alias_not_found", message: "no such alias" } } : { kind: "ok", value: held }
      },
      aliasesOf: async (ids) => options.failAliasesOf === true ? Promise.reject(new Error("alias registry failed")) : ({ kind: "ok", value: new Map([...aliases].filter(([, holder]) => ids.includes(holder.session_id)).map(([alias, holder]) => [holder.session_id, alias])) }),
    }
    const remote: RemoteThreadSurface = {
      sessions: {
        status: async () => ({ state: options.plan ?? "connected" }),
        thisDevice: async () => "here",
        devices: async () => devices,
        sessions: async () => { if (options.failSessionsList === true) throw new Error("account list failed"); return [{ ...B_ROW, state: options.rowState ?? B_ROW.state }] },
        endpointCommand: async (device, rpc) => { sent.push({ via: "endpoint", device, rpc }); return answer(rpc) },
        // This fake device lists a created session by the id its create reply names.
        locate: async (_device, engineId) => ({ kind: "ok", sessionId: engineId }),
        sessionCommand: async (device, session, rpc) => { sent.push({ via: "session", device, session, rpc }); return answer(rpc, session) },
        read: async (device, session) => { sent.push({ via: "read", device, session }); return { kind: "ok", response: { entries: [{ role: "user", content: "hi b" }, { role: "assistant", content: "hello from b" }] } } },
      },
      ...(options.noRegistry === true ? {} : { aliases: registry }),
      chain: { stamp: (record, hop) => { hops.push(hop); return { ...record, chain_count: hop } } },
    }
    return { remote, sent, hops, aliases, live }
  }

  function surface(remote: RemoteThreadSurface | undefined, extra: { callerCause?: () => string | undefined; sessions?: ThreadHostSession[]; engine?: Engine; caller?: string; diskSessions?: readonly string[]; closeOutcome?: ThreadCloseOutcome } = {}) {
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
    const tools = createThreadTools({ host, store, stateDirectory: join(agentDir, "state"), diskSessions: () => disk, callerSessionId: () => caller, callerWorkspaceRoot: () => process.cwd(), remote, ...(extra.callerCause === undefined ? {} : { callerCause: extra.callerCause }) })
    const run = async (name: ThreadToolName, args: unknown): Promise<ThreadToolResult> => {
      const tool = tools.find((candidate) => candidate.name === name)
      if (tool === undefined) throw new Error(`${name} is not registered`)
      return (await tool.execute(`call-${Math.random()}`, args, undefined, undefined, { sessionManager: { getSessionId: () => caller } } as never)).details.result as ThreadToolResult
    }
    return { run, openSession, store, closed }
  }

  return { account, surface, cleanup }
}
