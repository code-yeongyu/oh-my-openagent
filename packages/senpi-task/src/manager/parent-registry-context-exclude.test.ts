import { describe, expect, test } from "bun:test"

import { ModelRegistry, ModelRuntime } from "@code-yeongyu/senpi"

import { RunnerError } from "../runners/in-process/runner-error"
import { createRpcModelAdmission } from "../runners/rpc/model-admission"
import { withoutExcludedFallbacks } from "./exclude-fallbacks"
import type { ChildSpec } from "../runners/in-process"
import { createParentRegistrySessionContext, resolveResumeContext } from "./parent-registry-context"
import { createInProcessManagedRunner } from "./runner"
import type { ManagedStartSpec } from "./types"

function spec(overrides: Partial<ManagedStartSpec> = {}): ManagedStartSpec {
  return {
    taskId: "st_child",
    cwd: "/tmp/project",
    stateDir: "/tmp/project/.omo/task",
    prompt: "work",
    depth: 1,
    parentSessionId: "parent",
    rootSessionId: "parent",
    ...overrides,
  }
}

function registry(): ModelRegistry {
  const live = new ModelRegistry(ModelRuntime.createSync())
  live.registerProvider("omo-mock", {
    name: "omo mock",
    baseUrl: "file://mock-provider",
    apiKey: "mock",
    api: "openai-completions",
    models: [{ id: "fable-1", name: "Fable", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 16_000, maxTokens: 4096 }],
  })
  return live
}

const EXCLUDE = ["fable-*"]

describe("task children honor exclude_models on respawn and resume", () => {
  test("#given an in-process child respawned on an excluded model #when its context is built #then it fails model_unavailable", () => {
    // given
    const provide = createParentRegistrySessionContext(registry, () => undefined, () => EXCLUDE)

    // when / then
    expect(() => provide(spec({ model: "omo-mock/fable-1" }))).toThrow(RunnerError)
    expect(() => createParentRegistrySessionContext(registry)(spec({ model: "omo-mock/fable-1" }))).not.toThrow()
  })

  test("#given a resumed child whose persisted model is excluded #when resumed #then it is refused", () => {
    // given
    const resumed = spec({ resolvedModel: { source: "category", provider: "omo-mock", model_id: "fable-1", display: "omo-mock/fable-1" } })

    // when
    const refused = resolveResumeContext(registry, resumed, EXCLUDE)
    const allowed = resolveResumeContext(registry, resumed)

    // then
    expect(refused.ok).toBe(false)
    expect(allowed.ok).toBe(true)
  })

  test("#given a resumed child whose persisted chain lists an excluded model #when resumed or respawned #then that model never reaches the child", async () => {
    // given
    const seen: ChildSpec[] = []
    const stopped = new Error("stop before the session opens")
    const capture = (child: ChildSpec) => {
      seen.push(child)
      return Promise.reject(stopped)
    }
    const runner = withoutExcludedFallbacks(createInProcessManagedRunner({ start: capture, resume: capture }), EXCLUDE)
    const persisted = spec({
      model: "omo-mock/opus-1",
      fallbackModels: [
        { source: "category", provider: "omo-mock", model_id: "fable-1", display: "omo-mock/fable-1" },
        { source: "category", provider: "omo-mock", model_id: "glm-1", display: "omo-mock/glm-1" },
      ],
    })

    // when
    await expect(runner.resume?.(persisted, "/tmp/project/session.jsonl")).rejects.toBe(stopped)
    await expect(runner.start(persisted)).rejects.toBe(stopped)

    // then
    expect(seen.map((child) => child.fallbackModels?.map((model) => model.model_id))).toEqual([["glm-1"], ["glm-1"]])
  })

  test("#given a process child on an excluded model #when admitted #then admission refuses it before any probe", async () => {
    // given
    let probes = 0
    const admission = createRpcModelAdmission({
      excludeModels: EXCLUDE,
      buildSpawn: () => ({ command: "true", args: [], cwd: "/tmp", env: {} }),
      probe: async () => {
        probes += 1
        return { code: 0, stdout: "", stderr: "", timedOut: false }
      },
    })

    // when / then
    await expect(admission({ model: "omo-mock/fable-1", cwd: "/tmp" } as Parameters<typeof admission>[0])).rejects.toBeInstanceOf(RunnerError)
    expect(probes).toBe(0)
  })
})
