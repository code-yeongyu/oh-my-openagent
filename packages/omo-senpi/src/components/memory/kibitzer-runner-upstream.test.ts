import { afterEach, describe, expect, test } from "bun:test"
import type { ChildSessionEvent } from "@oh-my-opencode/senpi-task"
import type { ComponentLogger } from "../../extension/types"
import { KibitzerGateRunner } from "./kibitzer-runner"
import { fixture, launchInput, nudgeOnce, roots, runnerOptions, scriptedSession } from "./kibitzer-runner.test-support"
import { rmEfaultTolerant } from "./teardown.test-support"

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rmEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }))) })

describe("KibitzerGateRunner settled upstream failure", () => {
  // Issue #7904: the judge child now carries the quick chain and a one-retry same-model budget, so
  // the engine itself rotates rungs and settles the turn once the chain is exhausted. The gate
  // classifies from that settled outcome; an upstream-shaped error event mid-turn is the engine's
  // recovery in progress, never a verdict.
  const UPSTREAM_503 = "OpenAI API error (503): auth_unavailable (model gpt-5.6-luna, server_is_overloaded)"

  function gateLogger(): { logger: ComponentLogger; warnings: { readonly message: string; readonly details: unknown }[] } {
    const warnings: { readonly message: string; readonly details: unknown }[] = []
    return {
      warnings,
      logger: {
        info: () => {},
        warn: (message, details) => { warnings.push({ message, details }) },
        error: () => {},
      },
    }
  }

  function providerFailure(errorMessage: string): ChildSessionEvent {
    return { type: "message_end", message: { role: "assistant", content: [], stopReason: "error", errorMessage } }
  }

  test("#given a child turn that settles with an upstream provider error #when the gate classifies it #then the result is failed/child_failed_upstream with the reason and the operator log line", async () => {
    // given: every rung failed and the engine ended the turn with the last provider error
    const { identityPaths } = await fixture()
    const stub = scriptedSession(async () => {}, { stopReason: "error", errorMessage: UPSTREAM_503 })
    const { logger, warnings } = gateLogger()
    const runner = new KibitzerGateRunner(runnerOptions(identityPaths, { createSession: stub.createSession, logger }))

    // when
    const result = await runner.launch({ ...launchInput(), deadlineMs: 5_000 })

    // then
    expect(result).toMatchObject({
      status: "failed",
      cause: "child_failed_upstream",
      reason: expect.stringContaining("OpenAI API error (503)"),
    })
    expect(warnings.some((call) => call.message === "kibitzer gate child failed")).toBe(true)
  })

  test("#given an upstream failure event the engine recovers from #when the turn completes with a nudge #then the result is nudged, not failed", async () => {
    // given: the primary rung failed, the engine rotated, and the fallback rung judged the candidates
    const { identityPaths } = await fixture()
    const stub = scriptedSession(async (options, emit) => {
      emit(providerFailure(UPSTREAM_503))
      await nudgeOnce(options)
    })
    const runner = new KibitzerGateRunner(runnerOptions(identityPaths, { createSession: stub.createSession }))

    // when
    const pending = runner.launch({ ...launchInput(), deadlineMs: 5_000 })
    stub.resolve()
    const result = await pending

    // then
    expect(result).toMatchObject({ status: "nudged" })
  })

  test("#given a child turn that settles with a non-upstream error #when the gate classifies it #then the cause stays child_failed", async () => {
    // given
    const { identityPaths } = await fixture()
    const stub = scriptedSession(async () => {}, { stopReason: "error", errorMessage: "local nudge closure rejected the call" })
    const runner = new KibitzerGateRunner(runnerOptions(identityPaths, { createSession: stub.createSession }))

    // when
    const result = await runner.launch({ ...launchInput(), deadlineMs: 5_000 })

    // then
    expect(result).toMatchObject({ status: "failed", cause: "child_failed", reason: "local nudge closure rejected the call" })
  })

  test("#given a pending turn that emits nothing #when the gate awaits it #then the deadline backstop drops", async () => {
    // given: a genuinely silent child keeps the deadline as its only exit.
    const { identityPaths } = await fixture()
    const stub = scriptedSession(() => new Promise<void>(() => {}))
    const { logger, warnings } = gateLogger()
    const runner = new KibitzerGateRunner(runnerOptions(identityPaths, { createSession: stub.createSession, logger }))

    // when
    const result = await runner.launch({ ...launchInput(), deadlineMs: 300 })

    // then
    expect(result).toMatchObject({ status: "dropped", cause: "deadline" })
    expect(warnings.some((call) => call.message === "kibitzer gate deadline exceeded")).toBe(true)
  })
})
