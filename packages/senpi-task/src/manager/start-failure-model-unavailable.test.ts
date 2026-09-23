import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { RunnerError } from "../runners/in-process"
import type { ResolvedModelRecord } from "../state"
import type { ChildPlanner } from "./types"
import { FakeRunner, cleanupProjects, makeManager } from "./__fixtures__/manager-fakes"

// Same shape start-failure-security.test.ts uses: a message carrying a credential, so any surface
// that starts echoing `RunnerFailure.message` fails loudly instead of leaking quietly.
const ADVERSARIAL_ERROR = "ENOENT /Users/alice/.config/senpi/credentials.json api_key=sk-live-secret"
const GENERIC_START_FAILURE = "Task runner failed to start."

const RESOLVED_MODEL: ResolvedModelRecord = {
  provider: "glm-zcode",
  model_id: "glm-5.3",
  display: "glm-zcode/glm-5.3",
  reasoning_effort: "max",
  source: "category",
}

const planner: ChildPlanner = () => ({
  kind: "resolved",
  plan: { model: "glm-zcode/glm-5.3", resolved_model: RESOLVED_MODEL, category: "unspecified-high" },
})

afterEach(cleanupProjects)

describe("model_unavailable start failures", () => {
  test("#given admission refused because the model is absent from the child profile #when the task starts #then the caller is told the child-profile cause instead of the generic sentence", async () => {
    // given: the exact failure `createRpcModelAdmission` raises when a package-provided provider is
    // missing from a process child (#8492). The free-text message stays untrusted; the reason does not.
    const runner = new FakeRunner()
    runner.startError = new RunnerError({
      kind: "model_unavailable",
      reason: "model_not_in_child_profile",
      message: `process model admission failed for glm-zcode/glm-5.3: ${ADVERSARIAL_ERROR}`,
    })
    const { manager } = makeManager({ planner, process: runner, config: undefined })

    // when
    const result = await manager.start({
      prompt: "work",
      parent_session_id: "parent-1",
      depth: 1,
      category: "unspecified-high",
      execution_mode: "process",
    })

    // then: actionable, and specific enough to point at the cause the probe actually found.
    if (result.kind !== "start_failed") throw new Error("expected start_failed")
    expect(result.error_message).toBe(
      "The task child cannot serve this model: its provider is not present in the child profile.",
    )
    expect(result.failure_kind).toBe("model_unavailable")
  })

  test("#given a catalog probe that timed out #when the task starts #then the caller is told the probe timed out", async () => {
    // given
    const runner = new FakeRunner()
    runner.startError = new RunnerError({
      kind: "model_unavailable",
      reason: "catalog_probe_timed_out",
      message: "process model admission failed for glm-zcode/glm-5.3: catalog probe timed out",
    })
    const { manager } = makeManager({ planner, process: runner })

    // when
    const result = await manager.start({
      prompt: "work",
      parent_session_id: "parent-1",
      depth: 1,
      category: "unspecified-high",
      execution_mode: "process",
    })

    // then
    if (result.kind !== "start_failed") throw new Error("expected start_failed")
    expect(result.error_message).toBe(
      "The task child could not confirm this model in time: its model catalog probe timed out.",
    )
  })

  test("#given a model_unavailable failure carrying a credential in its message #when the task starts #then no public or persisted surface contains it", async () => {
    // given
    const runner = new FakeRunner()
    runner.startError = new RunnerError({
      kind: "model_unavailable",
      reason: "model_not_in_child_profile",
      message: ADVERSARIAL_ERROR,
      cause: new Error(ADVERSARIAL_ERROR),
    })
    const { manager, store } = makeManager({ planner, process: runner })

    // when
    const result = await manager.start({
      prompt: "private prompt payload",
      parent_session_id: "parent-1",
      depth: 1,
      category: "unspecified-high",
      execution_mode: "process",
    })

    // then
    if (result.kind !== "start_failed") throw new Error("expected start_failed")
    const persisted = store.load(result.task_id)
    const eventLog = readFileSync(join(store.stateDir, "logs", `${result.task_id}.jsonl`), "utf8")
    const everything = JSON.stringify({ result, persisted, eventLog })
    expect(everything).not.toContain(ADVERSARIAL_ERROR)
    expect(everything).not.toContain("sk-live-secret")
    expect(everything).not.toContain("credentials.json")
    // and: the reason still reached the durable event log as a closed enum.
    expect(eventLog).toContain('"failure_reason":"model_not_in_child_profile"')
  })

  test("#given a model_unavailable failure whose reason is not a known member #when the task starts #then it reports the classification without echoing the reason", async () => {
    // given: the reason is only ever used as a lookup key, so an unexpected value can never be echoed.
    // The kind itself is still trustworthy, so the caller keeps the model-unavailable classification.
    const runner = new FakeRunner()
    runner.startError = new RunnerError({
      kind: "model_unavailable",
      // biome-ignore lint/suspicious/noExplicitAny: proving the lookup is total against an off-enum value.
      reason: ADVERSARIAL_ERROR as any,
      message: ADVERSARIAL_ERROR,
    })
    const { manager } = makeManager({ planner, process: runner })

    // when
    const result = await manager.start({
      prompt: "work",
      parent_session_id: "parent-1",
      depth: 1,
      category: "unspecified-high",
      execution_mode: "process",
    })

    // then
    if (result.kind !== "start_failed") throw new Error("expected start_failed")
    expect(result.error_message).toBe("The task child cannot serve this model.")
    expect(result.error_message).not.toBe(GENERIC_START_FAILURE)
    expect(JSON.stringify(result)).not.toContain(ADVERSARIAL_ERROR)
  })

  test("#given a model_unavailable failure with no reason at all #when the task starts #then it still reports the model-unavailable classification", async () => {
    // given: older call sites raise model_unavailable without a reason; they must not regress to the
    // fully generic sentence, because the kind alone already tells the caller what class of failure it is.
    const runner = new FakeRunner()
    runner.startError = new RunnerError({ kind: "model_unavailable", message: ADVERSARIAL_ERROR })
    const { manager } = makeManager({ planner, process: runner })

    // when
    const result = await manager.start({
      prompt: "work",
      parent_session_id: "parent-1",
      depth: 1,
      category: "unspecified-high",
      execution_mode: "process",
    })

    // then
    if (result.kind !== "start_failed") throw new Error("expected start_failed")
    expect(result.error_message).toBe("The task child cannot serve this model.")
    expect(JSON.stringify(result)).not.toContain(ADVERSARIAL_ERROR)
  })
})
