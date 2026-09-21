import { describe, expect, test } from "bun:test"

import { CTX, createFakeManager, makeDeps } from "./__fixtures__/task-tool-fakes"
import type { StartResult } from "../../manager"
import { normalizeTaskToolArguments } from "./argument-normalization"
import { buildTaskExecute } from "./execute"
import { resolveSpawnItems } from "./validation"

function rejectionOf(result: ReturnType<typeof resolveSpawnItems>) {
  if (result.kind !== "error") throw new Error("expected an error result")
  if (result.error.code !== "invalid_items") throw new Error(`expected invalid_items, got ${result.error.code}`)
  return result.error
}

describe("resolveSpawnItems per-item prompt validation", () => {
  test("#given a batch item missing prompt w2drop #when resolved #then the call is rejected naming the index and field", () => {
    // given
    const params = { category: "quick", tasks: [{ prompt: "one" }, { name: "no-prompt" }] }

    // when
    const result = resolveSpawnItems(params)

    // then
    const error = rejectionOf(result)
    expect(error.rejected).toEqual([{ index: 1, field: "prompt", reason: "prompt is required and must be non-empty" }])
    expect(error.message).toContain("item 1")
    expect(error.message).toContain("prompt")
    expect(error.message).toContain("nothing was spawned")
  })

  test("#given a blank-string prompt w2drop #when resolved #then it is rejected exactly like an omitted prompt", () => {
    // given
    const params = { category: "quick", tasks: [{ prompt: "   " }] }

    // when
    const result = resolveSpawnItems(params)

    // then
    expect(rejectionOf(result).rejected).toEqual([
      { index: 0, field: "prompt", reason: "prompt is required and must be non-empty" },
    ])
  })

  test("#given several invalid items w2drop #when resolved #then EVERY offending index is reported, not just the first", () => {
    // given
    const params = {
      category: "quick",
      tasks: [{ prompt: "ok" }, { name: "a" }, { prompt: "ok2" }, { name: "b" }, { name: "c" }],
    }

    // when
    const result = resolveSpawnItems(params)

    // then
    expect(rejectionOf(result).rejected.map((entry) => entry.index)).toEqual([1, 3, 4])
  })

  test("#given a fully valid batch w2drop #when resolved #then it still resolves ok with every item (no regression)", () => {
    // given
    const params = { category: "quick", tasks: [{ prompt: "one" }, { prompt: "two" }, { prompt: "three" }] }

    // when
    const result = resolveSpawnItems(params)

    // then
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") throw new Error("expected ok")
    expect(result.items).toHaveLength(3)
  })
})

describe("resolveSpawnItems spawned + rejected == submitted invariant", () => {
  // The bug: 6 submitted, 3 spawned, 3 vanished behind a success-shaped response. The accounting
  // must balance for every batch, whether it resolves or is rejected.
  test("#given the reported 6-item batch (3 valid, 3 prompt-less) w2drop #when resolved #then spawned + rejected == submitted", () => {
    // given
    const submitted = [
      { prompt: "lane one", name: "one" },
      { category: "deep", name: "bad-one", description: "d", task_summary: "s" },
      { prompt: "lane two", name: "two" },
      { category: "deep", name: "bad-two", description: "d", task_summary: "s" },
      { prompt: "lane three", name: "three" },
      { category: "deep", name: "bad-three", description: "d", task_summary: "s" },
    ]

    // when
    const result = resolveSpawnItems({ category: "quick", tasks: submitted })

    // then
    const error = rejectionOf(result)
    expect(error.submitted).toBe(submitted.length)
    expect(error.accepted).toBe(3)
    expect(error.accepted + error.rejected.length).toBe(error.submitted)
    expect(error.rejected.map((entry) => entry.index)).toEqual([1, 3, 5])
  })

  test("#given a valid batch w2drop #when resolved #then resolved items + zero rejections == submitted", () => {
    // given
    const submitted = [{ prompt: "a" }, { prompt: "b" }, { prompt: "c" }, { prompt: "d" }]

    // when
    const result = resolveSpawnItems({ category: "quick", tasks: submitted })

    // then
    if (result.kind !== "ok") throw new Error("expected ok")
    const rejectedCount = 0
    expect(result.items.length + rejectedCount).toBe(submitted.length)
    expect(result.items).toHaveLength(4)
  })
})

describe("resolveSpawnItems inheritance precedes validation", () => {
  test("#given items carrying only a prompt w2drop #when the top level supplies the target #then inheritance makes them valid", () => {
    // given
    const params = { subagent_type: "explore", model: "openai/gpt-5.6-sol", load_skills: ["s"], tasks: [{ prompt: "one" }, { prompt: "two" }] }

    // when
    const result = resolveSpawnItems(params)

    // then
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") throw new Error("expected ok")
    expect(result.items).toHaveLength(2)
    expect(result.items[0]).toMatchObject({ kind: "subagent_type", subagentType: "explore", model: "openai/gpt-5.6-sol", load_skills: ["s"] })
    expect(result.items[1]).toMatchObject({ kind: "subagent_type", subagentType: "explore", model: "openai/gpt-5.6-sol" })
  })

  test("#given a prompt-less item alongside inheritable targets w2drop #when resolved #then only the prompt is faulted, never the inherited target", () => {
    // given
    const params = { subagent_type: "explore", model: "openai/gpt-5.6-sol", tasks: [{ prompt: "one" }, { name: "no-prompt" }] }

    // when
    const result = resolveSpawnItems(params)

    // then
    const error = rejectionOf(result)
    expect(error.rejected).toEqual([{ index: 1, field: "prompt", reason: "prompt is required and must be non-empty" }])
  })
})

describe("resolveSpawnItems category+model exclusivity still holds", () => {
  test("#given a prompt-less item and a category item inheriting a model w2drop #when resolved #then both are reported and nothing spawns", () => {
    // given
    const params = { model: "openai/gpt-5.6-luna-fast", tasks: [{ name: "no-prompt" }, { prompt: "two", category: "quick" }] }

    // when
    const result = resolveSpawnItems(params)

    // then
    const error = rejectionOf(result)
    expect(error.rejected.map((entry) => entry.index)).toEqual([0, 1])
    expect(error.rejected[1]?.reason).toContain("omo.json")
    expect(error.submitted).toBe(2)
    expect(error.accepted + error.rejected.length).toBe(error.submitted)
  })
})

describe("resolveSpawnItems reports every fault regardless of item order", () => {
  test("#given a target fault at index 0 and missing prompts after it w2drop #when resolved #then the later indices are still named", () => {
    // given
    const params = {
      tasks: [{ prompt: "a", category: "deep", subagent_type: "momus" }, { name: "b" }, { name: "c" }],
    }

    // when
    const result = resolveSpawnItems(params)

    // then
    expect(rejectionOf(result).rejected.map((entry) => entry.index)).toEqual([0, 1, 2])
  })

  test("#given the same two faults in either order w2drop #when resolved #then both orderings report both indices", () => {
    // given
    const targetFirst = { tasks: [{ prompt: "a", category: "deep", subagent_type: "momus" }, { name: "b" }] }
    const promptFirst = { tasks: [{ name: "b" }, { prompt: "a", category: "deep", subagent_type: "momus" }] }

    // when
    const targetFirstResult = rejectionOf(resolveSpawnItems(targetFirst))
    const promptFirstResult = rejectionOf(resolveSpawnItems(promptFirst))

    // then
    expect(targetFirstResult.rejected.map((entry) => entry.index)).toEqual([0, 1])
    expect(promptFirstResult.rejected.map((entry) => entry.index)).toEqual([0, 1])
    expect(targetFirstResult.accepted + targetFirstResult.rejected.length).toBe(targetFirstResult.submitted)
    expect(promptFirstResult.accepted + promptFirstResult.rejected.length).toBe(promptFirstResult.submitted)
  })

  test("#given two target faults and no prompt fault w2drop #when resolved #then both are reported, not just the first", () => {
    // given
    const params = {
      tasks: [
        { prompt: "a", category: "deep", subagent_type: "momus" },
        { prompt: "b", category: "deep", subagent_type: "momus" },
      ],
    }

    // when
    const result = resolveSpawnItems(params)

    // then
    expect(rejectionOf(result).rejected.map((entry) => entry.index)).toEqual([0, 1])
  })
})

describe("resolveSpawnItems single-spawn contract is unchanged", () => {
  test("#given a single spawn with a blank prompt w2drop #when resolved #then it reports the single-call error, not batch prose", () => {
    // given / when
    const result = resolveSpawnItems({ prompt: "   ", category: "quick" })

    // then
    expect(result.kind).toBe("error")
    if (result.kind !== "error") throw new Error("expected error")
    expect(result.error.code).toBe("no_prompt_or_tasks")
    expect(result.error.message).not.toContain("batch")
  })

  test("#given a single spawn with a target fault w2drop #when resolved #then the item_target contract still holds", () => {
    // given / when
    const result = resolveSpawnItems({ prompt: "p", category: "quick", model: "openai/gpt-5.6-luna-fast" })

    // then
    expect(result.kind).toBe("error")
    if (result.kind !== "error") throw new Error("expected error")
    expect(result.error.code).toBe("item_target")
  })
})

describe("normalizeTaskToolArguments distinguishes padding from real lanes", () => {
  test("#given a top-level prompt and prompt-less items carrying real content w2drop #when prepared #then the lanes survive instead of being absorbed as padding", () => {
    // given
    const raw = {
      category: "quick",
      run_in_background: true,
      prompt: "coordinate the audit",
      tasks: [
        { name: "lane-a", description: "ship feature A", task_summary: "A" },
        { name: "lane-b", description: "ship feature B", task_summary: "B" },
      ],
    }

    // when
    const prepared = normalizeTaskToolArguments(raw)

    // then
    expect(prepared.tasks).toHaveLength(2)
    expect(resolveSpawnItems(prepared).kind).toBe("error")
  })

  test("#given a top-level prompt and a fully contentless padding item w2drop #when prepared #then padding is still absorbed", () => {
    // given
    const raw = { prompt: "real work", subagent_type: "explore", tasks: [{}] }

    // when
    const prepared = normalizeTaskToolArguments(raw)

    // then
    expect(prepared.tasks).toBeUndefined()
    expect(prepared.prompt).toBe("real work")
  })
})

describe("normalizeTaskToolArguments preserves invalid items", () => {
  test("#given a batch whose items omit prompt w2drop #when arguments are prepared #then the items survive normalization for validation to reject", () => {
    // given
    const raw = {
      category: "quick",
      run_in_background: true,
      tasks: [{ prompt: "lane one" }, { category: "deep", name: "bad", description: "d" }],
    }

    // when
    const prepared = normalizeTaskToolArguments(raw)

    // then
    expect(prepared.tasks).toHaveLength(2)
    expect(prepared.tasks?.[1]?.prompt).toBe("")
  })

  test("#given a top-level prompt with provider padding tasks w2drop #when arguments are prepared #then padding is still dropped (no regression)", () => {
    // given
    const raw = { prompt: "real work", subagent_type: "explore", tasks: [{ prompt: "unused", category: "quick" }] }

    // when
    const prepared = normalizeTaskToolArguments(raw)

    // then
    expect(prepared.tasks).toBeUndefined()
    expect(prepared.prompt).toBe("real work")
  })
})

describe("buildTaskExecute rejects invalid batches atomically", () => {
  test("#given a background batch with prompt-less items w2drop #when executed #then nothing spawns and the result is invalid_arguments", async () => {
    // given
    const startedIds: string[] = []
    const manager = createFakeManager({
      start: async (spec): Promise<StartResult> => {
        startedIds.push(spec.name ?? "unnamed")
        return { kind: "started", task_id: `st_${startedIds.length}`, status: "running", name: spec.name ?? "unnamed" }
      },
    })
    const execute = buildTaskExecute(makeDeps(manager))

    // when
    // Routed through the tool's real prepareArguments hook, because that hook is where the
    // reported incident destroyed the malformed items before validation could see them.
    const params = normalizeTaskToolArguments({
      category: "quick",
      run_in_background: true,
      tasks: [
        { prompt: "lane one", name: "one" },
        { name: "bad-one", description: "d", task_summary: "s" },
        { prompt: "lane two", name: "two" },
        { name: "bad-two", description: "d", task_summary: "s" },
        { prompt: "lane three", name: "three" },
        { name: "bad-three", description: "d", task_summary: "s" },
      ],
    })
    const output = await execute("batch-invalid", params, undefined, undefined, CTX)

    // then
    expect(startedIds).toEqual([])
    expect(output.details.status).toBe("invalid_arguments")
    expect(output.details.items).toBeUndefined()
    const text = output.content[0]?.type === "text" ? output.content[0].text : ""
    expect(text).not.toContain("Batch running.")
    expect(text).toContain("item 1")
    expect(text).toContain("item 3")
    expect(text).toContain("item 5")
    expect(text).toContain("3 of 6")
  })

  test("#given a fully valid background batch w2drop #when executed #then every item still spawns (no regression)", async () => {
    // given
    const startedIds: string[] = []
    const manager = createFakeManager({
      start: async (spec): Promise<StartResult> => {
        startedIds.push(spec.name ?? "unnamed")
        return { kind: "started", task_id: `st_${startedIds.length}`, status: "running", name: spec.name ?? "unnamed" }
      },
    })
    const execute = buildTaskExecute(makeDeps(manager))

    // when
    const output = await execute(
      "batch-valid",
      {
        category: "quick",
        run_in_background: true,
        tasks: [
          { prompt: "lane one", name: "one" },
          { prompt: "lane two", name: "two" },
          { prompt: "lane three", name: "three" },
        ],
      },
      undefined,
      undefined,
      CTX,
    )

    // then
    expect(startedIds).toEqual(["one", "two", "three"])
    expect(output.details.status).toBe("running")
    expect(output.details.items).toHaveLength(3)
  })
})
