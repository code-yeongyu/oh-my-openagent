import { afterEach, describe, expect, test } from "bun:test"
import dgram from "node:dgram"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import http from "node:http"
import https from "node:https"
import net from "node:net"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import tls from "node:tls"

import type { SenpiExtensionAPI } from "../../extension/types"
import {
  ONBOARDING_APPLY_RPC_METHOD,
  ONBOARDING_SCAN_RPC_EVENT,
  ONBOARDING_SCAN_RPC_METHOD,
  ONBOARDING_UNDERSTAND_RPC_METHOD,
  ONBOARDING_UNDERSTAND_SKIP_RPC_METHOD,
  ONBOARDING_UNDERSTAND_STOP_RPC_METHOD,
  createOnboardingScanComponent,
  createOnboardingScanStore,
  type OnboardingApplyResponse,
  type OnboardingScanEvent,
  type OnboardingScanResponse,
  type OnboardingScanStore,
} from "./scan-component"

const roots: string[] = []
const SECRET = "SK-SENTINEL-ONBOARDING-SCAN"
const EVENT_TIMEOUT_MS = 20_000

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

type Profile = { home: string; agentDir: string; env: Record<string, string> }

function emptyProfile(): Profile {
  const root = mkdtempSync(join(tmpdir(), "omo-onboarding-scan-"))
  roots.push(root)
  const home = join(root, "home")
  mkdirSync(home, { recursive: true })
  return { home, agentDir: join(home, ".omo", "agent"), env: { HOME: home } }
}

function openCodeProfile(): Profile {
  const profile = emptyProfile()
  write(join(profile.home, ".local", "share", "opencode", "auth.json"), JSON.stringify({
    openai: { type: "api", key: SECRET },
    anthropic: { type: "oauth", refresh: "r", access: "a", expires: 1 },
  }))
  write(join(profile.home, ".config", "opencode", "opencode.json"), JSON.stringify({
    model: "openai/gpt-5",
    mcp: { ctx: { type: "local", command: ["npx", "ctx"] } },
    provider: { myco: { npm: "@ai-sdk/openai-compatible", options: { baseURL: "https://example.invalid/v1" }, models: { m1: {} } } },
  }))
  return profile
}

type Handler = (data: unknown) => unknown | Promise<unknown>

/** The engine surface an apply writes credentials through (AuthStorage, narrowed to what apply uses). */
interface EngineAuthStore {
  getStoragePath(): string
  modify(provider: string, fn: (current: unknown) => unknown | Promise<unknown>): Promise<unknown>
}

function fakeHost() {
  const handlers = new Map<string, Handler>()
  const events: OnboardingScanEvent[] = []
  const listeners = new Set<(event: OnboardingScanEvent) => void>()
  const modelAccess: string[] = []
  const eventHandlers = new Map<string, Array<(payload: unknown, ctx?: unknown) => unknown | Promise<unknown>>>()
  const api = {
    on(event: string, handler: (payload: unknown, ctx?: unknown) => unknown | Promise<unknown>) {
      const own = eventHandlers.get(event) ?? []
      own.push(handler)
      eventHandlers.set(event, own)
    },
    async dispatchEvent(event: string, payload: unknown, ctx?: unknown) {
      for (const handler of [...eventHandlers.get(event) ?? []]) await handler(payload, ctx)
    },
  }
  const rpc = {
    emit(name: string, data: unknown) {
      if (name !== ONBOARDING_SCAN_RPC_EVENT) return
      const event = data as OnboardingScanEvent
      events.push(event)
      for (const listener of listeners) listener(event)
    },
    handle(name: string, handler: Handler) {
      handlers.set(name, handler)
    },
  }
  const pi = new Proxy({ rpc, ...api } as Record<string | symbol, unknown>, {
    get(target, key) {
      if (typeof key === "string" && /model/i.test(key)) {
        modelAccess.push(key)
        throw new Error(`onboarding scan touched the model surface: ${key}`)
      }
      return target[key]
    },
  }) as unknown as SenpiExtensionAPI

  function doneOf(scanId: string): Promise<OnboardingScanEvent[]> {
    const own = () => events.filter((candidate) => candidate.scanId === scanId)
    if (own().some((event) => event.kind === "done")) return Promise.resolve(own())
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        listeners.delete(listener)
        reject(new Error(`waited ${EVENT_TIMEOUT_MS}ms for the done event of scan ${scanId}, never fired`))
      }, EVENT_TIMEOUT_MS)
      const listener = (event: OnboardingScanEvent) => {
        if (event.scanId !== scanId || event.kind !== "done") return
        clearTimeout(timer)
        listeners.delete(listener)
        resolve(own())
      }
      listeners.add(listener)
    })
  }

  async function scan(request: unknown): Promise<{ scanId: string; events: OnboardingScanEvent[] }> {
    const handler = handlers.get(ONBOARDING_SCAN_RPC_METHOD)
    if (handler === undefined) throw new Error("scan handler not registered")
    const response = await handler(request) as OnboardingScanResponse
    if (!("scanId" in response)) throw new Error(`scan unavailable: ${JSON.stringify(response)}`)
    return { scanId: response.scanId, events: await doneOf(response.scanId) }
  }

  async function apply(request: unknown): Promise<OnboardingApplyResponse> {
    const handler = handlers.get(ONBOARDING_APPLY_RPC_METHOD)
    if (handler === undefined) throw new Error("apply handler not registered")
    return await handler(request) as OnboardingApplyResponse
  }

  return { pi, handlers, events, modelAccess, scan, apply, waitForDone: doneOf, dispatchEvent: api.dispatchEvent }
}

interface RegisterOptions {
  readonly authStore?: () => EngineAuthStore | undefined
  readonly now?: () => number
}

/** One session with a scan store of its own, so no test sees another test's retained scans. */
function register(profile: Profile, options: RegisterOptions = {}) {
  return registerSession(profile, createOnboardingScanStore(), options)
}

/**
 * One session of an engine process. Sessions given the same store share retained scans the way
 * sessions of one process do; `undefined` is production wiring, the process-wide store.
 */
function registerSession(profile: Profile, store: OnboardingScanStore | undefined, options: RegisterOptions = {}) {
  const host = fakeHost()
  createOnboardingScanComponent({
    runtime: () => ({ home: profile.home, env: profile.env, agentDir: profile.agentDir }),
    ...(store === undefined ? {} : { scanStore: store }),
    ...(options.authStore === undefined ? {} : { authStore: options.authStore }),
    ...(options.now === undefined ? {} : { now: options.now }),
  }).register(host.pi, {} as never)
  return host
}

function authPath(profile: Profile): string {
  return join(profile.agentDir, "auth.json")
}

/** An in-process stand-in for the engine's AuthStorage: modify reads, merges one provider, writes. */
function fileStore(path: string, log?: string[]) {
  return {
    getStoragePath: () => path,
    async modify(provider: string, fn: (current: unknown) => unknown | Promise<unknown>) {
      log?.push(`enter:${provider}`)
      let entries: Record<string, unknown> = {}
      try { entries = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown> } catch { /* absent */ }
      const next = await fn(entries[provider])
      if (next !== undefined) {
        entries[provider] = next
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, JSON.stringify(entries, null, 2))
      }
      log?.push(`exit:${provider}`)
      return next
    },
  }
}

/**
 * A store whose modify calls serialize like a locked one: every call logs `enter` the moment it is
 * made, then waits its turn; the critical section (read, merge, write) runs one caller at a time,
 * so a caller can hold the store while another apply queues behind it.
 */
function gatedStore(path: string) {
  const log: string[] = []
  const waiters = new Map<string, Array<() => void>>()
  let mutex = Promise.resolve()
  const noteEnter = (provider: string) => {
    log.push(`enter:${provider}`)
    for (const resolve of waiters.get(provider) ?? []) resolve()
    waiters.delete(provider)
  }
  const store: EngineAuthStore = {
    getStoragePath: () => path,
    modify(provider: string, fn: (current: unknown) => unknown | Promise<unknown>) {
      noteEnter(provider)
      const run = mutex.then(async () => {
        log.push(`run:${provider}`)
        let entries: Record<string, unknown> = {}
        try { entries = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown> } catch { /* absent */ }
        const next = await fn(entries[provider])
        if (next !== undefined) {
          entries[provider] = next
          mkdirSync(dirname(path), { recursive: true })
          writeFileSync(path, JSON.stringify(entries, null, 2))
        }
        log.push(`done:${provider}`)
      })
      mutex = run.catch(() => {})
      return run
    },
  }
  const entered = (provider: string) =>
    log.includes(`enter:${provider}`)
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
        const own = waiters.get(provider) ?? []
        own.push(resolve)
        waiters.set(provider, own)
      })
  return { store, log, entered }
}

function blockNetwork(): { attempts: string[]; restore(): void } {
  const attempts: string[] = []
  const refuse = (name: string) => () => {
    attempts.push(name)
    throw new Error(`network I/O on the onboarding scan path: ${name}`)
  }
  const patches: Array<[Record<string, unknown>, string, unknown]> = []
  const patch = (target: Record<string, unknown>, key: string, name: string) => {
    patches.push([target, key, target[key]])
    target[key] = refuse(name)
  }
  patch(net.Socket.prototype as unknown as Record<string, unknown>, "connect", "net.Socket.connect")
  patch(net as unknown as Record<string, unknown>, "connect", "net.connect")
  patch(net as unknown as Record<string, unknown>, "createConnection", "net.createConnection")
  patch(tls as unknown as Record<string, unknown>, "connect", "tls.connect")
  patch(http as unknown as Record<string, unknown>, "request", "http.request")
  patch(http as unknown as Record<string, unknown>, "get", "http.get")
  patch(https as unknown as Record<string, unknown>, "request", "https.request")
  patch(https as unknown as Record<string, unknown>, "get", "https.get")
  patch(dgram as unknown as Record<string, unknown>, "createSocket", "dgram.createSocket")
  patch(globalThis as unknown as Record<string, unknown>, "fetch", "fetch")
  patch(Bun as unknown as Record<string, unknown>, "connect", "Bun.connect")
  return {
    attempts,
    restore() {
      for (const [target, key, original] of patches.reverse()) target[key] = original
    },
  }
}

function sourcesOf(events: readonly OnboardingScanEvent[]): string[] {
  return [...new Set(events.filter((event) => event.kind === "source_started").map((event) => event.source))]
}

describe("onboarding scan RPC", () => {
  test("#given the component registers #then it serves the scan and apply methods", () => {
    const host = register(emptyProfile())
    expect([...host.handlers.keys()].sort()).toEqual([ONBOARDING_APPLY_RPC_METHOD, ONBOARDING_SCAN_RPC_METHOD, ONBOARDING_UNDERSTAND_RPC_METHOD, ONBOARDING_UNDERSTAND_SKIP_RPC_METHOD, ONBOARDING_UNDERSTAND_STOP_RPC_METHOD].sort())
    expect(ONBOARDING_SCAN_RPC_METHOD).toBe("omo.onboarding.scan")
    expect(ONBOARDING_APPLY_RPC_METHOD).toBe("omo.onboarding.apply")
    expect(ONBOARDING_SCAN_RPC_EVENT).toBe("omo.onboarding.scan.event")
  })

  test("#given an OpenCode setup #when a scan runs with defaults #then each source streams started, items, done in order and custom providers stay off", async () => {
    const host = register(openCodeProfile())
    const { scanId, events } = await host.scan({})

    expect(sourcesOf(events)).toEqual(["detect", "credentials", "assets", "model-choices", "projects", "sessions"])
    for (const event of events) {
      expect(event.scanId).toBe(scanId)
      expect(typeof event.elapsedMs).toBe("number")
    }
    for (const source of sourcesOf(events)) {
      const own = events.filter((event) => event.source === source)
      expect(own[0]?.kind).toBe("source_started")
      expect(own.at(-1)?.kind).toBe("source_done")
      const items = own.filter((event) => event.kind === "item")
      expect(own.slice(1, -1)).toEqual(items)
      expect(own.at(-1)?.counts?.found).toBe(items.length)
    }
    const boundaries = events.filter((event) => event.kind === "source_started" || event.kind === "source_done").map((event) => `${event.kind}:${event.source}`)
    expect(boundaries).toEqual(sourcesOf(events).flatMap((source) => [`source_started:${source}`, `source_done:${source}`]))
    expect(events.at(-1)?.kind).toBe("done")
    const items = events.filter((event) => event.kind === "item").map((event) => event.item)
    expect(items).toContainEqual(expect.objectContaining({ id: "openai", kind: "api-key", state: "import" }))
    expect(items).toContainEqual(expect.objectContaining({ id: "ctx", kind: "mcp", state: "import" }))
    expect(JSON.stringify(events)).not.toContain(SECRET)
  })

  test("#given includeCustomProviders #when a scan runs #then the provider source streams too", async () => {
    const host = register(openCodeProfile())
    const { events } = await host.scan({ includeCustomProviders: true })
    expect(sourcesOf(events)).toEqual(["detect", "providers", "credentials", "assets", "model-choices", "projects", "sessions"])
    expect(events.filter((event) => event.kind === "item").map((event) => event.item)).toContainEqual(expect.objectContaining({ id: "myco", kind: "provider", state: "import" }))
  })

  test("#given no model configured and the network refused #when a scan and an apply of every stage run #then both complete without a socket or a model lookup", async () => {
    const profile = openCodeProfile()
    const host = register(profile, { authStore: () => fileStore(authPath(profile)) })
    const network = blockNetwork()
    let applied: OnboardingApplyResponse
    try {
      const { scanId } = await host.scan({ includeCustomProviders: true })
      applied = await host.apply({ scanId, stages: ["credentials", "assets", "providers", "model-choices"] })
    } finally {
      network.restore()
    }

    expect(network.attempts).toEqual([])
    expect(host.modelAccess).toEqual([])
    expect(applied).toEqual(expect.objectContaining({ applied: ["credentials", "assets", "providers", "model-choices"] }))
    expect(JSON.parse(readFileSync(join(profile.agentDir, "auth.json"), "utf8")).openai).toBeDefined()
    expect(JSON.parse(readFileSync(join(profile.agentDir, "mcp.json"), "utf8")).mcpServers.ctx).toBeDefined()
    expect(JSON.parse(readFileSync(join(profile.agentDir, "models.json"), "utf8")).providers.myco).toBeDefined()
  })

  test("#given a custom provider with a key and new credentials #when every stage applies #then the credentials write does not make the provider stage stale (#10496 review)", async () => {
    const profile = openCodeProfile()
    write(join(profile.home, ".local", "share", "opencode", "auth.json"), JSON.stringify({
      openai: { type: "api", key: SECRET },
      myco: { type: "api", key: `${SECRET}-myco` },
    }))
    const host = register(profile, { authStore: () => fileStore(authPath(profile)) })
    const { scanId } = await host.scan({ includeCustomProviders: true })

    const applied = await host.apply({ scanId, stages: ["credentials", "assets", "providers", "model-choices"] })

    expect(applied).toEqual(expect.objectContaining({ applied: ["credentials", "assets", "providers", "model-choices"] }))
    const auth = JSON.parse(readFileSync(authPath(profile), "utf8")) as Record<string, unknown>
    expect(auth.openai).toBeDefined()
    expect(auth.myco).toBeDefined()
    expect(JSON.parse(readFileSync(join(profile.agentDir, "models.json"), "utf8")).providers.myco).toBeDefined()
  })

  test("#given an empty profile #when a scan and an apply run #then they complete and write nothing", async () => {
    const profile = emptyProfile()
    const host = register(profile)
    const { scanId, events } = await host.scan({})
    expect(events.at(-1)?.kind).toBe("done")
    expect(events.filter((event) => event.kind === "source_failed")).toEqual([])
    const applied = await host.apply({ scanId, stages: ["credentials", "assets", "providers", "model-choices"] })
    expect(applied).toEqual(expect.objectContaining({ scanId, applied: [] }))
    expect(existsSync(profile.agentDir)).toBe(false)
  })

  test("#given a scan id the engine does not hold #when apply runs #then it answers unavailable and writes nothing", async () => {
    const profile = openCodeProfile()
    const host = register(profile)
    expect(await host.apply({ scanId: "missing", stages: ["credentials"] })).toEqual(expect.objectContaining({ kind: "unavailable" }))
    expect(existsSync(profile.agentDir)).toBe(false)
  })
})

describe("onboarding apply staleness", () => {
  test("#given the engine's auth.json changed between scan and apply #when apply runs #then it answers stale, names the path and the edit survives", async () => {
    const profile = openCodeProfile()
    const host = register(profile)
    const { scanId } = await host.scan({})

    // The engine refreshes a token under its own store after the scan read the file.
    await fileStore(authPath(profile)).modify("anthropic", async () => ({ type: "oauth", access: "a2", refresh: "r2", expires: 2 }))

    const response = await host.apply({ scanId, stages: ["credentials"] })
    expect(response).toEqual(expect.objectContaining({ kind: "stale" }))
    expect((response as { paths?: readonly string[] }).paths).toContain(authPath(profile))
    const auth = JSON.parse(readFileSync(authPath(profile), "utf8")) as { anthropic?: { refresh?: string }; openai?: unknown }
    expect(auth.anthropic?.refresh).toBe("r2")
    expect(auth.openai).toBeUndefined()
  })

  test("#given the asset target changed between scan and apply #when apply runs #then it answers stale and the user's server survives", async () => {
    const profile = openCodeProfile()
    const host = register(profile)
    const { scanId } = await host.scan({})
    const mcp = join(profile.agentDir, "mcp.json")
    write(mcp, JSON.stringify({ mcpServers: { "user-server": { type: "local", command: ["npx", "x"] } } }, null, 2))

    const response = await host.apply({ scanId, stages: ["assets"] })
    expect(response).toEqual(expect.objectContaining({ kind: "stale" }))
    expect((response as { paths?: readonly string[] }).paths).toContain(mcp)
    const servers = (JSON.parse(readFileSync(mcp, "utf8")) as { mcpServers: Record<string, unknown> }).mcpServers
    expect(servers["user-server"]).toBeDefined()
    expect(servers.ctx).toBeUndefined()
  })

  test("#given the provider target changed between scan and apply #when apply runs #then it answers stale and the user's provider survives", async () => {
    const profile = openCodeProfile()
    const host = register(profile)
    const { scanId } = await host.scan({ includeCustomProviders: true })
    const models = join(profile.agentDir, "models.json")
    write(models, JSON.stringify({ providers: { "user-provider": { name: "mine" } } }, null, 2))

    const response = await host.apply({ scanId, stages: ["providers"] })
    expect(response).toEqual(expect.objectContaining({ kind: "stale" }))
    expect((response as { paths?: readonly string[] }).paths).toContain(models)
    const providers = (JSON.parse(readFileSync(models, "utf8")) as { providers: Record<string, unknown> }).providers
    expect(providers["user-provider"]).toBeDefined()
    expect(providers.myco).toBeUndefined()
  })

  test("#given a retained scan older than ten minutes #when apply runs #then it answers stale with the expiry reason and writes nothing", async () => {
    const profile = openCodeProfile()
    let now = 1_000_000_000_000
    const host = register(profile, { now: () => now })
    const { scanId } = await host.scan({})
    now += 10 * 60_000 + 1

    const response = await host.apply({ scanId, stages: ["credentials"] })
    expect(response).toEqual(expect.objectContaining({ kind: "stale" }))
    expect((response as { reason?: string }).reason).toContain("expired")
    expect(existsSync(profile.agentDir)).toBe(false)
  })
})

describe("onboarding apply credential writes", () => {
  test("#given no engine credential store #when apply would write credentials #then it refuses and never writes an unlocked auth.json", async () => {
    const profile = openCodeProfile()
    const host = register(profile)
    const { scanId } = await host.scan({})

    const response = await host.apply({ scanId, stages: ["credentials"] })

    expect(response).toEqual(expect.objectContaining({ kind: "unavailable" }))
    expect((response as { reason?: string }).reason).toContain("credential store")
    expect(existsSync(authPath(profile))).toBe(false)
  })

  test("#given the engine's store arrives with session_start #when apply writes credentials #then it goes through that store", async () => {
    const profile = openCodeProfile()
    const host = register(profile)
    const log: string[] = []
    await host.dispatchEvent("session_start", { type: "session_start", reason: "startup" }, {
      modelRegistry: { authStorage: fileStore(authPath(profile), log) },
    })
    const { scanId } = await host.scan({})

    const response = await host.apply({ scanId, stages: ["credentials"] })

    expect(response).toEqual(expect.objectContaining({ applied: ["credentials"] }))
    expect(log).toContain("enter:openai")
    const auth = JSON.parse(readFileSync(authPath(profile), "utf8")) as { openai?: { type?: string; key?: string } }
    expect(auth.openai).toEqual({ type: "api_key", key: SECRET })
  })

  test("#given the engine refreshes a token under the store lock while an apply is in flight #when the apply writes #then the refreshed token is not reverted", async () => {
    const profile = openCodeProfile()
    const { store, log, entered } = gatedStore(authPath(profile))
    const host = register(profile, { authStore: () => store })
    const { scanId } = await host.scan({})

    // The refresh starts first and holds the store; the apply must queue behind it, not write past it.
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const refresh = store.modify("anthropic", async () => {
      await gate
      return { type: "oauth", access: "a2", refresh: "r2", expires: 2 }
    })
    const applied = host.apply({ scanId, stages: ["credentials"] })
    await Promise.race([entered("openai"), applied.then(() => "apply settled without the store")])
    release()
    await refresh
    const response = await applied

    expect(log).toContain("enter:openai")
    expect(response).toEqual(expect.objectContaining({ applied: ["credentials"] }))
    const auth = JSON.parse(readFileSync(authPath(profile), "utf8")) as Record<string, { refresh?: string; key?: string }>
    expect(auth.anthropic?.refresh).toBe("r2")
    expect(auth.openai?.key).toBe(SECRET)
  })
})

describe("onboarding scan and apply across sessions of one process", () => {
  // The desktop scans on one control session, which closes when the stream ends, then applies on a
  // new one: the retained scan has to outlive the session that ran it.
  test("#given a scan on session A #when session B applies it #then the apply succeeds and writes", async () => {
    const profile = openCodeProfile()
    // Production wiring: neither session is handed a store, so both use the process-wide one.
    const a = registerSession(profile, undefined)
    const b = registerSession(profile, undefined)
    const { scanId } = await a.scan({})

    const response = await b.apply({ scanId, stages: ["assets"] })

    expect(response).toEqual(expect.objectContaining({ scanId, applied: ["assets"] }))
    const servers = (JSON.parse(readFileSync(join(profile.agentDir, "mcp.json"), "utf8")) as { mcpServers: Record<string, unknown> }).mcpServers
    expect(servers.ctx).toBeDefined()
  })

  test("#given session B captured no credential store #when it applies session A's scan #then credentials go through the store the process captured last", async () => {
    const profile = openCodeProfile()
    const store = createOnboardingScanStore()
    const a = registerSession(profile, store)
    const log: string[] = []
    await a.dispatchEvent("session_start", { type: "session_start", reason: "startup" }, {
      modelRegistry: { authStorage: fileStore(authPath(profile), log) },
    })
    const { scanId } = await a.scan({})
    const b = registerSession(profile, store)

    const response = await b.apply({ scanId, stages: ["credentials"] })

    expect(response).toEqual(expect.objectContaining({ applied: ["credentials"] }))
    expect(log).toContain("enter:openai")
    const auth = JSON.parse(readFileSync(authPath(profile), "utf8")) as { openai?: { type?: string; key?: string } }
    expect(auth.openai).toEqual({ type: "api_key", key: SECRET })
  })

  test("#given session B applied session A's scan #when either session applies it again #then both answer unavailable", async () => {
    const profile = openCodeProfile()
    const store = createOnboardingScanStore()
    const a = registerSession(profile, store)
    const b = registerSession(profile, store)
    const { scanId } = await a.scan({})
    expect(await b.apply({ scanId, stages: ["assets"] })).toEqual(expect.objectContaining({ applied: ["assets"] }))

    expect(await b.apply({ scanId, stages: ["assets"] })).toEqual(expect.objectContaining({ kind: "unavailable" }))
    expect(await a.apply({ scanId, stages: ["assets"] })).toEqual(expect.objectContaining({ kind: "unavailable" }))
  })

  test("#given simultaneous applies of one scan from two sessions #when both run #then exactly one succeeds", async () => {
    const profile = openCodeProfile()
    const store = createOnboardingScanStore()
    const a = registerSession(profile, store)
    const b = registerSession(profile, store)
    const { scanId } = await a.scan({})

    const responses = await Promise.all([
      a.apply({ scanId, stages: ["assets"] }),
      b.apply({ scanId, stages: ["assets"] }),
    ])

    expect(responses.filter((response) => "applied" in response && (response as { applied: readonly string[] }).applied.includes("assets"))).toHaveLength(1)
    expect(responses.filter((response) => "kind" in response && response.kind === "unavailable")).toHaveLength(1)
  })

  test("#given session A's scan is older than ten minutes #when session B applies it #then it answers stale with the expiry reason and writes nothing", async () => {
    const profile = openCodeProfile()
    const store = createOnboardingScanStore()
    let now = 1_000_000_000_000
    const a = registerSession(profile, store, { now: () => now })
    const b = registerSession(profile, store, { now: () => now })
    const { scanId } = await a.scan({})
    now += 10 * 60_000 + 1

    const response = await b.apply({ scanId, stages: ["credentials"] })

    expect(response).toEqual(expect.objectContaining({ kind: "stale" }))
    expect((response as { reason?: string }).reason).toContain("expired")
    expect(existsSync(profile.agentDir)).toBe(false)
  })

  test("#given a target changed after session A's scan #when session B applies it #then it answers stale and the user's edit survives", async () => {
    const profile = openCodeProfile()
    const store = createOnboardingScanStore()
    const a = registerSession(profile, store)
    const b = registerSession(profile, store)
    const { scanId } = await a.scan({})
    const mcp = join(profile.agentDir, "mcp.json")
    write(mcp, JSON.stringify({ mcpServers: { "user-server": { type: "local", command: ["npx", "x"] } } }, null, 2))

    const response = await b.apply({ scanId, stages: ["assets"] })

    expect(response).toEqual(expect.objectContaining({ kind: "stale" }))
    expect((response as { paths?: readonly string[] }).paths).toContain(mcp)
    const servers = (JSON.parse(readFileSync(mcp, "utf8")) as { mcpServers: Record<string, unknown> }).mcpServers
    expect(servers["user-server"]).toBeDefined()
    expect(servers.ctx).toBeUndefined()
  })
})

describe("onboarding apply ordering and notice routing", () => {
  test("#given two simultaneous applies on one scan #when both run #then exactly one succeeds", async () => {
    const profile = openCodeProfile()
    const host = register(profile)
    const { scanId } = await host.scan({})

    const [first, second] = await Promise.all([
      host.apply({ scanId, stages: ["assets"] }),
      host.apply({ scanId, stages: ["assets"] }),
    ])

    const successes = [first, second].filter((response) => "applied" in response && (response as { applied: readonly string[] }).applied.includes("assets"))
    expect(successes).toHaveLength(1)
    const servers = (JSON.parse(readFileSync(join(profile.agentDir, "mcp.json"), "utf8")) as { mcpServers: Record<string, unknown> }).mcpServers
    expect(servers.ctx).toBeDefined()
  })

  test("#given a scan request #when the handler answers #then the scanId reply precedes the first event", async () => {
    const host = register(emptyProfile())
    const handler = host.handlers.get(ONBOARDING_SCAN_RPC_METHOD)
    if (handler === undefined) throw new Error("scan handler not registered")

    const response = await handler({}) as OnboardingScanResponse
    const eventsBeforeReply = host.events.length
    await host.waitForDone((response as { scanId: string }).scanId)

    expect("scanId" in response).toBe(true)
    expect(eventsBeforeReply).toBe(0)
  })

  test("#given a model-choice write that cannot land #when apply runs #then its warning rides the reply and never touches the engine's stdout", async () => {
    const profile = openCodeProfile()
    const host = register(profile)
    const { scanId } = await host.scan({})
    // A regular file where the agent directory should be: nothing can be created under it on any OS.
    // A 0o555 directory only refuses writes on POSIX; Windows ignores the mode bits (#10650).
    mkdirSync(dirname(profile.agentDir), { recursive: true })
    writeFileSync(profile.agentDir, "")
    const written: string[] = []
    const originalWrite = process.stdout.write
    process.stdout.write = ((chunk: unknown) => { written.push(String(chunk)); return true }) as typeof process.stdout.write
    let response: OnboardingApplyResponse
    try {
      response = await host.apply({ scanId, stages: ["model-choices"] })
    } finally {
      process.stdout.write = originalWrite
      rmSync(profile.agentDir, { force: true })
    }

    expect(written).toEqual([])
    expect(response).toEqual(expect.objectContaining({ notices: [expect.stringContaining("could not edit")] }))
  })
})
