import { afterEach, expect, test } from "bun:test"

import { baseSpec, cleanupProjects, makeManager, settings } from "./__fixtures__/manager-fakes"

afterEach(cleanupProjects)

test("nickname pools rotate independently by parent and shared set without changing task ordinals", async () => {
  const { manager, store } = makeManager({
    config: settings({
      nicknames: {
        sets: { moon: ["Selene", "Io", "Callisto"], sun: ["Helios", "Flare"] },
        models: { "mock/luna": "moon", "mock/sol": "sun" },
        categories: { sharing: "moon" },
      },
    }),
    planner: (spec) => {
      const model = spec.category === "lunar" ? "luna" : spec.category === "solar" ? "sol" : "other"
      return {
        kind: "resolved",
        plan: {
          model: `mock/${model}`,
          resolved_model: { provider: "mock", model_id: model, display: `mock/${model}`, source: "category" },
        },
      }
    },
  })
  const spawn = async (category: string, parentSessionId = "parent-1") => {
    const task = await manager.start(baseSpec({ category, parent_session_id: parentSessionId }))
    if (task.kind !== "started") throw new Error(`expected started task, got ${task.kind}`)
    const record = store.load(task.task_id)
    return [task.nickname, record?.nickname, record?.task_seq]
  }

  expect(await spawn("lunar")).toEqual(["Selene", "Selene", 0])
  expect(await spawn("solar")).toEqual(["Helios", "Helios", 1])
  expect(await spawn("unmapped")).toEqual([undefined, undefined, 2])
  expect(await spawn("sharing")).toEqual(["Io", "Io", 3])
  expect(await spawn("solar")).toEqual(["Flare", "Flare", 4])
  expect(await spawn("lunar", "parent-2")).toEqual(["Selene", "Selene", 0])
  expect(await spawn("lunar")).toEqual(["Callisto", "Callisto", 5])
  expect(await spawn("sharing")).toEqual(["Selene", "Selene", 6])
})
