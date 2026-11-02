import { afterAll, describe, expect, mock, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { setSessionAgent } from "../../features/claude-code-session-state"
import { PLANNING_CONTEXT_OPEN } from "./constants"
import {
  classifyPrometheusDelegation,
  guardPrometheusDelegation,
  PROMETHEUS_DELEGATION_REFUSED,
  PrometheusImplementationDelegationError,
  READ_ONLY_CONSULT_MARKER,
} from "./delegation-guard"
import { invokeBefore } from "./fixtures/invoke-before"

mock.module("../../shared/opencode-storage-detection", () => ({
  isSqliteBackend: () => false,
  resetSqliteBackendCache: () => {},
}))

afterAll(() => {
  mock.restore()
})

const { createPrometheusMdOnlyHook, PROMETHEUS_DELEGATION_GUARD_ENABLED } = await import("./hook")

describe("omo#10008 Prometheus delegation guard (built, not wired)", () => {
  test("classifies every category as implementation, whatever the agent", () => {
    expect(classifyPrometheusDelegation({ category: "quick", subagent_type: "explore" })).toEqual({
      kind: "implementation",
      target: "category:quick",
    })
  })

  test("classifies read-only agents by config key or display name as consultations", () => {
    expect(classifyPrometheusDelegation({ subagent_type: "explore" })).toEqual({ kind: "consult", agent: "explore" })
    expect(classifyPrometheusDelegation({ subagent_type: "Metis - Plan Consultant" })).toEqual({
      kind: "consult",
      agent: "metis",
    })
  })

  test("classifies writing agents and a missing target as implementation", () => {
    expect(classifyPrometheusDelegation({ subagent_type: "sisyphus-junior" }).kind).toBe("implementation")
    expect(classifyPrometheusDelegation({})).toEqual({ kind: "implementation", target: "(no target)" })
  })

  test("refuses an implementation delegation with a typed error", () => {
    let caught: unknown
    try {
      guardPrometheusDelegation({ category: "deep" }, "implement the plan")
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(PrometheusImplementationDelegationError)
    expect((caught as PrometheusImplementationDelegationError).code).toBe(PROMETHEUS_DELEGATION_REFUSED)
    expect((caught as PrometheusImplementationDelegationError).target).toBe("category:deep")
  })

  test("leads a consultation prompt with the marker exactly once", () => {
    const once = guardPrometheusDelegation({ subagent_type: "oracle" }, "review the plan")
    expect(once.split("\n")[0]).toBe(READ_ONLY_CONSULT_MARKER)
    expect(once.endsWith("review the plan")).toBe(true)
    expect(guardPrometheusDelegation({ subagent_type: "oracle" }, once)).toBe(once)
  })

  test("default hook path is unchanged: category delegations still get the planning block, no refusal", async () => {
    expect(PROMETHEUS_DELEGATION_GUARD_ENABLED).toBe(false)
    const sessionID = "ses_prometheus_guard_default"
    setSessionAgent(sessionID, "prometheus")
    const directory = mkdtempSync(join(tmpdir(), "prometheus-guard-"))
    const hook = createPrometheusMdOnlyHook({ client: {}, directory } as never)
    const output = { args: { category: "deep", prompt: "implement the plan" } as Record<string, unknown> }

    try {
      await invokeBefore(hook, { tool: "task", sessionID, callID: "call-1" }, output)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }

    expect(output.args.prompt).toContain(PLANNING_CONTEXT_OPEN)
    expect(output.args.prompt).not.toContain(READ_ONLY_CONSULT_MARKER)
  })
})
