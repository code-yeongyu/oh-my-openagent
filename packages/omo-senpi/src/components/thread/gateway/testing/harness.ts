import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { toSessionControlDrainResult, type GatewayEndpointPort } from "../adapter"
import { createInboxDrain, type InboxDrain } from "../drain"
import { createGatewayEngine, resolveFromEntries, type GatewayAddressEntry, type GatewayEngine } from "../engine"
import { createGatewayStore, type GatewayStore, type GatewayStoreOptions } from "../store"
import { FakeSessionRuntime } from "./fake-runtime"

export type HarnessSession = {
  readonly id: string
  readonly cwd: string
  readonly runtime: FakeSessionRuntime
  readonly store: GatewayStore
  readonly drain: InboxDrain
  readonly engine: GatewayEngine
  online: boolean
}

export type SessionOptions = {
  readonly cwd?: string
  readonly online?: boolean
  readonly name?: string
  readonly storeOptions?: Partial<GatewayStoreOptions>
}

export type GatewayHarness = {
  readonly agentDir: string
  readonly clock: { now: number }
  readonly wakes: { delivery_ids: readonly string[]; target: string }[]
  readonly session: (id: string, options?: SessionOptions) => HarnessSession
  readonly get: (id: string) => HarnessSession
  readonly store: (options?: Partial<GatewayStoreOptions>) => GatewayStore
  readonly engineFor: (store: GatewayStore, cwd?: string) => GatewayEngine
  readonly phantom: (id: string) => void
  readonly entries: () => readonly GatewayAddressEntry[]
  readonly quiesce: () => Promise<void>
  readonly dispose: () => Promise<void>
}

export function createGatewayHarness(options: { readonly startAt?: number } = {}): GatewayHarness {
  const agentDir = realpathSync(mkdtempSync(join(tmpdir(), "omo-gateway-")))
  mkdirSync(join(agentDir, "sessions"), { recursive: true })
  const clock = { now: options.startAt ?? Date.UTC(2026, 8, 29, 0, 0, 0) }
  const now = () => clock.now
  const sessions = new Map<string, HarnessSession>()
  const phantoms = new Set<string>()
  const names = new Map<string, string>()
  const stores: GatewayStore[] = []
  const background = new Set<Promise<unknown>>()
  const wakes: { delivery_ids: readonly string[]; target: string }[] = []

  function track<T>(promise: Promise<T>): Promise<T> {
    background.add(promise)
    void promise.finally(() => background.delete(promise)).catch(() => undefined)
    return promise
  }

  function store(extra: Partial<GatewayStoreOptions> = {}): GatewayStore {
    const created = createGatewayStore({ agentDir, now, ...extra })
    stores.push(created)
    return created
  }

  function entries(): readonly GatewayAddressEntry[] {
    const offline = [...phantoms].map((id) => ({
      thread_id: id,
      name: id,
      status: "resumable" as const,
      cwd: agentDir,
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString(),
      endpoint: null,
      liveness: "dead" as const,
    }))
    return [...offline, ...[...sessions.values()].map((session) => ({
      thread_id: session.id,
      name: names.get(session.id) ?? session.id,
      status: "live" as const,
      cwd: session.cwd,
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString(),
      endpoint: { kind: "tui" as const, socket: `fake:${session.id}`, routing_id: null },
      liveness: session.online ? ("routable" as const) : ("dead" as const),
    }))]
  }

  function engineFor(target: GatewayStore, cwd: string = agentDir): GatewayEngine {
    return createGatewayEngine({ store: target, endpoints, resolve: resolveFromEntries(entries, () => cwd), now })
  }

  const endpoints: GatewayEndpointPort = {
    wake: async (endpoint, deliveryIds) => {
      const target = sessions.get(endpoint.socket.slice("fake:".length))
      if (target === undefined || !target.online) throw new Error(`endpoint ${endpoint.socket} is unreachable`)
      wakes.push({ delivery_ids: deliveryIds, target: target.id })
      return toSessionControlDrainResult(await track(target.drain.drain({ reason: "command", delivery_ids: deliveryIds })))
    },
  }

  function session(id: string, sessionOptions: SessionOptions = {}): HarnessSession {
    const cwd = sessionOptions.cwd ?? agentDir
    const runtime = new FakeSessionRuntime(join(agentDir, "sessions", `${id}.jsonl`), id, cwd)
    const sessionStore = store(sessionOptions.storeOptions)
    const drain = createInboxDrain({ store: sessionStore, runtime, durableId: id, sessionPath: () => runtime.sessionPath, now })
    const engine = engineFor(sessionStore, cwd)
    const created: HarnessSession = { id, cwd, runtime, store: sessionStore, drain, engine, online: sessionOptions.online ?? true }
    runtime.onEmitted(() => void track(drain.drain({ reason: "emitted" })))
    runtime.onIdle(() => void track(drain.drain({ reason: "idle" })))
    if (sessionOptions.name !== undefined) names.set(id, sessionOptions.name)
    sessions.set(id, created)
    return created
  }

  return {
    agentDir,
    clock,
    wakes,
    session,
    get: (id) => {
      const found = sessions.get(id)
      if (found === undefined) throw new Error(`no harness session ${id}`)
      return found
    },
    store,
    engineFor,
    phantom: (id) => {
      phantoms.add(id)
    },
    entries,
    quiesce: async () => {
      while (background.size > 0) await Promise.allSettled([...background])
    },
    dispose: async () => {
      while (background.size > 0) await Promise.allSettled([...background])
      await Promise.all(stores.map((created) => created.dispose()))
      rmSync(agentDir, { recursive: true, force: true })
    },
  }
}
