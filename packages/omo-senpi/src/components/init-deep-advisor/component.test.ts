/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, jest, mock, spyOn, test } from "bun:test"
import * as childProcess from "node:child_process"

import {
  createInitDeepAdvisorComponent,
  runAdvisor,
} from "./component"
import {
  advisorStateDir,
  componentContext,
  createHarness,
  makeCoverageRepo,
  makeStaleRepo,
  resetTestHome,
  setTestHome,
} from "./component.test-support"
import { makeTempDir } from "./fixtures.test-support"
import { buildProposedData } from "./proposed-data"
import type { EligibilityResult, OmoInitDeepProposedData } from "./proposed-data"
import { runAdvisorAfterPreflight } from "./runtime"
import * as advisorState from "./state"

const choices = ["Run now", "Skip this time", "Never in this project", "Never anywhere"]

beforeEach(() => setTestHome())
afterEach(() => {
  jest.useRealTimers()
  mock.restore()
  resetTestHome()
})

describe("createInitDeepAdvisorComponent", () => {
  for (const choice of [...choices, undefined]) {
    test(`#given an eligible repo #when ${choice ?? "the dialog times out"} #then the correct response state is applied`, async () => {
      // given
      const root = makeCoverageRepo()
      const { pi, select, eventCtx } = createHarness(root, choice)
      const stateDir = advisorStateDir()
      const repo = advisorState.repoHash(root)

      // when
      await runAdvisor(pi, componentContext, eventCtx)

      // then
      expect(select).toHaveBeenCalledWith("Init-deep", choices, { timeout: 60_000 })
      if (choice === "Run now") {
        expect(pi.messages).toEqual([{
          message: {
            customType: "omo-init-deep-advisor:run",
            content: expect.stringContaining("Read the init-deep skill at"),
            display: false,
          },
          options: { triggerTurn: true, deliverAs: "followUp" },
        }])
        expect(pi.appendEntry).toHaveBeenCalledWith("omo-init-deep-advisor:proposed", {
          repo,
          trigger: "coverage-gap",
          coverage: { missingRatio: 1, candidateDirs: 1, coveredDirs: 0 },
          drift: null,
          suggestedMode: "local",
        })
      } else if (choice === "Skip this time" || choice === undefined) {
        expect(advisorState.readCooldownUntil(stateDir, repo)).toBeGreaterThan(Date.now())
      } else if (choice === "Never in this project") {
        expect(advisorState.isProjectDeclined(stateDir, repo)).toBe(true)
      } else if (choice === "Never anywhere") {
        expect(advisorState.isGloballyDeclined(stateDir)).toBe(true)
      }
    })
  }

  test("#given a fully covered repo #when the advisor runs #then no selector opens", async () => {
    // given
    const { pi, select, eventCtx } = createHarness(makeCoverageRepo(true))

    // when
    await runAdvisor(pi, componentContext, eventCtx)

    // then
    expect(select).not.toHaveBeenCalled()
  })

  test("#given the advisor is disabled #when the advisor runs #then no selector opens", async () => {
    // given
    const { pi, select, eventCtx } = createHarness(makeCoverageRepo())
    pi.setFlag("omo-senpi-init-deep-advisor-disabled", true)

    // when
    await runAdvisor(pi, componentContext, eventCtx)

    // then
    expect(select).not.toHaveBeenCalled()
  })

  test("#given a background RPC session #when it opens and closes with no prompt #then no advisor work runs", async () => {
    // given
    const root = makeCoverageRepo()
    const { pi, select, eventCtx } = createHarness(root)
    let advisorRuns = 0
    createInitDeepAdvisorComponent({
      runAfterPreflight: async () => {
        advisorRuns += 1
      },
    }).register(pi, componentContext)
    const originalExecFileSync = childProcess.execFileSync.bind(childProcess)
    const execFileSync = spyOn(childProcess, "execFileSync").mockImplementation(
      ((...args: Parameters<typeof childProcess.execFileSync>) => originalExecFileSync(...args)) as typeof childProcess.execFileSync,
    )

    // when
    await pi.dispatch("session_start", { type: "session_start", reason: "startup" }, eventCtx)
    await pi.dispatch("session_shutdown", { type: "session_shutdown", reason: "quit" }, eventCtx)

    // then
    expect(pi.handlers.find((entry) => entry.event === "session_start")).toBeUndefined()
    expect(advisorRuns).toBe(0)
    expect(execFileSync).not.toHaveBeenCalled()
    expect(select).not.toHaveBeenCalled()
    expect(pi.messages).toEqual([])
    expect(advisorState.readLastProposedHead(advisorStateDir(), advisorState.repoHash(root))).toBeNull()
  })

  test("#given any session #when session_start fires #then the advisor never runs from it", async () => {
    // given
    const { pi, select, eventCtx } = createHarness(makeCoverageRepo())
    let advisorRuns = 0
    createInitDeepAdvisorComponent({
      runAfterPreflight: async () => {
        advisorRuns += 1
      },
    }).register(pi, componentContext)

    // when
    for (const reason of ["startup", "new", "reload", "resume", "fork"]) {
      await pi.dispatch("session_start", { type: "session_start", reason }, eventCtx)
    }

    // then
    expect(advisorRuns).toBe(0)
    expect(select).not.toHaveBeenCalled()
  })

  test("#given an eligible repo #when the first real prompt arrives #then the advisor still offers", async () => {
    // given
    const selected = Promise.withResolvers<void>()
    const root = makeCoverageRepo()
    const { pi, select, eventCtx } = createHarness(root, "Run now", true, async () => {
      selected.resolve()
      return "Run now"
    })
    createInitDeepAdvisorComponent({ runAfterPreflight: runAdvisorAfterPreflight })
      .register(pi, componentContext)

    // when
    const registration = pi.handlers.find((entry) => entry.event === "before_agent_start")
    await pi.dispatch("session_start", { type: "session_start", reason: "startup" }, eventCtx)
    await pi.dispatch(
      "before_agent_start",
      { type: "before_agent_start", trigger: "prompt", prompt: "Fix the failing test" },
      eventCtx,
    )
    await selected.promise
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0)
    })

    // then
    expect(registration?.options).toEqual({ previewSafe: true })
    expect(select).toHaveBeenCalledTimes(1)
    expect(select).toHaveBeenCalledWith("Init-deep", choices, { timeout: 60_000 })
    expect(pi.messages).toEqual([{
      message: {
        customType: "omo-init-deep-advisor:run",
        content: expect.stringContaining("Read the init-deep skill at"),
        display: false,
      },
      options: { triggerTurn: true, deliverAs: "followUp" },
    }])
  })

  for (const excluded of ["preview", "worker", "extension", "delivery", "headless"] as const) {
    test(`#given a ${excluded} turn #when before_agent_start fires #then no advisor work runs`, async () => {
      // given
      const root = makeCoverageRepo()
      const { pi, select, eventCtx } = createHarness(root, undefined, excluded !== "headless")
      if (excluded === "worker") pi.sessionKind = "worker"
      let advisorRuns = 0
      createInitDeepAdvisorComponent({
        runAfterPreflight: async () => {
          advisorRuns += 1
        },
      }).register(pi, componentContext)
      const payload = {
        type: "before_agent_start",
        trigger: excluded === "extension" || excluded === "delivery" ? excluded : "prompt",
        prompt: "Fix the failing test",
        ...(excluded === "preview" ? { preview: true } : {}),
      }

      // when
      await pi.dispatch("before_agent_start", payload, eventCtx)

      // then
      expect(advisorRuns).toBe(0)
      expect(select).not.toHaveBeenCalled()
    })
  }

  test("#given a preview pass #when a real prompt follows it #then the preview consumed nothing and the advisor offers", async () => {
    // given
    const root = makeCoverageRepo()
    const { pi, eventCtx } = createHarness(root)
    let advisorRuns = 0
    createInitDeepAdvisorComponent({
      runAfterPreflight: async () => {
        advisorRuns += 1
      },
    }).register(pi, componentContext)

    // when
    await pi.dispatch(
      "before_agent_start",
      { type: "before_agent_start", trigger: "prompt", prompt: "", preview: true },
      eventCtx,
    )
    await pi.dispatch(
      "before_agent_start",
      { type: "before_agent_start", trigger: "prompt", prompt: "Fix the failing test" },
      eventCtx,
    )

    // then
    expect(advisorRuns).toBe(1)
  })

  test("#given the advisor already ran for a session #when a second prompt arrives #then it does not run again", async () => {
    // given
    const root = makeCoverageRepo()
    const { pi, eventCtx } = createHarness(root)
    let advisorRuns = 0
    createInitDeepAdvisorComponent({
      runAfterPreflight: async () => {
        advisorRuns += 1
      },
    }).register(pi, componentContext)
    const prompt = { type: "before_agent_start", trigger: "prompt", prompt: "Fix the failing test" }

    // when
    await pi.dispatch("before_agent_start", prompt, eventCtx)
    await pi.dispatch("before_agent_start", prompt, eventCtx)

    // then
    expect(advisorRuns).toBe(1)
  })

  for (const marker of ["missing", "current"] as const) {
    test(`#given an onboarding marker that is ${marker} #when the advisor runs #then first-session suppression blocks the selector`, async () => {
      // given
      setTestHome(marker)
      const { pi, select, eventCtx } = createHarness(makeCoverageRepo())

      // when
      await runAdvisor(pi, componentContext, eventCtx)

      // then
      expect(select).not.toHaveBeenCalled()
    })
  }

  test("#given a non-UI mode #when the advisor runs #then proposal state and UI remain untouched", async () => {
    // given
    const root = makeCoverageRepo()
    const { pi, select, eventCtx } = createHarness(root, "Skip this time", false)
    const repo = advisorState.repoHash(root)

    // when
    await runAdvisor(pi, componentContext, eventCtx)

    // then
    expect(select).not.toHaveBeenCalled()
    expect(advisorState.readLastProposedHead(advisorStateDir(), repo)).toBeNull()
    expect(advisorState.readCooldownUntil(advisorStateDir(), repo)).toBe(0)
  })

  for (const suggestedMode of ["committed", "local"] as const) {
    test(`#given AGENTS.md is ${suggestedMode === "committed" ? "tracked" : "untracked"} #when Run now is chosen #then suggestedMode is ${suggestedMode}`, async () => {
      // given
      const root = makeStaleRepo(suggestedMode)
      const { pi, eventCtx } = createHarness(root, "Run now")

      // when
      await runAdvisor(pi, componentContext, eventCtx)

      // then
      expect(pi.appendEntry).toHaveBeenCalledWith("omo-init-deep-advisor:proposed", {
        repo: advisorState.repoHash(root),
        trigger: "snapshot-invalid",
        coverage: null,
        drift: { stale: true },
        suggestedMode,
      })
    })
  }

  test("#given every eligibility trigger #when proposed data is built #then each discriminated payload is exact", () => {
    // given
    const drift = { commitsSince: 40, touchedRatio: 0.2, churnLocRatio: 0.3, daysSince: 100 }
    const cases: Array<{ eligibility: EligibilityResult; expected: OmoInitDeepProposedData }> = [
      {
        eligibility: { trigger: "coverage-gap", coverage: { missingRatio: 0.75, candidateDirs: 4, coveredDirs: 1 } },
        expected: { repo: "repo", trigger: "coverage-gap", coverage: { missingRatio: 0.75, candidateDirs: 4, coveredDirs: 1 }, drift: null, suggestedMode: "local" },
      },
      ...(["commit-and-touch", "loc-churn", "snapshot-age"] as const).map(
        (trigger): { eligibility: EligibilityResult; expected: OmoInitDeepProposedData } => ({
          eligibility: { trigger, drift },
          expected: { repo: "repo", trigger, coverage: null, drift, suggestedMode: "local" },
        }),
      ),
      {
        eligibility: { trigger: "snapshot-invalid", drift: { stale: true } },
        expected: { repo: "repo", trigger: "snapshot-invalid", coverage: null, drift: { stale: true }, suggestedMode: "local" },
      },
    ]

    // when / then
    for (const entry of cases) {
      expect(buildProposedData("repo", entry.eligibility, "local")).toEqual(entry.expected)
    }
  })

  test("#given an eligible repo #when the advisor opens #then last proposed HEAD is written first", async () => {
    // given
    const root = makeCoverageRepo()
    const { pi, select, eventCtx } = createHarness(root)
    const writeLastProposedHead = spyOn(advisorState, "writeLastProposedHead")

    // when
    await runAdvisor(pi, componentContext, eventCtx)

    // then
    expect(writeLastProposedHead.mock.invocationCallOrder[0]).toBeLessThan(
      select.mock.invocationCallOrder[0],
    )
  })

  test("#given the first real prompt #when the handler returns #then ui.select has not run synchronously", async () => {
    // given
    const selected = Promise.withResolvers<void>()
    const root = makeCoverageRepo()
    const { pi, select, eventCtx } = createHarness(root, undefined, true, async () => {
      selected.resolve()
      return undefined
    })
    createInitDeepAdvisorComponent({ runAfterPreflight: runAdvisorAfterPreflight })
      .register(pi, componentContext)
    const handler = pi.handlers.find((entry) => entry.event === "before_agent_start")!.handler

    // when
    const result = handler(
      { type: "before_agent_start", trigger: "prompt", prompt: "Fix the failing test" },
      eventCtx,
    )

    // then
    expect(result).toBeUndefined()
    expect(select).not.toHaveBeenCalled()
    await selected.promise
  })

  test("#given fake timers #when the first real prompt fires #then ui.select waits for setTimeout zero", async () => {
    // given
    jest.useFakeTimers()
    const root = makeCoverageRepo()
    const { pi, select, eventCtx } = createHarness(root)
    createInitDeepAdvisorComponent({ runAfterPreflight: runAdvisorAfterPreflight })
      .register(pi, componentContext)
    const handler = pi.handlers.find((entry) => entry.event === "before_agent_start")!.handler

    // when
    handler({ type: "before_agent_start", trigger: "prompt", prompt: "Fix the failing test" }, eventCtx)

    // then
    expect(select).not.toHaveBeenCalled()
    jest.advanceTimersByTime(0)
    await Promise.resolve()
    expect(select).toHaveBeenCalledTimes(1)
  })

  test("#given a non-git cwd #when the preflight runs #then there is no --show-toplevel spawn beyond the single gitToplevel call", async () => {
    // given
    const dir = makeTempDir("omo-init-deep-nongit-")
    const { pi, select, eventCtx } = createHarness(dir)
    const originalExecFileSync = childProcess.execFileSync.bind(childProcess)
    const execFileSync = spyOn(childProcess, "execFileSync").mockImplementation(
      ((...args: Parameters<typeof childProcess.execFileSync>) => originalExecFileSync(...args)) as typeof childProcess.execFileSync,
    )

    // when
    await runAdvisor(pi, componentContext, eventCtx)

    // then
    expect(select).not.toHaveBeenCalled()
    const showToplevelCalls = execFileSync.mock.calls.filter((call) => {
      const [file, argv] = call
      return file === "git" && Array.isArray(argv) && argv.includes("--show-toplevel")
    })
    expect(showToplevelCalls).toHaveLength(1)
  })
})
