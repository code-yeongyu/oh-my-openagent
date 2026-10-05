import { expect, test } from "bun:test"
import { KibitzerSidecarStartError, kibitzerConfigurationFailure } from "./sidecar-start-error"
import { createLazyKibitzerChildStarter } from "./lazy-child-starter"
import type { KibitzerSidecarChildInput } from "./sidecar-contract"
import type { KibitzerSidecarChildStarterOptions } from "./sidecar-model"

const options: KibitzerSidecarChildStarterOptions = {
  cwd: "/workspace", sessionDir: "/session", agentDir: "/agent",
  loadConfig: () => ({}), modelRegistry: () => undefined,
}
const input: KibitzerSidecarChildInput = {
  sessionId: "parent", generation: 1, prompt: "seed", tools: [], maxItems: 3,
}

test("registration is cold and concurrent wakes share the factory while retaining each input", async () => {
  let loads = 0
  let factories = 0
  const inputs: KibitzerSidecarChildInput[] = []
  const refused = new Error("child refused")
  const start = createLazyKibitzerChildStarter(options, async () => {
    loads += 1
    return { createKibitzerSidecarChildStarter: (actualOptions) => {
      expect(actualOptions).toBe(options)
      factories += 1
      return async (actualInput) => { inputs.push(actualInput); throw refused }
    } }
  })
  expect(loads).toBe(0)
  const second = { ...input, generation: 2 }
  const results = await Promise.allSettled([start(input), start(second)])
  expect(loads).toBe(1)
  expect(factories).toBe(1)
  expect(inputs).toEqual([input, second])
  expect(results).toEqual([{ status: "rejected", reason: refused }, { status: "rejected", reason: refused }])
  await expect(start(input)).rejects.toBe(refused)
  expect(loads).toBe(1)
})

test("failed runtime load is retryable without caching a child startup refusal", async () => {
  let loads = 0
  const unavailable = new Error("runtime unavailable")
  const refused = new Error("child refused")
  const start = createLazyKibitzerChildStarter(options, async () => {
    if (++loads === 1) throw unavailable
    return { createKibitzerSidecarChildStarter: () => async () => { throw refused } }
  })
  await expect(start(input)).rejects.toBe(unavailable)
  await expect(start(input)).rejects.toBe(refused)
  await expect(start(input)).rejects.toBe(refused)
  expect(loads).toBe(2)
})


test("the lazy factory receives the eager error identity for cross-bundle refusal classification", async () => {
  const start = createLazyKibitzerChildStarter(options, async () => ({
    createKibitzerSidecarChildStarter: (_options, StartError) => async () => {
      expect(StartError).toBe(KibitzerSidecarStartError)
      throw new StartError!("category_unavailable", "no category", { category: "quick" })
    },
  }))
  const result = await Promise.allSettled([start(input)])
  const outcome = result[0]
  expect(outcome.status).toBe("rejected")
  if (outcome.status !== "rejected") throw new Error("expected refusal")
  expect(kibitzerConfigurationFailure(outcome.reason)).toEqual({ category: "quick", cause: "category_unavailable" })
})
