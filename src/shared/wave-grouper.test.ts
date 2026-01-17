import { describe, test, expect } from "bun:test"
import { groupTasksIntoWaves } from "./wave-grouper"

describe("groupTasksIntoWaves", () => {
  test("groups tasks by dependency order", () => {
    // #given
    const tasks = [
      { id: "task-1", dependsOn: [], files: { create: ["a.ts"], modify: [], test: [] } },
      { id: "task-2", dependsOn: ["task-1"], files: { create: [], modify: ["b.ts"], test: [] } },
      { id: "task-3", dependsOn: ["task-1"], files: { create: [], modify: ["c.ts"], test: [] } },
      { id: "task-4", dependsOn: ["task-2", "task-3"], files: { create: [], modify: ["d.ts"], test: [] } },
    ]

    // #when
    const result = groupTasksIntoWaves(tasks)

    // #then
    expect(result.waves).toHaveLength(3)
    expect(result.waves[0].tasks.map((task) => task.id)).toEqual(["task-1"])
    expect(result.waves[1].tasks.map((task) => task.id).sort()).toEqual(["task-2", "task-3"])
    expect(result.waves[2].tasks.map((task) => task.id)).toEqual(["task-4"])
  })

  test("injects dependencies for file conflicts", () => {
    // #given
    const tasks = [
      { id: "task-1", dependsOn: [], files: { create: ["shared.ts"], modify: [], test: [] } },
      { id: "task-2", dependsOn: [], files: { create: [], modify: ["shared.ts"], test: [] } },
    ]

    // #when
    const result = groupTasksIntoWaves(tasks)

    // #then
    expect(result.waves).toHaveLength(2)
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0]).toMatchObject({
      file: "shared.ts",
      blockingTaskId: "task-1",
      blockedTaskId: "task-2",
    })
  })

  test("throws on circular dependencies", () => {
    // #given
    const tasks = [
      { id: "task-1", dependsOn: ["task-2"], files: { create: [], modify: ["a.ts"], test: [] } },
      { id: "task-2", dependsOn: ["task-1"], files: { create: [], modify: ["b.ts"], test: [] } },
    ]

    // #when / #then
    expect(() => groupTasksIntoWaves(tasks)).toThrow(/circular|dependency/i)
  })
})
