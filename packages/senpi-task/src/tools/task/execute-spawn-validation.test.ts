import { describe, expect, test } from "bun:test"

import type { ManagerStartSpec, StartResult } from "../../manager"
import { CTX, createFakeManager, makeDeps } from "./__fixtures__/task-tool-fakes"
import { buildTaskExecute } from "./execute"

describe("buildTaskExecute spawn validation", () => {
  test("#given both category and subagent_type #when executed #then it returns the XOR error result without spawning", async () => {
    let started = false
    const manager = createFakeManager({
      start: async (): Promise<StartResult> => {
        started = true
        return { kind: "started", task_id: "st_x", status: "running", name: "t" }
      },
    })
    const execute = buildTaskExecute(makeDeps(manager))

    const result = await execute(
      "c",
      { prompt: "p", category: "quick", subagent_type: "momus" },
      undefined,
      undefined,
      CTX,
    )

    expect(started).toBe(false)
    expect(result.details.status).toBe("invalid_arguments")
    const text = result.content[0]?.type === "text" ? result.content[0].text : ""
    expect(text).toContain("EITHER category OR subagent_type")
  })

  test("#given an unknown category #when executed #then it returns the category-listing plan error", async () => {
    const manager = createFakeManager({
      start: async (): Promise<StartResult> => ({
        kind: "plan_unresolved",
        error: {
          code: "unknown_target",
          message: 'Category "nope" not found',
          availableCategories: ["quick", "deep"],
        },
      }),
    })
    const execute = buildTaskExecute(makeDeps(manager))

    const result = await execute("c", { prompt: "p", category: "nope" }, undefined, undefined, CTX)

    expect(result.details.status).toBe("plan_error")
    const text = result.content[0]?.type === "text" ? result.content[0].text : ""
    expect(text).toContain("quick")
    expect(text).toContain("deep")
  })

  test("#given an injected ancestry #when spawning #then child depth and root derive from it", async () => {
    let captured: ManagerStartSpec | undefined
    const manager = createFakeManager({
      start: async (spec): Promise<StartResult> => {
        captured = spec
        return { kind: "started", task_id: "st_0000000f", status: "running", name: "t" }
      },
    })
    const deps = makeDeps(manager, { resolveAncestry: () => ({ depth: 2, rootSessionId: "root-session" }) })
    const execute = buildTaskExecute(deps)

    await execute("c", { prompt: "p", category: "quick", run_in_background: true }, undefined, undefined, CTX)

    expect(captured?.depth).toBe(3)
    expect(captured?.root_session_id).toBe("root-session")
  })

  test("#given category with model #when executed #then it returns the exclusivity error without spawning", async () => {
    let started = false
    const manager = createFakeManager({
      start: async (): Promise<StartResult> => {
        started = true
        return { kind: "started", task_id: "st_x", status: "running", name: "t" }
      },
    })
    const execute = buildTaskExecute(makeDeps(manager))

    const result = await execute(
      "c",
      { prompt: "p", category: "architect", model: "quotio-openai/gpt-5.6-luna-fast" },
      undefined,
      undefined,
      CTX,
    )

    expect(started).toBe(false)
    expect(result.details.status).toBe("invalid_arguments")
    const text = result.content[0]?.type === "text" ? result.content[0].text : ""
    expect(text).toContain("omo.json")
  })

})
