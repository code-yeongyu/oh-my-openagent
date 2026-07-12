import { describe, expect, test } from "bun:test"

import type { ResolvedSpawnItem, TaskToolDetails, TaskToolItemDetail } from "./types"
import { resolveSpawnItems, validateBatchShape, validateTaskTarget } from "./validation"

describe("validateTaskTarget", () => {
  test("#given only category #when validated #then resolves to a category selection", () => {
    // given
    const params = { prompt: "do it", category: "quick" }

    // when
    const result = validateTaskTarget(params)

    // then
    expect(result).toEqual({ kind: "category", category: "quick" })
  })

  test("#given only subagent_type #when validated #then resolves to a subagent selection", () => {
    // given
    const params = { prompt: "do it", subagent_type: "oracle" }

    // when
    const result = validateTaskTarget(params)

    // then
    expect(result).toEqual({ kind: "subagent_type", subagentType: "oracle" })
  })

  test("#given both category and subagent_type #when validated #then returns a typed both_targets error", () => {
    // given
    const params = { prompt: "do it", category: "quick", subagent_type: "oracle" }

    // when
    const result = validateTaskTarget(params)

    // then
    expect(result.kind).toBe("error")
    if (result.kind !== "error") throw new Error("expected error")
    expect(result.error.code).toBe("both_targets")
    expect(result.error.message).toContain("EITHER category OR subagent_type")
    expect(result.error.message).toContain("not both")
    // the call hard-fails and spawns nothing, so the message must not claim subagent_type "is ignored"
    expect(result.error.message).not.toContain("ignored")
    expect(result.error.message).toContain("Remove one and retry")
  })

  test("#given neither category nor subagent_type #when validated #then returns a typed no_target error", () => {
    // given
    const params = { prompt: "do it" }

    // when
    const result = validateTaskTarget(params)

    // then
    expect(result.kind).toBe("error")
    if (result.kind !== "error") throw new Error("expected error")
    expect(result.error.code).toBe("no_target")
    expect(result.error.message).toContain("MUST provide EITHER category OR subagent_type")
  })

  test("#given empty-string category #when validated #then treated as absent (no_target)", () => {
    // given
    const params = { prompt: "do it", category: "  " }

    // when
    const result = validateTaskTarget(params)

    // then
    expect(result.kind).toBe("error")
    if (result.kind !== "error") throw new Error("expected error")
    expect(result.error.code).toBe("no_target")
  })
})

describe("validateBatchShape", () => {
  test("#given prompt without tasks w2val #when shape-validated #then resolves to single", () => {
    // given
    const params = { prompt: "do it", category: "quick" }

    // when
    const result = validateBatchShape(params)

    // then
    expect(result).toEqual({ kind: "single" })
  })

  test("#given tasks without prompt w2val #when shape-validated #then resolves to batch", () => {
    // given
    const params = { tasks: [{ prompt: "a", category: "quick" }] }

    // when
    const result = validateBatchShape(params)

    // then
    expect(result).toEqual({ kind: "batch" })
  })

  test("#given both prompt and tasks w2val #when shape-validated #then names both fields in a typed error", () => {
    // given
    const params = { prompt: "do it", tasks: [{ prompt: "a", category: "quick" }] }

    // when
    const result = validateBatchShape(params)

    // then
    expect(result.kind).toBe("error")
    if (result.kind !== "error") throw new Error("expected error")
    expect(result.error.code).toBe("prompt_and_tasks")
    expect(result.error.message).toContain("prompt")
    expect(result.error.message).toContain("tasks")
  })

  test("#given neither prompt nor tasks w2val #when shape-validated #then returns a no_prompt_or_tasks error", () => {
    // given
    const params = { category: "quick" }

    // when
    const result = validateBatchShape(params)

    // then
    expect(result.kind).toBe("error")
    if (result.kind !== "error") throw new Error("expected error")
    expect(result.error.code).toBe("no_prompt_or_tasks")
  })

  test("#given an empty tasks array w2val #when shape-validated #then returns an empty_tasks error", () => {
    // given
    const params = { tasks: [] }

    // when
    const result = validateBatchShape(params)

    // then
    expect(result.kind).toBe("error")
    if (result.kind !== "error") throw new Error("expected error")
    expect(result.error.code).toBe("empty_tasks")
  })
})

describe("resolveSpawnItems", () => {
  test("#given legacy single-prompt params w2val #when resolved #then yields exactly one ResolvedSpawnItem (regression)", () => {
    // given
    const params = {
      prompt: "do it",
      category: "quick",
      model: "anthropic/claude-opus-4",
      load_skills: ["a"],
    }

    // when
    const result = resolveSpawnItems(params)

    // then
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") throw new Error("expected ok")
    expect(result.items).toHaveLength(1)
    const item = result.items[0]
    if (item === undefined) throw new Error("expected item")
    expect(item.kind).toBe("category")
    if (item.kind !== "category") throw new Error("expected category")
    expect(item.category).toBe("quick")
    expect(item.prompt).toBe("do it")
    expect(item.model).toBe("anthropic/claude-opus-4")
    expect(item.load_skills).toEqual(["a"])
  })

  test("#given a 3-item batch w2val #when resolved #then inherits top-level model/category and item overrides win", () => {
    // given
    const params = {
      category: "quick",
      model: "anthropic/claude-opus-4",
      load_skills: ["shared"],
      tasks: [
        { prompt: "one" },
        { prompt: "two", model: "anthropic/claude-haiku" },
        { prompt: "three", load_skills: ["extra"] },
      ],
    }

    // when
    const result = resolveSpawnItems(params)

    // then
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") throw new Error("expected ok")
    expect(result.items).toHaveLength(3)
    const [first, second, third] = result.items
    if (first === undefined || second === undefined || third === undefined) throw new Error("expected 3 items")
    expect(first.kind).toBe("category")
    expect(second.kind).toBe("category")
    expect(third.kind).toBe("category")
    if (first.kind !== "category" || second.kind !== "category" || third.kind !== "category") {
      throw new Error("expected category")
    }
    expect(first.category).toBe("quick")
    expect(second.category).toBe("quick")
    expect(third.category).toBe("quick")
    expect(first.model).toBe("anthropic/claude-opus-4")
    expect(second.model).toBe("anthropic/claude-haiku")
    expect(third.model).toBe("anthropic/claude-opus-4")
    expect(first.load_skills).toEqual(["shared"])
    expect(second.load_skills).toEqual(["shared"])
    expect(third.load_skills).toEqual(["extra"])
  })

  test("#given an item subagent_type w2val #when resolved #then it suppresses the inherited top-level category", () => {
    // given
    const params = {
      category: "quick",
      tasks: [{ prompt: "one" }, { prompt: "two", subagent_type: "oracle" }],
    }

    // when
    const result = resolveSpawnItems(params)

    // then
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") throw new Error("expected ok")
    const [inherited, suppressed] = result.items
    if (inherited === undefined || suppressed === undefined) throw new Error("expected 2 items")
    expect(inherited.kind).toBe("category")
    if (inherited.kind !== "category") throw new Error("expected category")
    expect(inherited.category).toBe("quick")
    expect(suppressed.kind).toBe("subagent_type")
    if (suppressed.kind !== "subagent_type") throw new Error("expected subagent_type")
    expect(suppressed.subagentType).toBe("oracle")
    expect("category" in suppressed).toBe(false)
  })

  test("#given both prompt and tasks w2val #when resolved #then returns a typed error naming both fields", () => {
    // given
    const params = { prompt: "do it", tasks: [{ prompt: "a", category: "quick" }] }

    // when
    const result = resolveSpawnItems(params)

    // then
    expect(result.kind).toBe("error")
    if (result.kind !== "error") throw new Error("expected error")
    expect(result.error.message).toContain("prompt")
    expect(result.error.message).toContain("tasks")
  })

  test("#given neither prompt nor tasks w2val #when resolved #then returns a typed error", () => {
    // given
    const params = { category: "quick" }

    // when
    const result = resolveSpawnItems(params)

    // then
    expect(result.kind).toBe("error")
    if (result.kind !== "error") throw new Error("expected error")
    expect(result.error.code).toBe("no_prompt_or_tasks")
  })

  test("#given an empty tasks array w2val #when resolved #then returns a typed error", () => {
    // given
    const params = { tasks: [] }

    // when
    const result = resolveSpawnItems(params)

    // then
    expect(result.kind).toBe("error")
    if (result.kind !== "error") throw new Error("expected error")
    expect(result.error.code).toBe("empty_tasks")
  })

  test("#given an item with both category and subagent_type w2val #when resolved #then returns an item_target error naming the index", () => {
    // given
    const params = {
      category: "quick",
      tasks: [{ prompt: "ok" }, { prompt: "bad", category: "deep", subagent_type: "oracle" }],
    }

    // when
    const result = resolveSpawnItems(params)

    // then
    expect(result.kind).toBe("error")
    if (result.kind !== "error") throw new Error("expected error")
    if (result.error.code !== "item_target") throw new Error("expected item_target error")
    expect(result.error.index).toBe(1)
    expect(result.error.message).toContain("1")
  })
})

describe("batch spawn types", () => {
  test("#given the new batch types w2val #when imported #then ResolvedSpawnItem and TaskToolItemDetail are exported with the documented shape", () => {
    // @allow construct values of the exported union types to prove both the export and shape
    const item: ResolvedSpawnItem = { prompt: "p", load_skills: [], kind: "category", category: "quick" }
    const subagentItem: ResolvedSpawnItem = {
      prompt: "p",
      load_skills: [],
      kind: "subagent_type",
      subagentType: "oracle",
    }
    const detail: TaskToolItemDetail = { task_id: "t1", status: "completed" }

    expect(item.kind).toBe("category")
    expect(subagentItem.kind).toBe("subagent_type")
    expect(detail.status).toBe("completed")
  })

  test("#given TaskToolDetails w2val #when constructed with items #then the additive items field is accepted", () => {
    // given
    const withItems: TaskToolDetails = {
      task_id: "t1",
      status: "completed",
      mode: "spawn",
      items: [{ task_id: "c1", status: "completed" }],
    }

    // then
    expect(withItems.items).toHaveLength(1)
    expect(withItems.items?.[0]?.task_id).toBe("c1")
  })
})
