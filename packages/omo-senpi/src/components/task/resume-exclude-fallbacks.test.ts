import { describe, expect, spyOn, test } from "bun:test"

import { OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"
import { RpcProcessRunner } from "@oh-my-opencode/senpi-task"

import { buildRespawnRunner } from "./engine-runners"
import { TaskRuntimeContext } from "./runtime-context"

describe("a revived process child's persisted fallback chain honors exclude_models", () => {
  test("#given a record whose chain lists a model excluded since #when the respawn runner revives it #then that model never reaches the child", async () => {
    // given
    const stopped = new Error("stop before spawning")
    const chains: (readonly string[] | undefined)[] = []
    const start = spyOn(RpcProcessRunner.prototype, "start").mockImplementation((spec) => {
      chains.push(spec.fallbackModels)
      return Promise.reject(stopped)
    })
    try {
      const runner = buildRespawnRunner({
        runtime: new TaskRuntimeContext("/project"),
        sharedParentTools: () => [],
        settings: OmoTaskSettingsSchema.parse({ process_runner: "child-process" }),
        platform: "darwin",
        agentDir: "/agent",
        listInstalledPackageRoots: () => [],
        excludeModels: ["claude-fable-*"],
      })

      // when
      await expect(runner.start({
        task_id: "st_revived",
        cwd: "/project",
        state_dir: "/state",
        prompt: "",
        model: "openai/gpt-5.6-sol",
        fallbackModels: ["anthropic/claude-fable-5-1:high", "openrouter/anthropic/claude-fable-5-1", "zai/glm-5.3"],
        extensions: [],
      })).rejects.toBe(stopped)

      // then
      expect(chains).toEqual([["zai/glm-5.3"]])
    } finally {
      start.mockRestore()
    }
  })
})
