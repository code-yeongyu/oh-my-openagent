import { afterEach, describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { KibitzerGateRunner } from "./kibitzer-runner"
import { TOOL_CALL_JUDGE_DEADLINE_MS } from "./kibitzer-trigger"
import { DEAD_PRIMARY, FALLBACK_PROVIDER, fallbackProviderHarness, HEALTHY_FALLBACK } from "./kibitzer-runner.fallback-support"
import { fixture, launchInput, roots, runnerOptions } from "./kibitzer-runner.test-support"
import { rmEfaultTolerant } from "./teardown.test-support"

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rmEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }))) })

// Issue #7904, proven against the LIVE engine on the tool_call deadline: the primary rung answers
// 503 server_is_overloaded, the judge's one-retry budget re-asks it once, then senpi's retry-fallback
// controller rotates to the configured in-category rung. The default profile would instead spend
// ~62s of same-model backoff (maxRetries 5, 2s exponential) before the first rotation.
describe("KibitzerGateRunner live fallback rotation", () => {
  const UPSTREAM_503 = "OpenAI API error (503): auth_unavailable (model gpt-5.6-luna, server_is_overloaded)"
  const PRIMARY = `${FALLBACK_PROVIDER}/${DEAD_PRIMARY}`
  const FALLBACK = `${FALLBACK_PROVIDER}/${HEALTHY_FALLBACK}`
  const SETTLE_BUDGET_MS = 30_000

  async function launchWithChain(harness: ReturnType<typeof fallbackProviderHarness>) {
    const { identityPaths } = await fixture()
    const runner = new KibitzerGateRunner(runnerOptions(identityPaths, {
      createSession: harness.createSession,
      loadConfig: () => ({ config: { categories: { quick: { model: PRIMARY, fallback_models: [FALLBACK] } } }, diagnostics: [], layers: [], sources: [] }),
    }))
    const startedAt = Date.now()
    const result = await runner.launch({ ...launchInput({ modelRegistry: harness.registry }), deadlineMs: TOOL_CALL_JUDGE_DEADLINE_MS })
    return { result, elapsedMs: Date.now() - startedAt, identityPaths }
  }

  test("#given a primary rung that returns 503 and a healthy in-category fallback #when the judge runs on the tool_call deadline #then the engine rotates after one same-model retry and the turn completes", async () => {
    // given
    const harness = fallbackProviderHarness({ errorMessage: UPSTREAM_503, fallback: "stop" })

    // when
    const { result, elapsedMs, identityPaths } = await launchWithChain(harness)

    // then: one retry on the dead rung, then the rotation the chain configured; a settled turn with
    // no nudge is the judge's "empty" verdict, and it arrived well inside the 90s tool_call budget.
    expect(harness.calls).toEqual([DEAD_PRIMARY, DEAD_PRIMARY, HEALTHY_FALLBACK])
    expect(harness.events.some((event) => event.type === "retry_fallback_applied")).toBe(true)
    expect(result).toMatchObject({ status: "empty", model: "omo-mock/healthy-fallback" })
    if (result.status !== "empty" || result.runId === undefined) throw new Error("expected an empty run")
    const outcome: unknown = JSON.parse(await readFile(join(identityPaths.recall, "runs", result.runId, "outcome.json"), "utf8"))
    expect(outcome).toMatchObject({ model: "omo-mock/healthy-fallback" })
    expect(elapsedMs).toBeLessThan(SETTLE_BUDGET_MS)
  })

  test("#given every rung returns 503 #when the judge runs on the tool_call deadline #then the engine settles the turn and the gate reports child_failed_upstream long before the deadline", async () => {
    // given
    const harness = fallbackProviderHarness({ errorMessage: UPSTREAM_503, fallback: "error" })

    // when
    const { result, elapsedMs } = await launchWithChain(harness)

    // then: the primary got its one retry, the fallback rung one attempt (a switched-to rung starts
    // at attempt 1 of the same budget), the chain is exhausted, and the failure is reported from the
    // settled outcome, never as dropped/deadline.
    expect(harness.calls).toEqual([DEAD_PRIMARY, DEAD_PRIMARY, HEALTHY_FALLBACK])
    expect(result).toMatchObject({ status: "failed", cause: "child_failed_upstream", reason: expect.stringContaining("503"), model: "omo-mock/healthy-fallback" })
    expect(elapsedMs).toBeLessThan(SETTLE_BUDGET_MS)
  })
})
