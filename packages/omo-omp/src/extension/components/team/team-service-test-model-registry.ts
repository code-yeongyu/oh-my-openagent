import type { ChildModelRegistry } from "@oh-my-opencode/senpi-task"

// The task engine's planner reads the parent session's model registry through the senpi-task
// ChildModelRegistry port (a declared workspace dep). The concrete senpi ModelRegistry class is not
// part of the omp adapter's dependency surface, so the test registry is a structural fake exposing
// the read surface the planner touches (getAvailable/find). The cast is shape-only and asserted by
// the category-resolution harness ("quick" resolves omo-mock/mock-1 at spawn).
export function createTeamServiceTestModelRegistry(): ChildModelRegistry {
  const model = { provider: "omo-mock", id: "mock-1", name: "Mock model" }
  const registry = {
    getAvailable: () => [model],
    find: (provider: string, modelId: string) =>
      provider === model.provider && modelId === model.id ? model : undefined,
  }
  return registry as unknown as ChildModelRegistry
}
