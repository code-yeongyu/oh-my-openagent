export type ExecutionMode = "in-process" | "process"

export type ExecutionModeSources = {
  readonly specMode?: ExecutionMode
  readonly agentMode?: ExecutionMode
  readonly configMode?: ExecutionMode
}

// Precedence: spec.execution_mode ?? agentDef.executionMode ?? omo.json task.default_execution_mode
// ?? "in-process".
export function resolveExecutionMode(sources: ExecutionModeSources): ExecutionMode {
  return sources.specMode ?? sources.agentMode ?? sources.configMode ?? "in-process"
}
