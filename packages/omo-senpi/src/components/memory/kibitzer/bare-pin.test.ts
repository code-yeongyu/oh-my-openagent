import { expect, test } from "bun:test"

import type { ChildModelRegistry } from "@oh-my-opencode/senpi-task"
import { createKibitzerSidecarChildStarter, kibitzerConfigurationFailure, resolveKibitzerSidecarModel } from "./sidecar-model"

const models = [
  { provider: "opencode-go", id: "deepseek-v4-flash" },
  { provider: "deepseek", id: "deepseek-flash" },
]
function registry(available: typeof models) {
  return {
    getAvailable: () => available,
    getAll: () => models,
    find: (provider: string, id: string) => models.find((model) => model.provider === provider && model.id === id),
  }
}
const config = { categories: { quick: { model: "deepseek-v4-flash" } } }

test("served bare recall pin starts inside the category instead of beyond_category", () => {
  expect(resolveKibitzerSidecarModel({ config, registry: registry(models.slice(0, 1)) }))
    .toMatchObject({ kind: "resolved", model: "opencode-go/deepseek-v4-flash" })
})

test("unserved recall pin recovers through the category chain with its diagnostic", () => {
  expect(resolveKibitzerSidecarModel({ config, registry: registry(models.slice(1)) }))
    .toMatchObject({
      kind: "resolved", model: "deepseek/deepseek-flash",
      pinUnserved: { pin: "deepseek-v4-flash", providers: ["opencode-go"] },
    })
})

test("unserved recall pin never becomes a silent beyond_category", () => {
  expect(resolveKibitzerSidecarModel({ config, registry: registry([]) }))
    .toMatchObject({
      kind: "unavailable", cause: "pin_unserved",
      pinUnserved: { pin: "deepseek-v4-flash", providers: ["opencode-go"] },
    })
})

test("starter logs recovery, and the next start honours a newly connected serving provider", async () => {
  let available = models.slice(1)
  const live = { ...registry([]), getAvailable: () => available }
  const warnings: unknown[] = []
  const selected: string[] = []
  const start = createKibitzerSidecarChildStarter({
    cwd: "/fixture", sessionDir: "/fixture/sessions", agentDir: "/fixture/agent",
    loadConfig: () => config,
    modelRegistry: () => live as unknown as ChildModelRegistry,
    loadPersona: () => "fixture",
    createRunner: () => ({ start: async (spec) => {
      selected.push(spec.selectedModel ?? "")
      throw new Error("fixture stop after capturing spec")
    } }),
    logger: { info: () => {}, warn: (_message, details) => warnings.push(details), error: () => {} },
  })
  const input = { sessionId: "parent", generation: 1, prompt: "fixture", tools: [], maxItems: 1 }
  await start(input).catch(() => {})
  expect(selected).toEqual(["deepseek/deepseek-flash"])
  expect(warnings).toMatchObject([{
    pin: "deepseek-v4-flash", providers: ["opencode-go"], selectedModel: "deepseek/deepseek-flash",
  }])
  available = models
  await start({ ...input, generation: 2 }).catch(() => {})
  expect(selected).toEqual(["deepseek/deepseek-flash", "opencode-go/deepseek-v4-flash"])
  expect(warnings).toHaveLength(1)
})

test("starter preserves unserved-pin configuration detail before any child starts", async () => {
  const start = createKibitzerSidecarChildStarter({
    cwd: "/fixture", sessionDir: "/fixture/sessions", agentDir: "/fixture/agent",
    loadConfig: () => config,
    modelRegistry: () => registry([]) as unknown as ChildModelRegistry,
    loadPersona: () => { throw new Error("must not reach persona") },
  })
  const error: unknown = await start({ sessionId: "parent", generation: 1, prompt: "fixture", tools: [], maxItems: 1 }).catch((error: unknown) => error)
  expect(kibitzerConfigurationFailure(error)).toMatchObject({
    cause: "pin_unserved", pinUnserved: { pin: "deepseek-v4-flash", providers: ["opencode-go"], setting: "categories.quick.model" },
  })
})
