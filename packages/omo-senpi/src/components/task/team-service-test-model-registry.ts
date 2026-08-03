import type { ModelRegistry as SenpiModelRegistry } from "@code-yeongyu/senpi"
import { ModelRegistry, ModelRuntime } from "../../senpi-test-runtime"

export function createTeamServiceTestModelRegistry(): SenpiModelRegistry {
  const modelRegistry = new ModelRegistry(ModelRuntime.createSync())
  modelRegistry.registerProvider("omo-mock", {
    api: "openai-completions",
    baseUrl: "https://example.test",
    apiKey: "test-key",
    models: [{
      id: "mock-1",
      name: "Mock model",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 1,
      maxTokens: 1,
    }],
  })
  return modelRegistry
}
