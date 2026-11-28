import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { executeFanOut, partitionItems } from "./fan-out"
import { __resetTimingConfig, __setTimingConfig } from "./timing"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import type { DelegateTaskArgs } from "./types"
import type { ExecutorContext } from "./executor-types"

describe("partitionItems", () => {
  test("#given ten items split two ways #when partitioning #then each child gets a contiguous half", () => {
    expect(partitionItems(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"], 2)).toEqual([
      ["A", "B", "C", "D", "E"],
      ["F", "G", "H", "I", "J"],
    ])
  })

  test("#given an uneven split #when partitioning #then the first slices take the extra items", () => {
    expect(partitionItems([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([
      [1, 2, 3],
      [4, 5],
      [6, 7],
    ])
  })

  test("#given no split #when partitioning #then there is one child per item", () => {
    expect(partitionItems(["a", "b", "c"], undefined)).toEqual([["a"], ["b"], ["c"]])
  })

  test("#given a split larger than the list #when partitioning #then it is capped at one item per child", () => {
    expect(partitionItems(["a", "b"], 5)).toEqual([["a"], ["b"]])
  })
})

describe("executeFanOut", () => {
  beforeEach(() => {
    __setTimingConfig({ WAIT_FOR_SESSION_INTERVAL_MS: 1, WAIT_FOR_SESSION_TIMEOUT_MS: 50 })
  })

  afterEach(() => {
    __resetTimingConfig()
    SessionCategoryRegistry.clear()
  })

  function createManager() {
    const launched: Array<{
      id: string
      sessionId: string
      description: string
      prompt: string
      agent: string
      status: string
      groupId?: string
      parentSessionId: string
      wake?: string
    }> = []
    const groups: Array<{ groupId: string; size: number }> = []
    const settled: Array<{ groupId: string; size: number }> = []
    const manager = {
      launch: async (input: {
        description: string
        prompt: string
        agent: string
        groupId?: string
        parentSessionId: string
        wake?: string
      }) => {
        const task = {
          id: `bg_${launched.length + 1}`,
          sessionId: `ses_child_${launched.length + 1}`,
          status: "running",
          ...input,
        }
        launched.push(task)
        return task
      },
      getTask: (id: string) => launched.find((task) => task.id === id),
      getTasksByParentSession: (parent: string) => launched.filter((task) => task.parentSessionId === parent),
      registerTaskGroup: (groupId: string, input: { size: number }) => groups.push({ groupId, size: input.size }),
      settleTaskGroupSize: (groupId: string, size: number) => settled.push({ groupId, size }),
    }
    return { manager, launched, groups, settled }
  }

  async function run(
    args: Partial<DelegateTaskArgs>,
    manager: ReturnType<typeof createManager>["manager"],
  ): Promise<string> {
    return executeFanOut(
      { description: "audit", prompt: "Audit these files.", run_in_background: true, load_skills: [], ...args },
      unsafeTestValue({
        sessionID: "ses_parent",
        callID: "call_1",
        metadata: async () => {},
        abort: new AbortController().signal,
      }),
      unsafeTestValue<ExecutorContext>({ manager }),
      { sessionID: "ses_parent", messageID: "msg_1" },
      "explore",
      undefined,
      undefined,
    )
  }

  test("#given three children #when the fan-out launches #then its continue line names every child's session", async () => {
    // given
    const { manager } = createManager()

    // when
    const result = await run({ items: ["a", "b", "c"] }, manager)

    // then
    const continueBlock = result.slice(result.indexOf("\nto continue:"))
    expect(result).toContain("\nto continue:")
    for (const session of ["ses_child_1", "ses_child_2", "ses_child_3"]) {
      expect(continueBlock).toContain(`task(task_id="${session}"`)
    }
  })

  test("#given items and split #when the fan-out runs #then one grouped child per slice gets the shared prompt plus its slice", async () => {
    // given
    const { manager, launched, groups, settled } = createManager()

    // when
    const result = await run({ items: ["a.ts", "b.ts", "c.ts", "d.ts"], split: 2 }, manager)

    // then
    expect(launched).toHaveLength(2)
    expect(launched[0]?.prompt).toContain("Audit these files.")
    expect(launched[0]?.prompt).toContain("- a.ts\n- b.ts")
    expect(launched[0]?.prompt).not.toContain("c.ts")
    expect(launched[1]?.prompt).toContain("- c.ts\n- d.ts")
    expect(launched[0]?.description).toBe("audit [1/2]")
    expect(new Set(launched.map((task) => task.groupId)).size).toBe(1)
    expect(groups).toEqual([{ groupId: launched[0]!.groupId!, size: 2 }])
    expect(settled).toEqual([{ groupId: launched[0]!.groupId!, size: 2 }])
    expect(result).toContain("bg_1")
    expect(result).toContain("bg_2")
  })

  test("#given an explicit wake #when the fan-out runs #then the children report on their own, outside any group", async () => {
    // given
    const { manager, launched, groups } = createManager()

    // when
    await run({ items: ["x", "y"], wake: "each" }, manager)

    // then
    expect(launched).toHaveLength(2)
    expect(launched.every((task) => task.groupId === undefined)).toBe(true)
    expect(launched.every((task) => task.wake === "each")).toBe(true)
    expect(groups).toEqual([])
  })
})
