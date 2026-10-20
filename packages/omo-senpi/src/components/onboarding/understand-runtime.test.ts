import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, symlink, writeFile } from "node:fs/promises"
import type { ChildSpec } from "@oh-my-opencode/senpi-task"
import { join } from "node:path"

import { registrySnapshot } from "../memory/facts-runner.test-support"
import { digestByteLength } from "./session-history/session-digest"
import type { SessionDigest } from "./session-history"
import { digest, fakeModel, snapshotTree, tempRoot, understandRunDirs, UNDERSTAND_MODEL, type FakeTurn } from "./understand.test-support"
import { ONBOARDING_UNDERSTAND_BUDGET, type OnboardingUnderstandBudgetLimits, type OnboardingUnderstandEvent } from "./understand-contract"
import { OnboardingUnderstandingControl } from "./understand-control"
import { runOnboardingUnderstanding } from "./understand-runtime"
import { startOnboardingUnderstanding } from "./understand-start"

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

async function workspace(): Promise<string> {
  const root = await tempRoot("omo-understand-test-")
  cleanups.push(root.cleanup)
  return root.path
}

async function run(input: {
  readonly digests: readonly SessionDigest[]
  readonly turn: FakeTurn
  readonly control?: OnboardingUnderstandingControl
  readonly budget?: OnboardingUnderstandBudgetLimits
  readonly env?: NodeJS.ProcessEnv
  readonly projectRoots?: ReadonlySet<string>
  readonly now?: () => number
  readonly onAbort?: (spec: ChildSpec) => Promise<void>
}) {
  const model = fakeModel(input.turn, input.onAbort === undefined ? {} : { onAbort: input.onAbort })
  const events: OnboardingUnderstandEvent[] = []
  const done = await runOnboardingUnderstanding({
    understandId: "understand-1",
    scanId: "scan-1",
    model: UNDERSTAND_MODEL,
    digests: input.digests,
    projectRoots: input.projectRoots ?? new Set(input.digests.map((item) => item.cwd)),
    ...(input.now === undefined ? {} : { now: input.now }),
    modelRegistry: registrySnapshot(),
    control: input.control ?? new OnboardingUnderstandingControl(),
    createRunner: model.createRunner,
    env: input.env ?? { HOME: "/nonexistent-home" },
    ...(input.budget === undefined ? {} : { budget: input.budget }),
  }, (event) => events.push(event))
  return { done, events, starts: model.starts }
}

const kinds = (events: readonly OnboardingUnderstandEvent[]) => events.map((event) => event.kind)

describe("onboarding understanding (#10480)", () => {
  test("#given the issue's budgets #when read #then they are 24 tool calls, 240 KB, 90 s, 15 s per step, 12 facts, 2 sessions", () => {
    expect(ONBOARDING_UNDERSTAND_BUDGET).toEqual({
      toolCalls: 24,
      readBytes: 240 * 1024,
      totalMs: 90_000,
      stepMs: 15_000,
      maxFacts: 12,
      minSourceSessions: 2,
    })
  })

  test("#given two projects #when understanding runs #then each step carries a label, byte counts and the fact candidates with their source sessions", async () => {
    // given
    const root = await workspace()
    const alpha = join(root, "alpha")
    const beta = join(root, "beta")
    await mkdir(alpha)
    await mkdir(beta)
    const agentsMd = "# alpha\nAlways run bun test before committing.\n"
    await writeFile(join(alpha, "AGENTS.md"), agentsMd)
    const digests = [digest(alpha, 1), digest(alpha, 2), digest(alpha, 3), digest(beta, 4), digest(beta, 5)]

    // when
    const { done, events, starts } = await run({ digests, turn: async ({ record }) => {
      await record("The user runs tests with bun.")
      return "completed"
    } })

    // then
    expect(kinds(events)).toEqual(["step_started", "fact", "step_done", "step_started", "step_done", "done"])
    expect(events[0]?.step).toEqual({ id: "step-1", label: "Read 3 recent sessions in alpha", project: alpha, sessions: 3 })
    expect(events[3]?.step?.label).toBe("Read 2 recent sessions in beta")
    const alphaBytes = digests.slice(0, 3).reduce((sum, item) => sum + digestByteLength(item), 0) + Buffer.byteLength(agentsMd)
    expect(events[2]?.bytesRead).toBe(alphaBytes)
    expect(events[4]?.bytesRead).toBe(alphaBytes + digestByteLength(digests[3]!) + digestByteLength(digests[4]!))
    expect(events.every((event) => event.understandId === "understand-1" && event.scanId === "scan-1" && event.elapsedMs >= 0)).toBe(true)
    expect(events[1]?.fact).toMatchObject({ fact: { scope: "project", text: "The user runs tests with bun." }, sources: digests.slice(0, 3).map((item) => item.sessionKey) })
    expect(done.kind).toBe("done")
    expect(done.fallback).toBeUndefined()
    expect(done.candidates).toHaveLength(1)
    expect(done.candidates?.[0]?.sources).toEqual(digests.map((item) => item.sessionKey))
    expect(starts.map((spec) => spec.model?.id)).toEqual(["mock-1", "mock-1"])
    expect(starts[0]?.prompt).toContain("Always run bun test before committing.")
    expect(starts[0]?.prompt).toContain("Run the tests with bun in alpha")
    expect(starts[0]?.prompt).not.toContain("Run the tests with bun in beta")
  })

  test("#given a run #when it finishes #then memory and the agent home are untouched and no run directory is left behind", async () => {
    // given
    const home = await workspace()
    const memoryFile = join(home, ".omo", "agent", "memory", "agents", "me", "repo", "system", "human.md")
    await mkdir(join(memoryFile, ".."), { recursive: true })
    await writeFile(memoryFile, "---\ndescription: me\n---\nlikes tea\n")
    const project = join(home, "work")
    await mkdir(project)
    const before = await snapshotTree(home)
    const leftoversBefore = await understandRunDirs()

    // when
    const { done } = await run({
      digests: [digest(project, 1), digest(project, 2)],
      env: { HOME: home, OMO_AGENT_DIR: join(home, ".omo", "agent") },
      turn: async ({ record }) => {
        await record("The user prefers tea.")
        return "completed"
      },
    })

    // then
    expect(done.candidates).toHaveLength(1)
    expect(await snapshotTree(home)).toEqual(before)
    expect(await understandRunDirs()).toEqual(leftoversBefore)
  })

  test("#given a model that records past the cap #when understanding runs #then 24 tool calls end the run with a budget event", async () => {
    // given
    const root = await workspace()
    const digests = [digest(join(root, "a"), 1), digest(join(root, "a"), 2), digest(join(root, "b"), 3), digest(join(root, "b"), 4)]
    const accepted: boolean[] = []

    // when
    const { done, events, starts } = await run({ digests, turn: async ({ record }) => {
      for (let index = 0; index < 30; index += 1) accepted.push(await record("The user writes TypeScript."))
      return "completed"
    } })

    // then
    expect(accepted.filter(Boolean)).toHaveLength(24)
    expect(starts).toHaveLength(1)
    expect(events.find((event) => event.kind === "budget")).toMatchObject({ budget: "tool_calls", toolCalls: 24 })
    expect(done.toolCalls).toBe(24)
    expect(done.candidates).toHaveLength(1)
  })

  test("#given more than twelve distinct facts #when understanding runs #then twelve candidates are kept and the run ends at the cap", async () => {
    // given
    const root = await workspace()
    const digests = [digest(join(root, "a"), 1), digest(join(root, "a"), 2), digest(join(root, "b"), 3), digest(join(root, "b"), 4)]

    // when
    const { done, events } = await run({ digests, turn: async ({ record }) => {
      for (let index = 0; index < 20; index += 1) await record(`Distinct fact number ${index}.`)
      return "completed"
    } })

    // then
    expect(done.candidates).toHaveLength(12)
    expect(events.filter((event) => event.kind === "fact")).toHaveLength(12)
    expect(events.find((event) => event.kind === "budget")?.budget).toBe("max_facts")
    expect(events.filter((event) => event.kind === "step_started")).toHaveLength(1)
  })

  test("#given more history than 240 KB #when understanding runs #then reads stop at the byte budget", async () => {
    // given
    const root = await workspace()
    const long = "x".repeat(15_000)
    const digests = Array.from({ length: 40 }, (_, index) =>
      digest(join(root, `p${Math.floor(index / 2)}`), index, { firstRequest: long }))
    expect(digests.reduce((sum, item) => sum + digestByteLength(item), 0)).toBeGreaterThan(240 * 1024)

    // when
    const { done, events } = await run({ digests, turn: async () => "completed" })

    // then
    expect(Math.max(...events.map((event) => event.bytesRead))).toBeLessThanOrEqual(240 * 1024)
    expect(events.find((event) => event.kind === "budget")?.budget).toBe("read_bytes")
    expect(events.filter((event) => event.kind === "step_started").length).toBeLessThan(20)
    expect(done.kind).toBe("done")
  })

  test("#given a project with a single session #when understanding runs #then no step reads it and no fact can come from it", async () => {
    // given
    const root = await workspace()

    // when
    const { done, events, starts } = await run({ digests: [digest(join(root, "solo"), 1)], turn: async ({ record }) => {
      await record("Should never be recorded.")
      return "completed"
    } })

    // then
    expect(starts).toHaveLength(0)
    expect(kinds(events)).toEqual(["done"])
    expect(done.candidates).toEqual([])
    expect(done.fallback).toBeUndefined()
  })

  test("#given single-session projects #when understanding runs #then they are read together in one step", async () => {
    // given
    const root = await workspace()
    const digests = [digest(join(root, "one"), 1), digest(join(root, "two"), 2)]

    // when
    const { done, events } = await run({ digests, turn: async ({ record }) => {
      await record("The user works across several repositories.")
      return "completed"
    } })

    // then
    expect(events[0]?.step?.label).toBe("Read 2 recent sessions across 2 projects")
    expect(done.candidates?.[0]?.sources).toEqual(digests.map((item) => item.sessionKey))
  })

  test("#given a model call that keeps failing #when understanding runs #then it retries once and ends with the scan-only fallback", async () => {
    // given
    const root = await workspace()
    const digests = [digest(join(root, "a"), 1), digest(join(root, "a"), 2), digest(join(root, "b"), 3), digest(join(root, "b"), 4)]

    // when
    const { done, events, starts } = await run({ digests, turn: async () => "error" })

    // then
    expect(starts).toHaveLength(2)
    expect(kinds(events)).toEqual(["step_started", "step_failed", "step_failed", "done"])
    expect(events[1]?.retrying).toBe(true)
    expect(events[2]?.retrying).toBeUndefined()
    expect(done).toMatchObject({ kind: "done", fallback: "scan_only", candidates: [] })
  })

  test("#given a model provider that cannot start #when understanding runs #then the retry and fallback hold too", async () => {
    // given
    const root = await workspace()

    // when
    const { done, starts } = await run({ digests: [digest(join(root, "a"), 1), digest(join(root, "a"), 2)], turn: async () => "throw" })

    // then
    expect(starts).toHaveLength(2)
    expect(done.fallback).toBe("scan_only")
  })

  test("#given a model call that fails once #when the retry succeeds #then its facts are kept", async () => {
    // given
    const root = await workspace()

    // when
    const { done, events } = await run({ digests: [digest(join(root, "a"), 1), digest(join(root, "a"), 2)], turn: async ({ start, record }) => {
      if (start === 1) return "error"
      await record("The user deploys on Fridays.")
      return "completed"
    } })

    // then
    expect(kinds(events)).toEqual(["step_started", "step_failed", "fact", "step_done", "done"])
    expect(done.fallback).toBeUndefined()
    expect(done.candidates).toHaveLength(1)
  })

  test("#given a step that outlives its time budget #when understanding runs #then the step ends with what it recorded and the next step runs", async () => {
    // given
    const root = await workspace()
    const digests = [digest(join(root, "a"), 1), digest(join(root, "a"), 2), digest(join(root, "b"), 3), digest(join(root, "b"), 4)]

    // when
    const { done, events } = await run({
      digests,
      budget: { ...ONBOARDING_UNDERSTAND_BUDGET, stepMs: 2_000, totalMs: 30_000 },
      turn: async ({ start, record }) => {
        await record(start === 1 ? "Recorded before the step ran out." : "Recorded in the second step.")
        return start === 1 ? "hang" : "completed"
      },
    })

    // then
    expect(kinds(events)).toEqual(["step_started", "fact", "budget", "step_done", "step_started", "fact", "step_done", "done"])
    expect(events[2]?.budget).toBe("step_ms")
    expect(done.candidates?.map((candidate) => candidate.fact.text)).toEqual(["Recorded before the step ran out.", "Recorded in the second step."])
  })

  test("#given steps that never finish #when the total budget runs out #then the run ends", async () => {
    // given
    const root = await workspace()
    const digests = Array.from({ length: 10 }, (_, index) => digest(join(root, `p${Math.floor(index / 2)}`), index))

    // when
    const { done, events } = await run({ digests, budget: { ...ONBOARDING_UNDERSTAND_BUDGET, stepMs: 60, totalMs: 150 }, turn: async () => "hang" })

    // then
    expect(events.filter((event) => event.kind === "budget").at(-1)?.budget).toBe("total_ms")
    expect(events.filter((event) => event.kind === "step_started").length).toBeLessThan(5)
    expect(done.elapsedMs).toBeLessThan(10_000)
  })

  test("#given a project the scan did not list #when its step runs #then its AGENTS.md is never read", async () => {
    // given
    const root = await workspace()
    const alpha = join(root, "alpha")
    await mkdir(alpha)
    await writeFile(join(alpha, "AGENTS.md"), "UNLISTED-PROJECT-RULES\n")

    // when
    const { starts, events } = await run({ digests: [digest(alpha, 1), digest(alpha, 2)], projectRoots: new Set(), turn: async () => "completed" })

    // then
    expect(starts).toHaveLength(1)
    expect(starts[0]?.prompt).not.toContain("UNLISTED-PROJECT-RULES")
    expect(starts[0]?.prompt).not.toContain("<agents_md")
    expect(events.at(-1)?.bytesRead).toBe(digestByteLength(digest(alpha, 1)) + digestByteLength(digest(alpha, 2)))
  })

  test("#given a listed project whose AGENTS.md links outside it #when its step runs #then the linked file is never read", async () => {
    // given
    const root = await workspace()
    const alpha = join(root, "alpha")
    const outside = join(root, "outside")
    await mkdir(alpha)
    await mkdir(outside)
    await writeFile(join(outside, "secret.md"), "OUTSIDE-THE-PROJECT\n")
    await symlink(join(outside, "secret.md"), join(alpha, "AGENTS.md"))

    // when
    const { starts } = await run({ digests: [digest(alpha, 1), digest(alpha, 2)], projectRoots: new Set([alpha]), turn: async () => "completed" })

    // then
    expect(starts).toHaveLength(1)
    expect(starts[0]?.prompt).not.toContain("OUTSIDE-THE-PROJECT")
  })

  test("#given a step whose child arrives after its deadline and writes while aborting #when the run ends #then no scratch directory is left behind", async () => {
    // given
    const root = await workspace()
    const leftoversBefore = await understandRunDirs()
    let lateWrite: (() => void) | undefined
    const wrote = new Promise<void>((resolve) => { lateWrite = resolve })

    // when
    const { done } = await run({
      digests: [digest(join(root, "a"), 1), digest(join(root, "a"), 2)],
      budget: { ...ONBOARDING_UNDERSTAND_BUDGET, stepMs: 50, totalMs: 30_000 },
      turn: async () => {
        await new Promise((resolve) => setTimeout(resolve, 200))
        return "hang"
      },
      onAbort: async (spec) => {
        const sessionDir = String(spec.sessionDir)
        await mkdir(sessionDir, { recursive: true })
        await writeFile(join(sessionDir, "late-session.jsonl"), "written after abort\n")
        lateWrite?.()
      },
    })
    await wrote

    // then
    expect(done.kind).toBe("done")
    expect(await understandRunDirs()).toEqual(leftoversBefore)
  })

  test("#given a failed step and no time left #when the retry would start #then the run ends at total_ms without a second model call", async () => {
    // given
    const root = await workspace()
    let clock = 0

    // when
    const { done, events, starts } = await run({
      digests: [digest(join(root, "a"), 1), digest(join(root, "a"), 2)],
      budget: { ...ONBOARDING_UNDERSTAND_BUDGET, totalMs: 1_000 },
      now: () => clock,
      turn: async () => {
        clock += 2_000
        return "error"
      },
    })

    // then
    expect(starts).toHaveLength(1)
    expect(kinds(events)).toEqual(["step_started", "step_failed", "budget", "done"])
    expect(events[2]?.budget).toBe("total_ms")
    expect(done.fallback).toBeUndefined()
  })

  test("#given a run that crashes after reading and recording #when it falls back #then done reports the usage it actually had", async () => {
    // given
    const root = await workspace()
    const digests = [digest(join(root, "a"), 1), digest(join(root, "a"), 2)]
    const model = fakeModel(async ({ record }) => {
      await record("The user ships on Fridays.")
      return "completed"
    })
    const events: OnboardingUnderstandEvent[] = []

    // when
    const started = await startOnboardingUnderstanding({
      scanId: "scan-1",
      model: UNDERSTAND_MODEL,
      digests,
      projectRoots: new Set(),
      modelRegistry: registrySnapshot(),
      env: { HOME: "/nonexistent-home" },
      seams: { createRunner: model.createRunner },
    }, (event) => {
      events.push(event)
      if (event.kind === "fact") throw new Error("client went away")
    })
    if ("kind" in started) throw new Error(`understanding did not start: ${started.reason}`)
    await started.finished

    // then
    const done = events.at(-1)
    expect(done).toMatchObject({ kind: "done", fallback: "scan_only", toolCalls: 1 })
    expect(done?.bytesRead).toBe(digests.reduce((sum, item) => sum + digestByteLength(item), 0))
    expect(done?.elapsedMs).toBeGreaterThanOrEqual(0)
  })

  test("#given a skipped project #when understanding runs #then its step never starts", async () => {
    // given
    const root = await workspace()
    const alpha = join(root, "alpha")
    const beta = join(root, "beta")
    const control = new OnboardingUnderstandingControl()
    control.skip(beta)

    // when
    const { events, starts } = await run({
      digests: [digest(alpha, 1), digest(alpha, 2), digest(beta, 3), digest(beta, 4)],
      control,
      turn: async () => "completed",
    })

    // then
    expect(starts).toHaveLength(1)
    expect(events.filter((event) => event.kind === "step_started").map((event) => event.step?.project)).toEqual([alpha])
  })

  test("#given a running step #when its project is skipped #then the step is cancelled, its facts dropped and the next step runs", async () => {
    // given
    const root = await workspace()
    const alpha = join(root, "alpha")
    const beta = join(root, "beta")
    const control = new OnboardingUnderstandingControl()

    // when
    const { done, events } = await run({
      digests: [digest(alpha, 1), digest(alpha, 2), digest(beta, 3), digest(beta, 4)],
      control,
      turn: async ({ start, record }) => {
        if (start === 2) {
          await record("From beta.")
          return "completed"
        }
        await record("From alpha.")
        control.skip(alpha)
        return "hang"
      },
    })

    // then
    expect(events.find((event) => event.kind === "step_done")).toMatchObject({ skipped: true, step: { project: alpha } })
    expect(done.candidates?.map((candidate) => candidate.fact.text)).toEqual(["From beta."])
  })

  test("#given a running step #when the run is stopped #then it ends at once with the candidates it already had", async () => {
    // given
    const root = await workspace()
    const control = new OnboardingUnderstandingControl()

    // when
    const { done, starts } = await run({
      digests: [digest(join(root, "a"), 1), digest(join(root, "a"), 2), digest(join(root, "b"), 3), digest(join(root, "b"), 4)],
      control,
      turn: async ({ start, record }) => {
        if (start === 1) {
          await record("Kept from the first step.")
          return "completed"
        }
        control.stop()
        return "hang"
      },
    })

    // then
    expect(starts).toHaveLength(2)
    expect(done).toMatchObject({ kind: "done", stopped: true })
    expect(done.candidates?.map((candidate) => candidate.fact.text)).toEqual(["Kept from the first step."])
  })
})
