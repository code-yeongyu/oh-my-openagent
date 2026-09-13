import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, realpathSync } from "node:fs"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { acquireRecallWakeLease, buildIdentityPaths, RecallLedger, RecallWakeBusyError } from "@oh-my-opencode/memory-core"
import type { OmoMemorySettings } from "@oh-my-opencode/omo-config-core"
import type { ChildSpec, RunnerOutcome, SenpiModelPort } from "@oh-my-opencode/senpi-task"

import { createMemoryBinding } from "../binding"
import { createMemoryIdentityContext, type MemoryIdentityContext } from "../context"
import { loadedMemoryConfig, MemoryFakeExtensionAPI, memorySettings } from "../memory.test-support"
import { GATE_SURFACE_HASH } from "../recall-drain"
import { readSession, RECALL_CUSTOM_TYPE } from "../recall-session-read"
import type { CollectedRecallCandidates } from "../recall-wiring"
import { createKibitzerComposition, kibitzerSidecarSessionDir, type KibitzerComposition } from "./index"
import { GATE_ENTRY_TYPE, NUDGED_ENTRY_TYPE } from "./notice"
import { kibitzerSidecarOwnerLockPath, kibitzerWakesFile, type KibitzerWakeRecord } from "./observe"
import { KIBITZER_SIDECAR_TOOL_NAMES } from "./sidecar-prompt"
import { candidate, fakeChild, withinMs, type FakeChild } from "./sidecar.test-support"
import type { AnyKibitzerSidecarTool } from "./tools/result"

const IDENTITY = "kibitzer-composition-agent"
const SESSION_A = "main-session-a"
const SESSION_B = "main-session-b"
const K8S = "reference/kubernetes-rollouts.md"
const HELM = "reference/helm-values.md"
const ISTIO = "reference/istio-retries.md"
const HINT = "Drain nodes before a rollout."
const completed: RunnerOutcome = { status: "completed", finalResponse: "", model: "omo-mock/mock-1" }

const model: SenpiModelPort = { provider: "omo-mock", id: "mock-1" }
const registry = {
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

async function harness(overrides: Partial<OmoMemorySettings> = {}): Promise<Harness> {
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

function prompt(text: string): unknown {
  return { type: "before_agent_start", prompt: text, systemPrompt: "BASE" }
}

function eventsOf(envelope: string): Array<{ cursor: number; kind: string }> {
  return [...envelope.matchAll(/<event cursor="(\d+)" kind="([a-z_]+)"/g)].map((match) => ({ cursor: Number(match[1]), kind: match[2] ?? "" }))
}

/** The session's `wakes.ndjson`, parsed, from the directory the child transcript is written to. */
async function wakesOf(context: MemoryIdentityContext, sessionId: string): Promise<KibitzerWakeRecord[]> {
  const text = await readFile(kibitzerWakesFile(context.identityPaths.recall, sessionId), "utf8")
  return text.trimEnd().split("\n").map((line) => JSON.parse(line) as KibitzerWakeRecord)
}

describe("kibitzerSidecarSessionDir", () => {
  test("#given distinct parent session ids #when their sidecar directories are derived #then each is URL-safe base64 of the id, unpadded, under recall/sidecars", () => {
    expect(kibitzerSidecarSessionDir("/state/recall", "parent-1")).toBe(join("/state/recall", "sidecars", "cGFyZW50LTE"))
    const ids = ["parent-1", "parent-2", "a/b?c", "a_b-c", "세션", "x".repeat(70)]
    const dirs = ids.map((id) => kibitzerSidecarSessionDir("/state/recall", id))
    expect(new Set(dirs).size).toBe(ids.length)
    for (const dir of dirs) expect(dir.slice(join("/state/recall", "sidecars").length + 1)).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})

describe("createKibitzerComposition", () => {
  test("#given two main sessions bound to one identity #when their hooks fire #then each session owns exactly one resident sidecar and the identity owns none", async () => {
    const f = await harness()
    f.script(SESSION_A, [K8S])
    f.script(SESSION_B, [HELM])

    await f.dispatch("before_agent_start", prompt("how do we handle kubernetes rollouts"), SESSION_A, 1)
    const childA = await f.nextChild()
    await f.dispatch("tool_call", { toolName: "read", toolCallId: "call-1", input: { path: "deploy/rollout.yaml" } }, SESSION_A, 2)
    await f.dispatch("tool_result", { toolName: "read", toolCallId: "call-1", content: [{ type: "text", text: "replicas: 3" }] }, SESSION_A, 3)
    await f.dispatch("before_agent_start", prompt("which helm values do we pin"), SESSION_B, 1)
    const childB = await f.nextChild()
    await f.dispatch("tool_call", { toolName: "read", input: { path: "README.md" } }, "unbound-session", 1)
    childA.settle(completed)
    childB.settle(completed)
    await f.composition.whenIdle()

    expect(f.specs.map((spec) => spec.taskId)).toEqual([`kibitzer-${SESSION_A}-1`, `kibitzer-${SESSION_B}-1`])
    expect(f.composition.activeSessions()).toEqual([SESSION_A, SESSION_B])
    expect(f.children).toHaveLength(2)
    // Three hooks on session A, one child: the repeated candidate never wakes it a second time.
    expect(childA.steers).toHaveLength(0)
    expect(childA.followUps).toHaveLength(0)
    expect(childB.input.sessionId).toBe(SESSION_B)
    const [specA, specB] = f.specs
    expect(specA?.sessionDir).toBe(kibitzerSidecarSessionDir(f.context.identityPaths.recall, SESSION_A))
    expect(specB?.sessionDir).toBe(kibitzerSidecarSessionDir(f.context.identityPaths.recall, SESSION_B))
    expect(specA?.cwd).toBe(f.root)
    expect(specA?.toolAllowlist).toEqual([...KIBITZER_SIDECAR_TOOL_NAMES])
    expect(specA?.memberScopedTools?.map((tool) => tool.name)).toEqual([...KIBITZER_SIDECAR_TOOL_NAMES])
    // The registry the child threads into its session is the one captured synchronously at the hook.
    expect(specA?.modelRegistry).toBe(registry as unknown as ChildSpec["modelRegistry"])
    expect(specA?.selectedModel).toBe("omo-mock/mock-1")
    // Observability: one `wakes.ndjson` line per settled wake, in the directory the child transcript lives in,
    // and the live session's directory is owned through its lock for as long as the sidecar exists.
    for (const [sessionId, spec] of [[SESSION_A, specA], [SESSION_B, specB]] as const) {
      expect(kibitzerWakesFile(f.context.identityPaths.recall, sessionId)).toBe(join(spec?.sessionDir ?? "", "wakes.ndjson"))
      const wakes = await wakesOf(f.context, sessionId)
      expect(wakes.map((record) => [record.sessionId, record.wake, record.status, record.model, record.diagnostic])).toEqual([[sessionId, 1, "completed", "omo-mock/mock-1", false]])
      // Both wakes were seeded at the prompt (cursor 1); the later hooks on session A carried no new candidate and never joined the turn.
      expect(wakes[0]?.cursors).toEqual({ first: 1, last: 1 })
      expect(existsSync(kibitzerSidecarOwnerLockPath(f.context.identityPaths.locks, sessionId))).toBe(true)
    }
    expect(f.pi.entries.filter((entry) => entry.customType === GATE_ENTRY_TYPE)).toEqual([])
    expect(f.warnings).toEqual([])
  })

  test("#given recall disabled or an unbound session #when hooks fire #then no sidecar is created and nothing is collected", async () => {
    const f = await harness({ recall: { ...memorySettings().recall, enabled: false } })
    f.script(SESSION_A, [K8S])

    await f.dispatch("before_agent_start", prompt("how do we handle kubernetes rollouts"), SESSION_A, 1)
    await f.dispatch("tool_call", { toolName: "read", input: { path: "deploy/rollout.yaml" } }, SESSION_A, 2)
    await f.dispatch("tool_call", { toolName: "read", input: { path: "deploy/rollout.yaml" } }, "unbound-session", 2)
    await f.composition.whenIdle()

    expect(f.composition.activeSessions()).toEqual([])
    expect(f.specs).toEqual([])
    expect(f.collections).toEqual([])
    expect(f.warnings).toEqual([])
  })

  test("#given a host that disposes the ctx when each handler returns (disposed context) #when prompt, tool_call and tool_result fire #then every event was captured synchronously and the seed carries all of them", async () => {
    const f = await harness()
    f.script(SESSION_A, [])

    await f.dispatch("before_agent_start", prompt("how do we handle kubernetes rollouts"), SESSION_A, 1)
    await f.dispatch("tool_call", { toolName: "eval", toolCallId: "call-1", input: { code: "x".repeat(90_000), summary: "list rollout manifests" } }, SESSION_A, 2)
    await f.dispatch("tool_result", { toolName: "eval", toolCallId: "call-1", content: [{ type: "text", text: "deploy/rollout.yaml\ndeploy/canary.yaml" }] }, SESSION_A, 3)
    // Only now does a memory match appear; the wake must still carry everything captured before it.
    f.script(SESSION_A, [K8S])
    await f.dispatch("tool_call", { toolName: "read", toolCallId: "call-2", input: { path: "deploy/rollout.yaml" } }, SESSION_A, 4)
    const child = await f.nextChild()

    // The branch alternates user/assistant turns, so each hook that reveals a new assistant message
    // emits it once ahead of its own event.
    expect(eventsOf(child.input.prompt)).toEqual([
      { cursor: 1, kind: "prompt" },
      { cursor: 2, kind: "assistant" },
      { cursor: 2, kind: "tool_call" },
      { cursor: 3, kind: "tool_result" },
      { cursor: 4, kind: "assistant" },
      { cursor: 4, kind: "tool_call" },
    ])
    expect(child.input.prompt).toContain("how do we handle kubernetes rollouts")
    expect(child.input.prompt).toContain("turn 3")
    expect(child.input.prompt).toContain("list rollout manifests")
    expect(child.input.prompt).not.toContain("x".repeat(500))
    expect(child.input.prompt).toContain("deploy/canary.yaml")
    // The prompt carries its own text as a planner hint; tool calls carry the harvested argument window.
    expect(f.collections.map((entry) => entry.extraTexts)).toEqual([
      ["how do we handle kubernetes rollouts"],
      ["list rollout manifests"],
      ["list rollout manifests", "rollout.yaml", "rollout", "yaml"],
    ])
    expect(f.warnings).toEqual([])
  })

  test("#given a resident child that nudges #when its turn settles #then the nudge is ledger-marked, steered into the running turn once, and the accepted cooldown parks the third wake", async () => {
    const f = await harness()
    f.script(SESSION_A, [K8S])

    await f.dispatch("before_agent_start", prompt("how do we handle kubernetes rollouts"), SESSION_A, 1)
    const child = await f.nextChild()
    expect((await child.nudge(K8S, HINT)).isError).not.toBe(true)
    child.settle(completed)
    await f.composition.whenIdle()

    // Accept time: the ledger already holds the path before anything is steered.
    const ledger = new RecallLedger(f.context.identityPaths.recallLedger)
    expect(await ledger.surfacedPaths(SESSION_A)).toEqual(new Set([K8S]))
    const ledgerFile = JSON.parse(await readFile(join(f.context.identityPaths.recallLedger, `${SESSION_A}.json`), "utf8")) as { surfaced: Record<string, { hash: string }> }
    expect(ledgerFile.surfaced[K8S]?.hash).toBe(GATE_SURFACE_HASH)
    // The main turn is still running (before_agent_start marked it), so delivery steers at once and
    // the next tool_result has nothing left to steer.
    expect(f.pi.messages).toHaveLength(1)
    await f.dispatch("tool_result", { toolName: "read", content: [{ type: "text", text: "ok" }] }, SESSION_A, 2)
    expect(f.pi.messages).toHaveLength(1)
    expect(f.pi.messages[0]?.options).toEqual({ deliverAs: "steer" })
    expect(f.pi.messages[0]?.message).toMatchObject({ customType: RECALL_CUSTOM_TYPE, display: false })
    expect(String(f.pi.messages[0]?.message.content)).toContain(HINT)
    const nudged = f.pi.entries.filter((entry) => entry.customType === NUDGED_ENTRY_TYPE)
    expect(nudged).toHaveLength(1)
    expect(nudged[0]?.data).toEqual({ version: 1, nudges: [{ path: K8S, hint: HINT }], via: "steer" })

    // Second accepted wake inside the window: still delivered.
    f.script(SESSION_A, [HELM])
    const revived = f.nextFollowUp()
    await f.dispatch("tool_call", { toolName: "read", input: { path: "charts/values.yaml" } }, SESSION_A, 3)
    await revived
    expect(child.followUps).toHaveLength(1)
    expect((await child.nudge(HELM, "Pin chart versions in values.")).isError).not.toBe(true)
    child.settle(completed)
    await f.composition.whenIdle()
    expect(await ledger.surfacedPaths(SESSION_A)).toEqual(new Set([K8S, HELM]))
    expect(f.pi.messages).toHaveLength(2)

    // Third fresh candidate: two accepted wakes in ten minutes, so the sidecar buffers without a turn.
    f.script(SESSION_A, [ISTIO])
    await f.dispatch("tool_call", { toolName: "read", input: { path: "mesh/retries.yaml" } }, SESSION_A, 4)
    await f.composition.whenIdle()
    expect(child.followUps).toHaveLength(1)
    expect(child.steers).toHaveLength(0)
    expect(f.specs).toHaveLength(1)
    expect(await ledger.surfacedPaths(SESSION_A)).toEqual(new Set([K8S, HELM]))
    expect(f.warnings).toEqual([])
  })

  test("#given a running wake holding the machine slot #when the session shuts down (shutdown no recreation) #then the child is aborted and disposed, the lease is released, and a racing offer starts nothing", async () => {
    const f = await harness({ recall: { ...memorySettings().recall, max_concurrent_wakes: 1 } })
    f.script(SESSION_A, [K8S])
    const locks = f.context.identityPaths.locks

    await f.dispatch("before_agent_start", prompt("how do we handle kubernetes rollouts"), SESSION_A, 1)
    const child = await f.nextChild()
    // The wake holds the only slot, and this live process is never reclaimed as a dead owner.
    await expect(acquireRecallWakeLease(locks, { maxConcurrent: 1, waitTimeoutMs: 0 })).rejects.toBeInstanceOf(RecallWakeBusyError)

    // An offer still collecting while the session goes away must find a disposed sidecar, not seed a new child.
    f.script(SESSION_A, [HELM])
    const release = f.holdNextCollection()
    await f.dispatch("tool_call", { toolName: "read", input: { path: "charts/values.yaml" } }, SESSION_A, 2)
    await withinMs(f.composition.onSessionShutdown(SESSION_A), "session shutdown")
    release()
    await f.composition.whenIdle()

    expect(child.aborts).toBe(1)
    expect(child.disposed).toBe(true)
    expect(f.composition.activeSessions()).toEqual([])
    expect(f.specs).toHaveLength(1)
    expect(f.pi.messages).toEqual([])
    const lease = await acquireRecallWakeLease(locks, { maxConcurrent: 1, waitTimeoutMs: 0 })
    expect(await lease.release()).toBe(true)
    // The cancelled wake is the session's one audit line, durable before shutdown resolved; the directory lock is gone with the session.
    expect((await wakesOf(f.context, SESSION_A)).map((record) => [record.wake, record.status, record.cause, record.diagnostic])).toEqual([[1, "cancelled", "shutdown", false]])
    expect(existsSync(kibitzerSidecarOwnerLockPath(locks, SESSION_A))).toBe(false)
    expect(existsSync(kibitzerSidecarSessionDir(f.context.identityPaths.recall, SESSION_A))).toBe(true)

    // The host releases the binding with the session: a late hook for the old id creates nothing.
    f.sessions.delete(SESSION_A)
    await f.dispatch("tool_call", { toolName: "read", input: { path: "charts/values.yaml" } }, SESSION_A, 3)
    await f.composition.whenIdle()
    expect(f.specs).toHaveLength(1)
    expect(f.composition.activeSessions()).toEqual([])
    expect(f.warnings).toEqual([])
  })
})
