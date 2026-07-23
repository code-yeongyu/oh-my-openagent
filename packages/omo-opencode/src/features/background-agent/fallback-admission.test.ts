import { expect, mock, test } from "bun:test"

import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { BackgroundManager } from "./manager"

test("#given general fallback is denied #when explore is not found after launch #then substitution is rejected", async () => {
  // given
  const promptAsync = mock(async () => {
    throw new Error('Agent not found: "explore"')
  })
  const admittedTargets: string[] = []
  let resolveFallbackAttempt: () => void = () => {}
  const fallbackAttempt = new Promise<void>((resolve) => {
    resolveFallbackAttempt = resolve
  })
  const manager = new BackgroundManager(unsafeTestValue<ConstructorParameters<typeof BackgroundManager>[0]>({
    pluginContext: {
      client: {
        session: {
          get: async () => ({ data: { directory: process.cwd() } }),
          create: async () => ({ data: { id: "child" } }),
          promptAsync,
          abort: async () => ({}),
        },
      },
      directory: process.cwd(),
    },
    agentOverrides: { prometheus: { allowedSubagents: ["explore"] } },
  }))
  const assertCanSpawn = manager.assertCanSpawn.bind(manager)
  manager.assertCanSpawn = async (request) => {
    admittedTargets.push(request.targetAgent)
    if (request.targetAgent === "general") {
      resolveFallbackAttempt()
    }
    return await assertCanSpawn(request)
  }

  try {
    // when
    const task = await manager.launch({
      description: "probe",
      prompt: "probe",
      agent: "explore",
      parentSessionId: "parent",
      parentMessageId: "message",
      parentAgent: "prometheus",
    })
    await fallbackAttempt

    // then
    expect(promptAsync).toHaveBeenCalledTimes(1)
    expect(manager.getTask(task.id)?.agent).toBe("explore")
    expect(admittedTargets).toEqual(["explore", "general"])
  } finally {
    manager.shutdown()
  }
})
