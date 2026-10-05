import { afterEach } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildIdentityPaths, RecallLedger } from "@oh-my-opencode/memory-core"
import type { OmoMemorySettings } from "@oh-my-opencode/omo-config-core"
import type { ChildSpec, SenpiModelPort } from "@oh-my-opencode/senpi-task"
import { createMemoryBinding } from "../binding"
import { createMemoryIdentityContext, type MemoryIdentityContext } from "../context"
import { loadedMemoryConfig, MemoryFakeExtensionAPI, memorySettings } from "../memory.test-support"
import { readSession } from "../recall-session-read"
import type { CollectedRecallCandidates } from "../recall-wiring"
import { createKibitzerComposition, type KibitzerComposition } from "./index"
import { candidate, fakeChild, withinMs, type FakeChild } from "./sidecar.test-support"
import type { AnyKibitzerSidecarTool } from "./tools/result"

const IDENTITY = "kibitzer-composition-agent"
export const SESSION_A = "main-session-a"
export const SESSION_B = "main-session-b"

const model: SenpiModelPort = { provider: "omo-mock", id: "mock-1" }
export const registry = {
  getAvailable: () => [model],
  find: (provider: string, modelId: string) => (provider === model.provider && modelId === model.id ? model : undefined),
  getProviderAuth: () => undefined,
}

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

interface Harness {
  readonly root: string
  readonly context: MemoryIdentityContext
  readonly sessions: Map<string, MemoryIdentityContext>
  readonly pi: MemoryFakeExtensionAPI
  readonly composition: KibitzerComposition
  readonly specs: ChildSpec[]
  readonly children: FakeChild[]
  readonly collections: Array<{ readonly sessionId: string; readonly extraTexts: readonly string[] }>
  readonly warnings: Array<{ readonly message: string; readonly details: unknown }>
  /** Resolves when the sidecar next revives a child through `followUp` (an explicit signal, never a sleep). */
  nextFollowUp(): Promise<void>
  /** Candidate paths the scripted collector answers per session; empty means "nothing matched". */
  script(sessionId: string, paths: readonly string[]): void
  /** Holds the next collection until released: the ctx is long disposed by the time it answers. */
  holdNextCollection(): () => void
  nextChild(): Promise<FakeChild>
  /** A host event context that throws on every read once `disposed` is set, like senpi's `assertActive`. */
  eventCtx(sessionId: string, branchLength: number): { readonly ctx: Record<string, unknown>; dispose(): void }
  dispatch(event: string, payload: unknown, sessionId: string, branchLength: number): Promise<unknown[]>
}

export async function harness(overrides: Partial<OmoMemorySettings> = {}): Promise<Harness> {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "omo-kibitzer-composition-")))
  roots.push(root)
  const identityPaths = buildIdentityPaths(join(root, "memory"), IDENTITY)
  const context = createMemoryIdentityContext({
    identity: IDENTITY,
    identityPaths,
    binding: createMemoryBinding({ identity: IDENTITY, repoPath: identityPaths.repo, boundAt: 1 }),
  })
  const sessions = new Map<string, MemoryIdentityContext>([[SESSION_A, context], [SESSION_B, context]])
  const scripted = new Map<string, readonly string[]>()
  const specs: ChildSpec[] = []
  const children: FakeChild[] = []
  const childWaiters: Array<(child: FakeChild) => void> = []
  const followUpWaiters: Array<() => void> = []
  const collections: Harness["collections"] = []
  const warnings: Harness["warnings"] = []
  let held: Promise<void> | undefined
  const memory = memorySettings(overrides)
  const pi = new MemoryFakeExtensionAPI()
  const resolveContext = (sessionId: string): MemoryIdentityContext | undefined => sessions.get(sessionId)
  const composition = createKibitzerComposition({
    env: {},
    cwd: () => root,
    loadConfig: () => ({ ...loadedMemoryConfig(memory), config: { memory, categories: { quick: { model: "omo-mock/mock-1" } } } }),
    resolveContext,
    recall: {
      snapshotSession: (eventCtx) => {
        try {
          return readSession(eventCtx)
        } catch {
          return undefined
        }
      },
      collectCandidatesFromSnapshot: async (snapshot, extraTexts = []): Promise<CollectedRecallCandidates | undefined> => {
        collections.push({ sessionId: snapshot.id, extraTexts })
        // A real collection awaits git: by then the host has disposed the ctx behind `snapshot`.
        await (held ?? Promise.resolve())
        const bound = resolveContext(snapshot.id)
        const paths = scripted.get(snapshot.id) ?? []
        if (bound === undefined || paths.length === 0) return undefined
        return {
          sessionId: snapshot.id,
          context: bound,
          candidates: paths.map((path) => candidate(path)),
          surfaced: await new RecallLedger(bound.identityPaths.recallLedger).surfacedPaths(snapshot.id),
          maxItems: 2,
          transcript: [],
        }
      },
    },
    sendMessage: (message, sendOptions) => pi.sendMessage(message, sendOptions),
    appendEntry: (customType, data) => pi.appendEntry(customType, data),
    childStarter: {
      createRunner: () => ({
        start: async (spec) => {
          specs.push(spec)
          const generation = specs.filter((entry) => entry.parentSessionId === spec.parentSessionId).length
          const child = fakeChild({
            sessionId: spec.parentSessionId,
            generation,
            prompt: spec.prompt,
            tools: (spec.memberScopedTools ?? []) as readonly AnyKibitzerSidecarTool[],
            maxItems: 2,
          })
          children.push(child)
          for (const waiter of childWaiters.splice(0)) waiter(child)
          // The fake handle's methods close over the fake, not `this`, so a wrapped copy is safe.
          return {
            ...child.handle,
            async followUp(text) {
              await child.handle.followUp(text)
              for (const waiter of followUpWaiters.splice(0)) waiter()
            },
          }
        },
      }),
    },
    logger: { info: () => {}, warn: (message, details) => { warnings.push({ message, details }) }, error: () => {} },
  })
  composition.registerHooks(pi)

  function eventCtx(sessionId: string, branchLength: number): { readonly ctx: Record<string, unknown>; dispose(): void } {
    let disposed = false
    const guard = <T>(value: T): T => {
      if (disposed) throw new Error("event context disposed")
      return value
    }
    const branch = Array.from({ length: branchLength }, (_, index) => ({
      type: "message",
      id: `${sessionId}-${index}`,
      message: { role: index % 2 === 0 ? "user" : "assistant", content: [{ type: "text", text: `turn ${index}` }] },
    }))
    const ctx = {
      sessionManager: { getSessionId: () => guard(sessionId), getBranch: () => guard(branch), getEntries: () => guard(branch) },
      get modelRegistry(): unknown { return guard(registry) },
      hasPendingMessages: () => guard(false),
      isIdle: () => guard(false),
    }
    return { ctx, dispose: () => { disposed = true } }
  }

  return {
    root,
    context,
    sessions,
    pi,
    composition,
    specs,
    children,
    collections,
    warnings,
    script: (sessionId, paths) => { scripted.set(sessionId, paths) },
    holdNextCollection() {
      let release: () => void = () => {}
      held = new Promise<void>((resolve) => { release = resolve })
      return () => { held = undefined; release() }
    },
    nextChild: () => withinMs(new Promise<FakeChild>((resolve) => childWaiters.push(resolve)), "the next resident child"),
    nextFollowUp: () => withinMs(new Promise<void>((resolve) => followUpWaiters.push(resolve)), "the next followUp"),
    eventCtx,
    async dispatch(event, payload, sessionId, branchLength) {
      const host = eventCtx(sessionId, branchLength)
      const results = await pi.dispatch(event, payload, host.ctx)
      host.dispose()
      return results
    },
  }
}
