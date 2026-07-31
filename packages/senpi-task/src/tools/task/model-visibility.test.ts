import { describe, expect, test } from "bun:test"

import type { StartResult } from "../../manager"
import { CTX, createFakeManager } from "./__fixtures__/task-tool-fakes"
import { executeBatch } from "./execute-batch"
import { taskResultLines } from "./renderers"

const RESOLVED_MODEL = {
  source: "category" as const,
  provider: "quotio-openai",
  model_id: "gpt-5.4-mini-fast",
  display: "quotio-openai/gpt-5.4-mini-fast",
}

describe("batch task model visibility", () => {
  test("#given a category task resolves to a model #when batch spawn renders #then the item names both", async () => {
    // given
    const started: StartResult = {
      kind: "started",
      task_id: "st_model",
      status: "running",
      name: "model-audit",
      resolved_model: RESOLVED_MODEL,
    }
    const manager = createFakeManager({})

    // when
    const output = await executeBatch({
      manager,
      items: [
        {
          kind: "category",
          category: "quick",
          prompt: "audit the model",
          name: "model-audit",
          load_skills: [],
        },
      ],
      signal: undefined,
      ctx: CTX,
      runInBackground: true,
      startItem: async () => started,
    })
    const itemLine = taskResultLines(output.details)[1]

    // then
    expect(itemLine).toContain("category:quick")
    expect(itemLine).toContain("model:quotio-openai/gpt-5.4-mini-fast")
    expect(itemLine).not.toContain("requested/model")
  })
})
