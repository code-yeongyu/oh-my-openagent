import type { Recorder } from "./recorder"

// The engine's model catalog as slice C1b's diagnostics.models reads it (diagnostics-contract EngineModelsPort): one
// engine.models.list call, answered with the scenario's stated models, else none.
export function engineModelsPort(recorder: Recorder) {
  return {
    modelsList: async () => {
      const { result } = recorder.record("engine", "models.list")
      return Array.isArray(result) ? (result as readonly { readonly provider: string; readonly id: string }[]) : []
    },
  }
}
