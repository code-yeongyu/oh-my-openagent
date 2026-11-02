import { afterEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, readFile } from "node:fs/promises"
import { join } from "node:path"

import { GitMemoryRepo, buildDefaultSeedFiles, buildIdentityPaths, type FactsPeopleRouting } from "@oh-my-opencode/memory-core"

import type { MemoryIdentityContext } from "../memory/context"
import { createSessionFactsApplier, publishSessionFactsApplier } from "../memory/facts-apply-rpc"
import { registrySnapshot } from "../memory/facts-runner.test-support"
import { createOnboardingComponent } from "./component"
import { encodeRecord, writeTranscript } from "./session-history/test-support"
import * as state from "./state"
import { createOnboardingHarness } from "./test-harness"
import { fakeModel, snapshotTree, tempRoot, type FakeTurn } from "./understand.test-support"

const PEOPLE: FactsPeopleRouting = { enabled: true, maxEntries: 40, maxEntryChars: 200 }
const KEPT = "Runs the test suite with bun before every push."
const DROPPED = "Prefers to keep pull requests under 200 lines."
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  publishSessionFactsApplier(undefined)
  Reflect.deleteProperty(globalThis, Symbol.for("omo.onboard"))
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

interface ToolLike {
  readonly name: string
  execute(id: string, params: unknown, signal?: AbortSignal, onUpdate?: unknown, ctx?: unknown): Promise<{ content: Array<{ text?: string }>; details?: unknown; isError?: boolean }>
}

async function machine() {
  const root = await tempRoot("omo-onboarding-tui-flow-")
  cleanups.push(root.cleanup)
  const home = join(root.path, "home")
  const codex = join(root.path, "codex")
  const workspace = join(root.path, "workspace")
  await mkdir(workspace, { recursive: true })
  for (const [index, prompt] of ["Ship the feature with bun", "Fix the bun test"].entries()) {
    await writeTranscript({
      filePath: join(codex, "sessions", "2026", "10", "18", `rollout-${index}.jsonl`),
      mtimeMs: Date.now() - (index + 1) * 1_000,
      contents: [
        encodeRecord({ type: "session_meta", payload: { id: `codex-${index}`, cwd: workspace } }),
        encodeRecord({ type: "event_msg", payload: { type: "user_message", message: prompt } }),
      ].join("\n"),
    })
  }
  const identityPaths = buildIdentityPaths(join(root.path, "memory"), "tui-agent")
  const repo = new GitMemoryRepo({ dir: identityPaths.repo, agentId: "tui-agent" })
  await repo.init({ seedFiles: buildDefaultSeedFiles() })
  const context = { identity: "tui-agent", identityPaths } as unknown as MemoryIdentityContext
  publishSessionFactsApplier(createSessionFactsApplier({ resolveContext: () => context, people: () => PEOPLE }))
  const stateDir = join(root.path, "state")
  return {
    stateDir,
    repo,
    memoryRoot: identityPaths.root,
    environment: {
      home,
      env: { HOME: home },
      agentDir: join(home, ".omo", "agent"),
      sessionHistory: { homes: [{ source: "codex" as const, homePath: codex }], omoSessionsRoots: [] },
    },
  }
}

function tuiOnboarding(profile: Awaited<ReturnType<typeof machine>>, turn: FakeTurn) {
  const model = fakeModel(turn)
  const component = createOnboardingComponent({
    claimOnboarding: () => state.claimOnboarding(profile.stateDir),
    isOnboardingComplete: () => state.isOnboardingComplete(profile.stateDir),
    releaseOnboarding: () => state.releaseOnboarding(profile.stateDir),
    scanEnvironment: () => profile.environment,
    understanding: { createRunner: model.createRunner },
  })
  const h = createOnboardingHarness(profile.stateDir, "tui-session", "tui", component)
  const tool = (name: string): ToolLike => {
    const found = h.pi.tools.find((candidate) => candidate["name"] === name)
    if (found === undefined) throw new Error(`tool ${name} was not registered`)
    return found as unknown as ToolLike
  }
  const toolCtx = {
    hasUI: true,
    mode: "tui",
    model: { provider: "omo-mock", id: "mock-1" },
    modelRegistry: registrySnapshot(),
    sessionManager: { getSessionId: () => "tui-session", getBranch: () => [] },
  }
  return { h, model, tool, toolCtx }
}

function contextOf(results: readonly unknown[]): string {
  const contents = results.flatMap((result) =>
    typeof result === "object" && result !== null && "message" in result
      ? [String((result as { message: { content: unknown } }).message.content)]
      : [])
  expect(contents).toHaveLength(1)
  return contents[0] ?? ""
}

const recordsBoth: FakeTurn = async ({ record }) => {
  await record(KEPT)
  await record(DROPPED)
  return "completed"
}

describe("TUI onboarding: shared scan, understanding, select-before-write", () => {
  test("#given recent agent sessions #when the first prompt is onboarded #then the context carries the shared setup scan (its id and value summary) but no session row, and no digest is on disk", async () => {
    const profile = await machine()
    const { h } = tuiOnboarding(profile, recordsBoth)
    await h.start()

    const content = contextOf(await h.prompt())

    const scanId = /Onboarding scan ([\w-]+)/.exec(content)?.[1]
    expect(scanId).toBeDefined()
    expect(existsSync(join(profile.stateDir, "onboarding", "scans"))).toBe(false)
    // The first prompt awaits only omo setup's sources; session digests are read when understanding runs.
    const rows = content.split("\n").filter((line) => line.startsWith("- "))
    expect(rows.filter((row) => row.startsWith("- sessions ") || row.startsWith("- projects "))).toHaveLength(0)
    for (const key of ["codex:codex-0", "codex:codex-1"]) expect(content.includes(key)).toBe(false)
    expect(content).toMatch(/^Value summary: /m)
    expect(content).not.toMatch(/recent sessions? across/)
  }, 60_000)

  test("#given the understanding found two facts #when the user selects one #then memory gets exactly that one through the facts commit, and nothing was written before the selection", async () => {
    const profile = await machine()
    const { h, tool, toolCtx, model } = tuiOnboarding(profile, recordsBoth)
    await h.start()
    await h.prompt()
    const beforeUnderstanding = await snapshotTree(profile.memoryRoot)
    const headBefore = await profile.repo.head()

    const refused = await tool("onboarding_understand").execute("u0", {}, undefined, undefined, toolCtx)
    expect(refused.isError).toBe(true)
    expect(model.starts).toHaveLength(0)

    const understood = await tool("onboarding_understand").execute("u1", { consent: true }, undefined, undefined, toolCtx)
    expect(understood.isError).not.toBe(true)
    const details = understood.details as { understandId: string; candidates: Array<{ id: string; fact: { text: string } }> }
    expect(details.candidates.map((candidate) => candidate.fact.text).sort()).toEqual([DROPPED, KEPT].sort())
    expect(model.starts[0]?.model?.id).toBe("mock-1")
    expect(await snapshotTree(profile.memoryRoot)).toEqual(beforeUnderstanding)

    const kept = details.candidates.find((candidate) => candidate.fact.text === KEPT)
    const applied = await tool("onboarding_memory_apply").execute("a1", { understand_id: details.understandId, selected: [kept?.id] }, undefined, undefined, toolCtx)
    expect(applied.isError).not.toBe(true)
    expect(applied.details).toMatchObject({ outcome: "committed" })

    const log = await profile.repo.log()
    expect(log[0]?.trailers["Generated-By"]).toBe("facts-extractor")
    expect(log[1]?.sha).toBe(headBefore ?? "")
    const paths = (applied.details as { affectedPaths: string[] }).affectedPaths
    const written = (await Promise.all(paths.map((path) => readFile(join(profile.repo.dir, path), "utf8")))).join("\n")
    expect(written).toContain(KEPT)
    expect(written).not.toContain(DROPPED)
  }, 90_000)

  test("#given candidates #when the selection is empty, unknown, or replayed #then no fact is written", async () => {
    const profile = await machine()
    const { h, tool, toolCtx } = tuiOnboarding(profile, recordsBoth)
    await h.start()
    await h.prompt()
    const understood = await tool("onboarding_understand").execute("u1", { consent: true }, undefined, undefined, toolCtx)
    const details = understood.details as { understandId: string; candidates: Array<{ id: string }> }
    const head = await profile.repo.head()

    const none = await tool("onboarding_memory_apply").execute("a0", { understand_id: details.understandId, selected: [] }, undefined, undefined, toolCtx)
    expect(none.details).toMatchObject({ outcome: "no_facts" })
    const unknown = await tool("onboarding_memory_apply").execute("a1", { understand_id: details.understandId, selected: ["not-a-candidate"] }, undefined, undefined, toolCtx)
    expect(unknown.isError).toBe(true)
    expect(await profile.repo.head()).toBe(head)

    const first = await tool("onboarding_memory_apply").execute("a2", { understand_id: details.understandId, selected: [details.candidates[0]?.id] }, undefined, undefined, toolCtx)
    expect(first.details).toMatchObject({ outcome: "committed" })
    const committed = await profile.repo.head()
    const replay = await tool("onboarding_memory_apply").execute("a3", { understand_id: details.understandId, selected: [details.candidates[1]?.id] }, undefined, undefined, toolCtx)
    expect(replay.isError).toBe(true)
    expect(await profile.repo.head()).toBe(committed)
  }, 90_000)
})
