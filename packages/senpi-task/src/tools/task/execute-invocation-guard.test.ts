import { describe, expect, test } from "bun:test"

import type { StartResult } from "../../manager"
import type { SkillInvocationState } from "../../agents"
import { CTX, createFakeManager, makeDeps } from "./__fixtures__/task-tool-fakes"
import { buildTaskExecute } from "./execute"

function resolverFor(opts: {
  readonly invoked?: readonly string[]
  readonly requested?: readonly string[]
  readonly artifact?: boolean
}): (sessionId: string) => SkillInvocationState {
  return () => ({
    hasInvoked: (name: string) => (opts.invoked ?? []).includes(name),
    hasUserRequested: (name: string) => (opts.requested ?? []).includes(name),
    hasPlanArtifact: () => opts.artifact ?? false,
    planArtifactReferences: () =>
      opts.artifact === true ? [{ path: ".omo/plans/gate-plan.md", count: 1, lastTouchedAt: 1 }] : [],
  })
}

function startedManager(calls: { count: number }) {
  return createFakeManager({
    start: async (): Promise<StartResult> => {
      calls.count += 1
      return { kind: "started", task_id: "st_gate", status: "running", name: "t" }
    },
  })
}

function resultText(result: { content: readonly { type: string; text?: string }[] }): string {
  const first = result.content[0]
  return first !== undefined && first.type === "text" ? (first.text ?? "") : ""
}

describe("buildTaskExecute plan-gated agents", () => {
  test("#given no skill-invocation resolver wired #when spawning momus #then it fails closed without starting the manager", async () => {
    // given
    const calls = { count: 0 }
    const execute = buildTaskExecute(makeDeps(startedManager(calls)))

    // when
    const result = await execute("c", { prompt: "p", subagent_type: "momus" }, undefined, undefined, CTX)

    // then
    expect(calls.count).toBe(0)
    expect(result.details.status).toBe("denied")
    expect(resultText(result)).toContain("ulw-plan")
  })

  test("#given a session with no skill invocations #when spawning momus #then it denies and names the ulw-plan requirement", async () => {
    // given
    const calls = { count: 0 }
    const execute = buildTaskExecute(makeDeps(startedManager(calls), { resolveSkillInvocations: resolverFor({}) }))

    // when
    const result = await execute("c", { prompt: "p", subagent_type: "momus" }, undefined, undefined, CTX)

    // then
    expect(calls.count).toBe(0)
    expect(result.details.status).toBe("denied")
    expect(resultText(result)).toContain("ulw-plan")
  })

  test("#given a session with no skill invocations #when spawning metis #then it denies and names the ulw-plan requirement", async () => {
    // given
    const calls = { count: 0 }
    const execute = buildTaskExecute(makeDeps(startedManager(calls), { resolveSkillInvocations: resolverFor({}) }))

    // when
    const result = await execute("c", { prompt: "p", subagent_type: "metis" }, undefined, undefined, CTX)

    // then
    expect(calls.count).toBe(0)
    expect(result.details.status).toBe("denied")
    expect(resultText(result)).toContain("ulw-plan")
  })

  test("#given a session with only a SKILL.md-read invocation #when spawning momus #then it stays denied", async () => {
    // given
    const calls = { count: 0 }
    const execute = buildTaskExecute(
      makeDeps(startedManager(calls), { resolveSkillInvocations: resolverFor({ invoked: ["ulw-plan"], artifact: true }) }),
    )

    // when
    const result = await execute("c", { prompt: "p", subagent_type: "momus" }, undefined, undefined, CTX)

    // then
    expect(calls.count).toBe(0)
    expect(result.details.status).toBe("denied")
  })

  test("#given a user-requested ulw-plan session with a plan artifact #when spawning momus #then the gate opens and the manager starts", async () => {
    // given
    const calls = { count: 0 }
    const execute = buildTaskExecute(
      makeDeps(startedManager(calls), { resolveSkillInvocations: resolverFor({ requested: ["ulw-plan"], artifact: true }) }),
    )

    // when
    const result = await execute("c", { prompt: "p", subagent_type: "momus", run_in_background: true }, undefined, undefined, CTX)

    // then
    expect(calls.count).toBe(1)
    expect(result.details.status).not.toBe("denied")
  })

  test("#given a user-requested plan session that then invoked start-work #when spawning momus #then it denies and names start-work", async () => {
    // given
    const calls = { count: 0 }
    const execute = buildTaskExecute(
      makeDeps(startedManager(calls), {
        resolveSkillInvocations: resolverFor({ requested: ["ulw-plan"], artifact: true, invoked: ["start-work"] }),
      }),
    )

    // when
    const result = await execute("c", { prompt: "p", subagent_type: "momus" }, undefined, undefined, CTX)

    // then
    expect(calls.count).toBe(0)
    expect(result.details.status).toBe("denied")
    expect(resultText(result)).toContain("start-work")
  })

  test("#given a session that invoked only start-work #when spawning momus #then the forbidden denial takes precedence", async () => {
    // given
    const calls = { count: 0 }
    const execute = buildTaskExecute(makeDeps(startedManager(calls), { resolveSkillInvocations: resolverFor({ invoked: ["start-work"] }) }))

    // when
    const result = await execute("c", { prompt: "p", subagent_type: "momus" }, undefined, undefined, CTX)

    // then
    expect(calls.count).toBe(0)
    expect(result.details.status).toBe("denied")
    expect(resultText(result)).toContain("start-work")
  })

  test("#given a session with no skill invocations #when spawning explore #then the gate does not apply and the manager starts", async () => {
    // given
    const calls = { count: 0 }
    const execute = buildTaskExecute(makeDeps(startedManager(calls), { resolveSkillInvocations: resolverFor({}) }))

    // when
    const result = await execute("c", { prompt: "p", subagent_type: "explore", run_in_background: true }, undefined, undefined, CTX)

    // then
    expect(calls.count).toBe(1)
    expect(result.details.status).not.toBe("denied")
  })

  test("#given a session with no skill invocations #when spawning a category #then the gate does not apply and the manager starts", async () => {
    // given
    const calls = { count: 0 }
    const execute = buildTaskExecute(makeDeps(startedManager(calls), { resolveSkillInvocations: resolverFor({}) }))

    // when
    const result = await execute("c", { prompt: "p", category: "quick", run_in_background: true }, undefined, undefined, CTX)

    // then
    expect(calls.count).toBe(1)
    expect(result.details.status).not.toBe("denied")
  })

  test("#given a batch with a gated item and no skill invocations #when executed #then the gated item fails with the gate message and never reaches the manager", async () => {
    // given
    const calls = { count: 0 }
    const execute = buildTaskExecute(makeDeps(startedManager(calls), { resolveSkillInvocations: resolverFor({}) }))

    // when
    const result = await execute(
      "c",
      { tasks: [{ prompt: "review the plan", subagent_type: "momus" }, { prompt: "scan", subagent_type: "explore" }], run_in_background: true },
      undefined,
      undefined,
      CTX,
    )

    // then
    expect(calls.count).toBe(1)
    const items = result.details.items ?? []
    const gated = items.find((item) => (item.error_message ?? "").includes("plan-gated"))
    const plain = items.find((item) => item.subagent_type === "explore")
    expect(gated?.status).toBe("error")
    expect(gated?.error_message ?? "").toContain("ulw-plan")
    expect(plain?.status).not.toBe("error")
  })
})
