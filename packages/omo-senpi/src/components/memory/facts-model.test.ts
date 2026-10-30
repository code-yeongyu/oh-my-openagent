import { expect, test } from "bun:test"
import { OmoConfigSchema } from "@oh-my-opencode/omo-config-core"
import type { SenpiModelPort, SenpiModelRegistryPort } from "@oh-my-opencode/senpi-task"
import { resolveFactsModel } from "./facts-model"

const FALLBACK: SenpiModelPort = { provider: "openai", id: "fallback" }
const registry: SenpiModelRegistryPort<SenpiModelPort> = {
  getAvailable: () => [FALLBACK],
  find: (provider, model) => provider === FALLBACK.provider && model === FALLBACK.id ? FALLBACK : undefined,
}

test("#given an object-form explicit quick fallback #when the primary is unavailable #then facts use the declared fallback", () => {
  const config = OmoConfigSchema.parse({
    categories: {
      quick: {
        model: "openai/unavailable",
        fallback_models: [{ model: "openai/fallback", reasoning: "low" }],
      },
    },
  })

  const resolved = resolveFactsModel(config, registry, undefined, "facts-model-test")

  expect(resolved).toMatchObject({
    kind: "resolved",
    model: "openai/fallback",
  })
})
