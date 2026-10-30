import type { ModelRegistry as SenpiModelRegistry } from "@code-yeongyu/senpi"
import { ModelRegistry, ModelRuntime } from "../../senpi-test-runtime"

/** A registry with the omo-mock/mock-1 model, plus any extra `provider/id` models a fixture pins. */
export function createTeamServiceTestModelRegistry(extraModels: readonly string[] = []): SenpiModelRegistry {
  const modelRegistry = new ModelRegistry(ModelRuntime.createSync())
  for (const ref of extraModels) {
    const slash = ref.indexOf("/")
    modelRegistry.registerProvider(ref.slice(0, slash), {
      api: "openai-completions",
      baseUrl: "https://example.test",
      apiKey: "test-key",
      models: [{ id: ref.slice(slash + 1), name: ref, reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1, maxTokens: 1 }],
    })
  }
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
