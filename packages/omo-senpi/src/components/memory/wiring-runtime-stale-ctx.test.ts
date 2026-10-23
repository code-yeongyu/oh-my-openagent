import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"

import { buildIdentityPaths, type ReservedRun } from "@oh-my-opencode/memory-core"

import { createMemoryIdentityContext, type MemoryIdentityContext } from "./context"
import type { MemoryIdentityRuntime, MemoryIdentityRuntimeDeps } from "./identity-runtime"
import { loadedMemoryConfig, memorySettings } from "./memory.test-support"
import { withLaunchScope } from "./launch-facts"
import { createMemoryRuntimeWiring } from "./wiring-runtime"

// Regression coverage for https://github.com/code-yeongyu/oh-my-openagent/issues/10339: the
// reflection launch resolves its model registry, session model and parent session facts from the
// event ctx captured when the trigger fired. The launch itself runs later; if the session was
// replaced or reloaded in between, every read of that captured ctx throws, and the launch died.

const SESSION = "session-10339"
const NEW_SESSION_MESSAGE =
  "This extension ctx is stale after session replacement or reload. Do not use a captured pi or command ctx after ctx.newSession(), ctx.fork(), ctx.switchSession(), or ctx.reload()."
const RUNTIME_RELOAD_MESSAGE = "stale extension generation after reload"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

describe("reflection launch after the trigger ctx is retired (#10339)", () => {
  test.each([
    ["ctx.newSession()", NEW_SESSION_MESSAGE],
    ["ctx.fork()", NEW_SESSION_MESSAGE],
    ["ctx.switchSession()", NEW_SESSION_MESSAGE],
    ["ctx.reload()", NEW_SESSION_MESSAGE],
    ["a runtime reload", RUNTIME_RELOAD_MESSAGE],
  ])("#given a reflection triggered on a live session #when %s retires its ctx before the launch resolves #then the launch still gets the triggering session's facts", async (_path, message) => {
    // given
    const root = await mkdtemp(`${tmpdir()}/omo-10339-`)
    roots.push(root)
    const identity = createMemoryIdentityContext({
      identity: "agent-10339",
      identityPaths: buildIdentityPaths(root, "agent-10339"),
      binding: { identity: "agent-10339", repoPathHash: "hash", boundAt: 1 },
    })
    const registry = { find: () => undefined, getProviderAuth: () => undefined }
    const live = retirableContext(message, {
      sessionManager: {
        getSessionId: () => SESSION,
        getSessionFile: () => `${root}/session.jsonl`,
        getUsageTotals: () => ({ cacheRead: 42 }),
      },
      modelRegistry: registry,
      model: { provider: "anthropic", id: "claude-test" },
      getContextUsage: () => ({ tokens: 1234 }),
      agentDir: root,
    })
    const lastEventCtx: { current?: unknown } = {}
    let launched: (() => void) | undefined
    let deps: MemoryIdentityRuntimeDeps | undefined
    const wiring = createMemoryRuntimeWiring({
      sessions: new Map([[SESSION, { context: identity } as never]]),
      loadConfig: () => loadedMemoryConfig(memorySettings()),
      cwd: () => root,
      env: {},
      createRuntime: (_identity, runtimeDeps) => {
        deps = runtimeDeps
        return fakeRuntime(identity, () => launched?.())
      },
    }, lastEventCtx)
    const resolved = new Promise<Record<string, unknown>>((resolve, reject) => {
      // The real launch resolves these asynchronously, after the trigger handler returned.
      launched = () => {
        queueMicrotask(() => {
          try {
            live.retire()
            // The successor's session_start / bind makes ITS ctx the current one before the launch reads.
            lastEventCtx.current = successorContext()
            resolve({
              registry: deps?.resolveModelRegistry(),
              tokens: deps?.resolveParentContextTokens?.(),
              file: deps?.resolveParentSessionFile?.(),
              cacheReusable: deps?.resolveParentCacheReusable?.(),
              agentDir: deps?.resolveAgentDir?.(),
            })
          } catch (error) {
            reject(error)
          }
        })
      }
    })

    // when
    await wiring.triggerSessionFor(live.ctx)?.engine.evaluate(SESSION, { kind: "settled" } as never)

    // then
    expect(await resolved).toEqual({
      registry,
      tokens: 1234,
      file: `${root}/session.jsonl`,
      cacheReusable: true,
      agentDir: root,
    })
  }, 30_000)
})

/** A live ctx of the session that replaced the triggering one: none of its facts may reach that launch. */
describe("a launch without a trigger snapshot (#10339)", () => {
  test("#given a reconcile launch for session A while session B is current #when it resolves its facts #then it gets none of B's session facts, only the shared model registry", async () => {
    // given
    const root = await mkdtemp(`${tmpdir()}/omo-10339-rec-`)
    roots.push(root)
    const identity = createMemoryIdentityContext({
      identity: "agent-10339",
      identityPaths: buildIdentityPaths(root, "agent-10339"),
      binding: { identity: "agent-10339", repoPathHash: "hash", boundAt: 1 },
    })
    const lastEventCtx: { current?: unknown } = { current: successorContext() }
    let deps: MemoryIdentityRuntimeDeps | undefined
    const wiring = createMemoryRuntimeWiring({
      sessions: new Map(),
      loadConfig: () => loadedMemoryConfig(memorySettings()),
      cwd: () => root,
      env: {},
      createRuntime: (_identity, runtimeDeps) => {
        deps = runtimeDeps
        return fakeRuntime(identity, () => {})
      },
    }, lastEventCtx)
    wiring.runtimeFor(identity)

    // when: the launch for A runs in A's scope (what identity-runtime gives a reconcile or follow-up run)
    const facts = withLaunchScope({ conversationIds: ["A"] }, () => ({
      registry: deps?.resolveModelRegistry() !== undefined,
      file: deps?.resolveParentSessionFile?.(),
      tokens: deps?.resolveParentContextTokens?.(),
      model: deps?.resolveSessionModel?.(),
    }))

    // then
    expect(facts).toEqual({ registry: true, file: undefined, tokens: undefined, model: undefined })
  }, 30_000)
})

describe("facts extraction outside a launch scope (#10339)", () => {
  test("#given session B is current #when a facts launch without a captured selection resolves its model #then it gets no session model, only the shared registry", async () => {
    // given: a facts launch that was not handed a selection (unpark, reconcile, final delta) reads the
    // resolvers directly; whatever session is current must not choose the model for another session's facts.
    const root = await mkdtemp(`${tmpdir()}/omo-10339-facts-`)
    roots.push(root)
    const identity = createMemoryIdentityContext({
      identity: "agent-10339",
      identityPaths: buildIdentityPaths(root, "agent-10339"),
      binding: { identity: "agent-10339", repoPathHash: "hash", boundAt: 1 },
    })
    let extractor: { resolveModelRegistry: () => unknown; resolveSessionModel?: () => unknown } | undefined
    const wiring = createMemoryRuntimeWiring({
      sessions: new Map(),
      loadConfig: () => loadedMemoryConfig(memorySettings()),
      cwd: () => root,
      env: {},
      createFactsExtractor: (options) => {
        extractor = options
        return { launchPending: async () => ({ status: "empty" }), reconcilePending: async () => ({ status: "empty" }) }
      },
    }, { current: successorContext() })

    // when
    wiring.factsWiringFor(identity)

    // then
    expect(extractor?.resolveModelRegistry()).toBeDefined()
    expect(extractor?.resolveSessionModel?.()).toBeUndefined()
  }, 30_000)
})

function successorContext(): unknown {
  return {
    sessionManager: {
      getSessionId: () => "session-B",
      getSessionFile: () => "/B.jsonl",
      getUsageTotals: () => ({ cacheRead: 0 }),
    },
    modelRegistry: { find: () => undefined, getProviderAuth: () => undefined },
    model: { provider: "openai", id: "other" },
    getContextUsage: () => ({ tokens: 9 }),
    agentDir: "/B",
  }
}

describe("reflection launch facts are per run (#10339)", () => {
  test("#given two sessions that each trigger a reflection #when both launches resolve after both triggers #then each launch gets its own session's facts", async () => {
    // given
    const root = await mkdtemp(`${tmpdir()}/omo-10339-two-`)
    roots.push(root)
    const identity = createMemoryIdentityContext({
      identity: "agent-10339",
      identityPaths: buildIdentityPaths(root, "agent-10339"),
      binding: { identity: "agent-10339", repoPathHash: "hash", boundAt: 1 },
    })
    const ctxFor = (id: string) => ({
      sessionManager: { getSessionId: () => id, getSessionFile: () => `/${id}.jsonl`, getUsageTotals: () => ({ cacheRead: 0 }) },
      getContextUsage: () => ({ tokens: id.length }),
    })
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    const seen: Record<string, string | undefined> = {}
    let deps: MemoryIdentityRuntimeDeps | undefined
    const launches: Promise<void>[] = []
    const wiring = createMemoryRuntimeWiring({
      sessions: new Map([["A", { context: identity } as never], ["BB", { context: identity } as never]]),
      loadConfig: () => loadedMemoryConfig(memorySettings()),
      cwd: () => root,
      env: {},
      createRuntime: (_identity, runtimeDeps) => {
        deps = runtimeDeps
        return {
          identity,
          store: { evaluate: async (conversationId: string) => ({ status: "active", run: { runId: `run-${conversationId}`, request: { trigger: "settle", conversationIds: [conversationId], snapshots: [] } } }) },
          // Each launch waits until BOTH triggers have fired, then reads its facts (after an await,
          // like the real runner's late reads).
          launch: (run: { request: { conversationIds: readonly string[] } }) => {
            const done = gate.then(() => { seen[run.request.conversationIds[0] ?? ""] = deps?.resolveParentSessionFile?.() })
            launches.push(done)
            return done
          },
          reconcile: async () => {},
        } as unknown as MemoryIdentityRuntime
      },
    }, {})

    // when
    await wiring.triggerSessionFor(ctxFor("A"))?.engine.evaluate("A", { kind: "settled" } as never)
    await wiring.triggerSessionFor(ctxFor("BB"))?.engine.evaluate("BB", { kind: "settled" } as never)
    release()
    await Promise.all(launches)

    // then
    expect(seen).toEqual({ A: "/A.jsonl", BB: "/BB.jsonl" })
  }, 30_000)

  test("#given a ctx whose details cannot be read at trigger time #when the trigger fires #then the reservation still proceeds", async () => {
    // given
    const root = await mkdtemp(`${tmpdir()}/omo-10339-err-`)
    roots.push(root)
    const identity = createMemoryIdentityContext({
      identity: "agent-10339",
      identityPaths: buildIdentityPaths(root, "agent-10339"),
      binding: { identity: "agent-10339", repoPathHash: "hash", boundAt: 1 },
    })
    let evaluated = 0
    const warnings: string[] = []
    const wiring = createMemoryRuntimeWiring({
      sessions: new Map([[SESSION, { context: identity } as never]]),
      loadConfig: () => loadedMemoryConfig(memorySettings()),
      cwd: () => root,
      env: {},
      logger: { warn: (message: string) => warnings.push(message), info: () => {}, error: () => {}, debug: () => {} } as never,
      createRuntime: () => ({
        identity,
        store: { evaluate: async () => { evaluated++; return { status: "idle" } } },
        launch: async () => {},
        reconcile: async () => {},
      }) as unknown as MemoryIdentityRuntime,
    }, {})
    const ctx = {
      sessionManager: { getSessionId: () => SESSION },
      getContextUsage: () => { throw new Error("usage unavailable") },
    }

    // when
    await wiring.triggerSessionFor(ctx)?.engine.evaluate(SESSION, { kind: "settled" } as never)

    // then
    expect(evaluated).toBe(1)
    expect(warnings).toHaveLength(1)
  }, 30_000)
})

function fakeRuntime(identity: MemoryIdentityContext, onLaunch: () => void): MemoryIdentityRuntime {
  const run = { runId: "run-10339", request: { trigger: "settle", conversationIds: [SESSION], snapshots: [] } } as unknown as ReservedRun
  return {
    identity,
    store: { evaluate: async () => ({ status: "active", run }) },
    launch: async () => onLaunch(),
    reconcile: async () => {},
  } as unknown as MemoryIdentityRuntime
}

/** Every getter on the ctx throws the host's stale-ctx error once retired, as the engine's guard does. */
function retirableContext(message: string, shape: Record<string, unknown>): { readonly ctx: unknown; readonly retire: () => void } {
  let retired = false
  const guard = (value: unknown): unknown => {
    if (typeof value === "function") {
      return (...args: unknown[]) => {
        if (retired) throw new Error(message)
        return Reflect.apply(value as (...a: unknown[]) => unknown, undefined, args)
      }
    }
    if (value !== null && typeof value === "object" && !Array.isArray(value) && !("find" in value)) {
      return wrap(value as Record<string, unknown>)
    }
    return value
  }
  const wrap = (target: Record<string, unknown>): Record<string, unknown> =>
    new Proxy(target, {
      get(object, key) {
        if (retired) throw new Error(message)
        return guard(Reflect.get(object, key))
      },
    })
  return { ctx: wrap(shape), retire: () => { retired = true } }
}
