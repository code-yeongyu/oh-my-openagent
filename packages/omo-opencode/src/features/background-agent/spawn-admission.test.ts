import { describe, expect, mock, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"

import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { BackgroundManager } from "./manager"
import { decideOpenCodeSpawnAdmission } from "./subagent-spawn-limits"

function clientFor(parents: Readonly<Record<string, string | undefined>>): PluginInput["client"] {
  return unsafeTestValue<PluginInput["client"]>({
    session: {
      get: async ({ path }: { readonly path: { readonly id: string } }) => {
        if (!(path.id in parents)) return { error: "missing" }
        return { data: { parentID: parents[path.id] } }
      },
    },
  })
}

describe("OpenCode spawn admission", () => {
  const aliasedAgents = {
    sisyphus: { displayName: "Release Coordinator" },
    atlas: { displayName: "执行总监" },
    prometheus: { displayName: "计划总监" },
  }

  test("#given coordinator root #when spawning direct child #then allows", async () => {
    const result = await decideOpenCodeSpawnAdmission({
      client: clientFor({ root: undefined }),
      request: { parentSessionID: "root", parentAgent: "sisyphus", targetAgent: "explore" },
    })

    expect(result.decision).toMatchObject({ allowed: true, childDepth: 1 })
  })

  test("#given reviewer root #when spawning direct child #then denies", async () => {
    const result = await decideOpenCodeSpawnAdmission({
      client: clientFor({ root: undefined }),
      request: { parentSessionID: "root", parentAgent: "momus", targetAgent: "explore" },
    })

    expect(result.decision).toMatchObject({ allowed: false, reason: "caller_not_allowed" })
  })

  test.each([
    ["Release Coordinator", "explore"],
    ["执行总监", "explore"],
    ["计划总监", "librarian"],
  ])("#given configured display alias %s #when spawning allowed target #then canonical role allows it", async (parentAgent, targetAgent) => {
    const result = await decideOpenCodeSpawnAdmission({
      client: clientFor({ root: undefined }),
      agentOverrides: aliasedAgents,
      request: { parentSessionID: "root", parentAgent, targetAgent },
    })

    expect(result.decision).toMatchObject({ allowed: true, childDepth: 1 })
  })

  test("#given unknown display alias #when spawning #then leaf role denies", async () => {
    const result = await decideOpenCodeSpawnAdmission({
      client: clientFor({ root: undefined }),
      agentOverrides: aliasedAgents,
      request: { parentSessionID: "root", parentAgent: "Unmapped Alias", targetAgent: "explore" },
    })

    expect(result.decision).toMatchObject({ allowed: false, reason: "caller_not_allowed" })
  })

  test("#given unknown parent #when spawning #then denies before route selection", async () => {
    const result = await decideOpenCodeSpawnAdmission({
      client: clientFor({}),
      request: { parentSessionID: "missing", parentAgent: "sisyphus", targetAgent: "explore" },
    })

    expect(result.decision).toMatchObject({ allowed: false, reason: "unknown_lineage" })
  })

  test("#given reviewer caller #when manager launches #then denies before task creation", async () => {
    const manager = new BackgroundManager(unsafeTestValue<ConstructorParameters<typeof BackgroundManager>[0]>({
      pluginContext: { client: clientFor({ root: undefined }), directory: "/project" },
    }))

    await expect(manager.launch({
      description: "probe",
      prompt: "probe",
      agent: "explore",
      parentSessionId: "root",
      parentMessageId: "message",
      parentAgent: "momus",
    })).rejects.toMatchObject({ decision: { reason: "caller_not_allowed" } })
  })

  test("#given missing trusted caller identity #when manager launches #then denies before lineage lookup", async () => {
    const manager = new BackgroundManager(unsafeTestValue<ConstructorParameters<typeof BackgroundManager>[0]>({
      pluginContext: { client: clientFor({ root: undefined }), directory: "/project" },
    }))

    await expect(manager.launch({
      description: "probe",
      prompt: "probe",
      agent: "explore",
      parentSessionId: "root",
      parentMessageId: "message",
    })).rejects.toMatchObject({ name: "MissingSpawnCallerIdentityError" })
  })

  test("#given a planning coordinator allowed to spawn explore #when explore exists and general is denied #then launch succeeds", async () => {
    // given
    const create = mock(async () => ({ data: { id: "child" } }))
    let resolvePrompt: () => void = () => {}
    const promptReached = new Promise<void>((resolve) => {
      resolvePrompt = resolve
    })
    const manager = new BackgroundManager(unsafeTestValue<ConstructorParameters<typeof BackgroundManager>[0]>({
      pluginContext: {
        client: {
          session: {
            get: async () => ({ data: {} }),
            create,
            promptAsync: async () => {
              resolvePrompt()
              return {}
            },
            abort: async () => ({}),
          },
        },
        directory: process.cwd(),
      },
      agentOverrides: { prometheus: { allowedSubagents: ["explore"] } },
    }))

    // when
    try {
      const task = await manager.launch({
        description: "probe",
        prompt: "probe",
        agent: "explore",
        parentSessionId: "root",
        parentMessageId: "message",
        parentAgent: "prometheus",
      })
      await promptReached

      // then
      expect(task.agent).toBe("explore")
      expect(create).toHaveBeenCalledTimes(1)
    } finally {
      manager.shutdown()
    }
  })
})
