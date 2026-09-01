import { describe, expect, test } from "bun:test"

import type { ManagerStartSpec, StartResult } from "../../manager"
import { CTX, createFakeManager, makeDeps } from "./__fixtures__/task-tool-fakes"
import { buildTaskExecute } from "./execute"

describe("buildTaskExecute skill delivery", () => {
  test("#given load_skills #when spawning #then resolved SKILL.md content is prepended to the child prompt", async () => {
    let captured: ManagerStartSpec | undefined
    const manager = createFakeManager({
      start: async (spec): Promise<StartResult> => {
        captured = spec
        return { kind: "started", task_id: "st_00000003", status: "running", name: "t" }
      },
    })
    const execute = buildTaskExecute(makeDeps(manager, {
      loadSkills: (names) => ({
        prepend: names.length > 0 ? "SKILL DIRECTIVE\n\n" : "",
        resolved: names,
        missing: [],
      }),
    }))

    await execute(
      "resolved-skill",
      { prompt: "do the thing", category: "quick", load_skills: ["reviewer"], run_in_background: true },
      undefined,
      undefined,
      CTX,
    )

    expect(captured?.prompt.startsWith("SKILL DIRECTIVE")).toBe(true)
    expect(captured?.prompt.endsWith("do the thing")).toBe(true)
  })

  test("#given a missing requested skill #when background spawn succeeds #then the task result reports it without failing", async () => {
    const manager = createFakeManager({
      start: async (): Promise<StartResult> => ({
        kind: "started",
        task_id: "st_00000016",
        status: "running",
        name: "missing-skill-task",
      }),
    })
    const execute = buildTaskExecute(makeDeps(manager, {
      loadSkills: (names) => ({
        prepend: "",
        resolved: [],
        missing: names,
      }),
    }))

    const result = await execute(
      "missing-skill",
      { prompt: "continue anyway", category: "quick", load_skills: ["ghost"], run_in_background: true },
      undefined,
      undefined,
      CTX,
    )

    const text = result.content[0]?.type === "text" ? result.content[0].text : ""
    expect(result.details.status).toBe("running")
    expect(result.details.skills).toEqual({ requested: ["ghost"], resolved: [], missing: ["ghost"] })
    expect(text).toContain("Missing skills: ghost")
  })
})
