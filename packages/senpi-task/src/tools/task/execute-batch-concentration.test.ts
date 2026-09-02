import { describe, expect, test } from "bun:test"

import type { StartResult } from "../../manager"
import type { TaskRecord } from "../../state"
import { CTX, createFakeManager, makeDeps, makeRecord } from "./__fixtures__/task-tool-fakes"
import { PROVIDER_CONCENTRATION_THRESHOLD } from "./batch-concentration"
import { buildTaskExecute } from "./execute"

const IDS = ["st_wave_1", "st_wave_2", "st_wave_3", "st_wave_4"]

function textOf(result: Awaited<ReturnType<ReturnType<typeof buildTaskExecute>>>): string {
  const content = result.content[0]
  return content?.type === "text" ? content.text : ""
}

function startedWithModel(taskId: string, name: string, provider: string, modelId: string): StartResult {
  return {
    kind: "started",
    task_id: taskId,
    status: "running",
    name,
    resolved_model: { provider, model_id: modelId, display: `${provider}/${modelId}`, source: "category" },
  }
}

function waveManager(provider: string, modelId: string) {
  let startIndex = 0
  return createFakeManager({
    start: async (): Promise<StartResult> => {
      const taskId = IDS[startIndex]
      if (taskId === undefined) throw new Error("unexpected extra start")
      startIndex += 1
      return startedWithModel(taskId, `item-${startIndex}`, provider, modelId)
    },
    waitFor: async (taskId): Promise<TaskRecord> => makeRecord({ task_id: taskId, status: "completed" }),
  })
}

describe("buildTaskExecute batch provider concentration warning", () => {
  test(`#given a wave of ${PROVIDER_CONCENTRATION_THRESHOLD} visual-engineering items resolving to one model #when the sync batch settles #then the output carries the concentration warning naming the category and model`, async () => {
    // given
    const manager = waveManager("anthropic", "claude-opus-5")
    const execute = buildTaskExecute(makeDeps(manager))

    // when
    const output = await execute(
      "concentrated-wave",
      {
        category: "visual-engineering",
        tasks: [{ prompt: "one" }, { prompt: "two" }, { prompt: "three" }, { prompt: "four" }],
      },
      undefined,
      undefined,
      CTX,
    )

    // then
    const text = textOf(output)
    expect(text).toContain("Provider concentration warning")
    expect(text).toContain('category "visual-engineering"')
    expect(text).toContain("anthropic/claude-opus-5")
  })

  test("#given three visual-engineering items on one model #when executed #then no concentration warning appears below the threshold", async () => {
    // given
    const manager = waveManager("anthropic", "claude-opus-5")
    const execute = buildTaskExecute(makeDeps(manager))

    // when
    const output = await execute(
      "small-wave",
      {
        category: "visual-engineering",
        tasks: [{ prompt: "one" }, { prompt: "two" }, { prompt: "three" }],
      },
      undefined,
      undefined,
      CTX,
    )

    // then
    expect(textOf(output)).not.toContain("Provider concentration warning")
  })

  test("#given a mixed wave split across two models #when executed #then no single model reaches concentration", async () => {
    // given
    const starts: readonly StartResult[] = [
      startedWithModel(IDS[0], "one", "anthropic", "claude-opus-5"),
      startedWithModel(IDS[1], "two", "anthropic", "claude-opus-5"),
      startedWithModel(IDS[2], "three", "google", "gemini-flash"),
      startedWithModel(IDS[3], "four", "google", "gemini-flash"),
    ]
    let startIndex = 0
    const manager = createFakeManager({
      start: async (): Promise<StartResult> => {
        const next = starts[startIndex]
        if (next === undefined) throw new Error("unexpected extra start")
        startIndex += 1
        return next
      },
      waitFor: async (taskId): Promise<TaskRecord> => makeRecord({ task_id: taskId, status: "completed" }),
    })
    const execute = buildTaskExecute(makeDeps(manager))

    // when
    const output = await execute(
      "dispersed-wave",
      {
        category: "visual-engineering",
        tasks: [{ prompt: "one" }, { prompt: "two" }, { prompt: "three" }, { prompt: "four" }],
      },
      undefined,
      undefined,
      CTX,
    )

    // then
    expect(textOf(output)).not.toContain("Provider concentration warning")
  })
})
