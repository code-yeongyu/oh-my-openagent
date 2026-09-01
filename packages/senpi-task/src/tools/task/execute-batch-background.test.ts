import { describe, expect, test } from "bun:test"

import type { StartResult } from "../../manager"
import { CTX, createFakeManager, makeDeps } from "./__fixtures__/task-tool-fakes"
import { buildTaskExecute } from "./execute"

const IDS = ["st_batch_1", "st_batch_2", "st_batch_3"]

function textOf(result: Awaited<ReturnType<ReturnType<typeof buildTaskExecute>>>): string {
  const content = result.content[0]
  return content?.type === "text" ? content.text : ""
}

function started(
  taskId: string,
  name: string,
  status: "running" | "pending" = "running",
  queuePosition?: number,
): StartResult {
  return {
    kind: "started",
    task_id: taskId,
    status,
    name,
    ...(queuePosition === undefined ? {} : { queue_position: queuePosition }),
  }
}

function startFailed(taskId: string, name: string, message: string): StartResult {
  return {
    kind: "start_failed",
    task_id: taskId,
    name,
    category: "quick",
    execution_mode: "in-process",
    model: "test/model",
    run_in_background: true,
    error_message: message,
  }
}

describe("buildTaskExecute background batch fanout", () => {
  test("#given background capacity one #when three items start #then all ids and queue positions return as running", async () => {
    const starts = [started(IDS[0], "one"), started(IDS[1], "two", "pending", 1), started(IDS[2], "three", "pending", 2)]
    let startIndex = 0
    const manager = createFakeManager({
      start: async (): Promise<StartResult> => {
        const next = starts[startIndex]
        if (next === undefined) throw new Error("unexpected extra start")
        startIndex += 1
        return next
      },
    })

    const output = await buildTaskExecute(makeDeps(manager))(
      "batch-background",
      { category: "quick", run_in_background: true, tasks: [{ prompt: "one" }, { prompt: "two" }, { prompt: "three" }] },
      undefined,
      undefined,
      CTX,
    )

    expect(output.details).toMatchObject({ task_id: IDS[0], status: "running", run_in_background: true })
    expect(output.details.items).toEqual([
      { task_id: IDS[0], name: "one", category: "quick", status: "running" },
      { task_id: IDS[1], name: "two", category: "quick", status: "pending", queue_position: 1 },
      { task_id: IDS[2], name: "three", category: "quick", status: "pending", queue_position: 2 },
    ])
    for (const taskId of IDS) expect(textOf(output)).toContain(`task_send(to="${taskId}"`)
  })

  test("#given inherited and item load_skills #when background items start #then each result reports its own resolution", async () => {
    let startIndex = 0
    const prompts: string[] = []
    const manager = createFakeManager({
      start: async (spec): Promise<StartResult> => {
        prompts.push(spec.prompt)
        const taskId = IDS[startIndex]
        if (taskId === undefined) throw new Error("unexpected extra start")
        startIndex += 1
        return started(taskId, `item-${startIndex}`)
      },
    })
    const execute = buildTaskExecute(makeDeps(manager, {
      loadSkills: (names) => {
        const resolved = names.filter((name) => name !== "ghost")
        return {
          prepend: resolved.length === 0 ? "" : `${resolved.join("+")} DIRECTIVE\n\n`,
          resolved,
          missing: names.filter((name) => name === "ghost"),
        }
      },
    }))

    const output = await execute(
      "batch-skills",
      {
        category: "quick",
        run_in_background: true,
        load_skills: ["shared"],
        tasks: [
          { prompt: "one" },
          { prompt: "two", load_skills: ["specific", "ghost"] },
        ],
      },
      undefined,
      undefined,
      CTX,
    )

    expect(prompts).toEqual(["shared DIRECTIVE\n\none", "specific DIRECTIVE\n\ntwo"])
    expect(output.details.items?.[0]?.skills).toEqual({
      requested: ["shared"],
      resolved: ["shared"],
      missing: [],
    })
    expect(output.details.items?.[1]?.skills).toEqual({
      requested: ["specific", "ghost"],
      resolved: ["specific"],
      missing: ["ghost"],
    })
    expect(textOf(output)).toContain("Missing skills: ghost")
  })

  test("#given every background start fails #when results are aggregated #then status is error instead of running", async () => {
    let startIndex = 0
    const manager = createFakeManager({
      start: async (): Promise<StartResult> => {
        const taskId = IDS[startIndex]
        if (taskId === undefined) throw new Error("unexpected extra start")
        startIndex += 1
        return startFailed(taskId, `item-${startIndex}`, `failed:${taskId}`)
      },
    })

    const output = await buildTaskExecute(makeDeps(manager))(
      "batch-all-failed",
      { category: "quick", run_in_background: true, tasks: [{ prompt: "one" }, { prompt: "two" }, { prompt: "three" }] },
      undefined,
      undefined,
      CTX,
    )

    expect(output.details.task_id).toBe("")
    expect(output.details.status).toBe("error")
    expect(output.details.items?.map((item) => item.error_message)).toEqual(IDS.map((taskId) => `failed:${taskId}`))
  })
})
