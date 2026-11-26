import { afterEach, expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"

import { baseSpec, cleanupProjects, makeManager, settings } from "./__fixtures__/manager-fakes"
import type { NicknameWildcardConflict } from "./types"

afterEach(cleanupProjects)

const wildcardRules = {
  "mock/*": "general",
  "mock/gpt-*-luna*": "luna",
  "mock/gpt-6*-luna-*fast": "fast",
}
const wildcardRulesReversed = {
  "mock/gpt-6*-luna-*fast": "fast",
  "mock/gpt-*-luna*": "luna",
  "mock/*": "general",
}

test.each([
  { name: "narrow rule last", rules: wildcardRules, model: "gpt-6-luna-fast", expected: "Quick" },
  { name: "narrow rule first", rules: wildcardRulesReversed, model: "gpt-6-luna-fast", expected: "Quick" },
  { name: "middle rule", rules: wildcardRulesReversed, model: "gpt-7-luna", expected: "Selene" },
  { name: "provider fallback", rules: wildcardRulesReversed, model: "gpt-7-sol", expected: "Ceres" },
  {
    name: "exact override",
    rules: { ...wildcardRules, "mock/gpt-6-luna-fast": "exact" },
    model: "gpt-6-luna-fast",
    expected: "Io",
  },
  {
    name: "case-insensitive model-only glob with a literal dot and an empty star",
    rules: { " GPT-6.1-*LUNA* ": "luna", "mock/*": "general" },
    model: "gpt-6.1-luna",
    expected: "Selene",
  },
  {
    name: "literal dot does not match another character",
    rules: { "gpt-6.1-luna*": "luna", "mock/*": "general" },
    model: "gpt-6x1-luna",
    expected: "Ceres",
  },
  {
    name: "equivalent patterns",
    rules: { "mock/gpt-**": "general", "mock/gpt-*": "luna" },
    model: "gpt-6-luna",
    expected: "Io",
  },
  {
    name: "incomparable patterns",
    rules: { "mock/gpt-6*": "fast", "mock/*-luna": "luna" },
    model: "gpt-6-luna",
    expected: "Io",
  },
  { name: "category fallback", rules: { "other/*": "fast" }, model: "gpt-6-luna", expected: "Io" },
])("persists the selected nickname with $name", async ({ rules, model, expected }) => {
  const { manager, store } = makeManager({
    config: settings({
      nicknames: {
        sets: { general: ["Ceres"], luna: ["Selene"], fast: ["Quick"], exact: ["Io"] },
        models: rules,
        categories: { example: "exact" },
      },
    }),
    planner: () => ({
      kind: "resolved",
      plan: {
        model: `mock/${model}`,
        resolved_model: { provider: "mock", model_id: model, display: `mock/${model}`, source: "category" },
      },
    }),
  })

  const task = await manager.start(baseSpec({ category: "example" }))

  if (task.kind !== "started") throw new Error(`expected started task, got ${task.kind}`)
  expect(task.nickname).toBe(expected)
  expect(store.load(task.task_id)?.nickname).toBe(expected)
})

test("warns once per model when an unresolved wildcard tie needs the alphabetical rule", async () => {
  const conflicts: NicknameWildcardConflict[] = []
  const { manager } = makeManager({
    config: settings({
      nicknames: {
        sets: { broad: ["Ceres"], narrow: ["Selene"], general: ["Io"] },
        models: { "mock/gpt-*": "broad", "mock/*luna": "narrow" },
        default: "general",
      },
    }),
    onNicknameConflict: (conflict) => conflicts.push(conflict),
    planner: (spec) => ({
      kind: "resolved",
      plan: {
        model: `mock/${spec.prompt}`,
        resolved_model: {
          provider: "mock",
          model_id: spec.prompt,
          display: `mock/${spec.prompt}`,
          source: "category",
        },
      },
    }),
  })

  const first = await manager.start(baseSpec({ prompt: "gpt-luna" }))
  const repeated = await manager.start(baseSpec({ prompt: "gpt-luna" }))
  const different = await manager.start(baseSpec({ prompt: "gpt-alt-luna" }))
  const unmatched = await manager.start(baseSpec({ prompt: "other" }))

  expect(first).toMatchObject({ kind: "started", nickname: "Selene" })
  expect(repeated).toMatchObject({ kind: "started", nickname: "Selene II" })
  expect(different).toMatchObject({ kind: "started", nickname: "Selene III" })
  expect(unmatched).toMatchObject({ kind: "started", nickname: "Io" })
  expect(conflicts.map(({ modelId, chosenSet }) => [modelId, chosenSet])).toEqual([
    ["mock/gpt-luna", "narrow"],
    ["mock/gpt-alt-luna", "narrow"],
  ])
})

test("a shared pool continues across conversations and manager recreation while counts stay conversation-local", async () => {
  const make = (project?: string, style?: "full") => makeManager({
    ...(project === undefined ? {} : { project }),
    config: settings({
      nicknames: {
        sets: { moon: ["Selene", "Io", "Callisto"], sun: ["Helios", "Flare", "Corona"] },
        models: { "mock/luna": "moon", "mock/sol": "sun" },
        categories: { sharing: "moon" },
        ...(style === undefined ? {} : { occurrence_style: style }),
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
  const { manager, store, project } = make()
  const spawn = async (category: string, parentSessionId = "parent-1") => {
    const task = await manager.start(baseSpec({ category, parent_session_id: parentSessionId }))
    if (task.kind !== "started") throw new Error(`expected started task, got ${task.kind}`)
    const record = store.load(task.task_id)
    return [task.nickname, record?.nickname, record?.task_seq]
  }

  expect(await spawn("lunar")).toEqual(["Callisto", "Callisto", 0])
  expect(await spawn("solar")).toEqual(["Flare", "Flare", 1])
  expect(await spawn("unmapped")).toEqual([undefined, undefined, 2])
  expect(await spawn("sharing")).toEqual(["Selene", "Selene", 3])
  expect(await spawn("solar")).toEqual(["Corona", "Corona", 4])
  expect(await spawn("lunar", "parent-2")).toEqual(["Io", "Io", 0])
  expect(await spawn("lunar")).toEqual(["Callisto II", "Callisto II", 5])
  expect(await spawn("sharing")).toEqual(["Selene II", "Selene II", 6])

  const restarted = await make(project, "full").manager.start(
    baseSpec({ category: "lunar", parent_session_id: "nested-parent", root_session_id: "parent-2" }),
  )
  if (restarted.kind !== "started") throw new Error(`expected started task, got ${restarted.kind}`)
  expect(restarted.nickname).toBe("Io the Second")
})

test("invalid nickname state leaves task start and record creation available", async () => {
  const { manager, store, project } = makeManager({
    config: settings({ nicknames: { sets: { moon: ["Phobos"] }, default: "moon" } }),
  })
  writeFileSync(join(project, "task-nicknames.json"), '{"version":2}')

  const task = await manager.start(baseSpec())

  if (task.kind !== "started") throw new Error(`expected started task, got ${task.kind}`)
  expect(task.nickname).toBeUndefined()
  const record = store.load(task.task_id)
  expect(record?.task_id).toBe(task.task_id)
  expect(record?.nickname).toBeUndefined()
})
