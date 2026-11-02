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

  test("#given a fully covered repo #when startup runs #then no selector opens", async () => {
    // given
    const { pi, select, eventCtx } = createHarness(makeCoverageRepo(true))

    // when
    await runAdvisor(pi, componentContext, eventCtx)

    // then
    expect(select).not.toHaveBeenCalled()
  })

  test("#given the advisor is disabled #when startup runs #then no selector opens", async () => {
    // given
    const { pi, select, eventCtx } = createHarness(makeCoverageRepo())
    pi.setFlag("omo-senpi-init-deep-advisor-disabled", true)

    // when
    await runAdvisor(pi, componentContext, eventCtx)

    // then
    expect(select).not.toHaveBeenCalled()
  })

  test("#given a non-startup session #when session_start fires #then no selector opens", () => {
    // given
    const { pi, select, eventCtx } = createHarness(makeCoverageRepo())
    createInitDeepAdvisorComponent().register(pi, componentContext)
    const handler = pi.handlers.find((entry) => entry.event === "session_start")!.handler

    // when
    for (const reason of ["new", "reload", "resume", "fork"]) {
      handler({ type: "session_start", reason }, eventCtx)
    }

    // then
    expect(select).not.toHaveBeenCalled()
  })

  for (const marker of ["missing", "current"] as const) {
    test(`#given an onboarding marker that is ${marker} #when startup runs #then first-session suppression blocks the selector`, async () => {
      // given
      setTestHome(marker)
      const { pi, select, eventCtx } = createHarness(makeCoverageRepo())

      // when
      await runAdvisor(pi, componentContext, eventCtx)

      // then
      expect(select).not.toHaveBeenCalled()
    })
  }

  test("#given a non-UI mode #when startup runs #then proposal state and UI remain untouched", async () => {
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

  test("#given session_start #when the handler returns #then ui.select has not run synchronously", async () => {
    // given
    const selected = Promise.withResolvers<void>()
    const root = makeCoverageRepo()
    const { pi, select, eventCtx } = createHarness(root, undefined, true, async () => {
      selected.resolve()
      return undefined
    })
    createInitDeepAdvisorComponent({ runAfterPreflight: runAdvisorAfterPreflight })
      .register(pi, componentContext)
    const handler = pi.handlers.find((entry) => entry.event === "session_start")!.handler

    // when
    const result = handler({ type: "session_start", reason: "startup" }, eventCtx)

    // then
    expect(result).toBeUndefined()
    expect(select).not.toHaveBeenCalled()
    await selected.promise
  })

  test("#given fake timers #when session_start fires #then ui.select waits for setTimeout zero", async () => {
    // given
    jest.useFakeTimers()
    const root = makeCoverageRepo()
    const { pi, select, eventCtx } = createHarness(root)
    createInitDeepAdvisorComponent({ runAfterPreflight: runAdvisorAfterPreflight })
      .register(pi, componentContext)
    const handler = pi.handlers.find((entry) => entry.event === "session_start")!.handler

    // when
    handler({ type: "session_start", reason: "startup" }, eventCtx)

    // then
    expect(select).not.toHaveBeenCalled()
    jest.advanceTimersByTime(0)
    await Promise.resolve()
    expect(select).toHaveBeenCalledTimes(1)
  })

  test("#given a non-git cwd #when startup preflight runs #then there is no --show-toplevel spawn beyond the single gitToplevel call", async () => {
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
