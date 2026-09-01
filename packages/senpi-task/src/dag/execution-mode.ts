import { CURATED_READONLY_AGENT_NAMES } from "../agents/builtin"
import type { AgentDefinition } from "../agents/types"
import { resolveExecutionMode, type ExecutionMode } from "../manager/execution-mode"
import type { DagRoute } from "./types"

export type DagExecutionModeSources = {
  readonly route: DagRoute
  readonly agents: Readonly<Record<string, AgentDefinition>>
  // The narrow slice of the loaded omo.json the resolver reads. The full parsed OmoConfig
  // satisfies this structurally; callers may pass partial fixtures in tests.
  readonly config: { readonly task?: { readonly default_execution_mode?: ExecutionMode } }
}

// DAG node dispatch resolves execution mode through the existing chain verbatim:
// spec.execution_mode ?? agentDef.executionMode ?? omo.json task.default_execution_mode
// ?? "in-process". There is NO dag.default_execution_mode knob; the strict task schema
// rejects unknown keys inside task.dag. Curated read-only agents are forced in-process,
// mirroring the harness-side merge in omo-senpi's resolveTaskAgents.
export function resolveDagNodeExecutionMode(sources: DagExecutionModeSources): ExecutionMode {
  const agentName = sources.route.kind === "agent" ? sources.route.agent : undefined
  const definition = agentName === undefined ? undefined : sources.agents[agentName]
  const agentMode = agentName !== undefined && CURATED_READONLY_AGENT_NAMES.has(agentName)
    ? "in-process" as const
    : toExecutionMode(definition?.executionMode)
  return resolveExecutionMode({
    ...(agentMode === undefined ? {} : { agentMode }),
    configMode: sources.config.task?.default_execution_mode,
  })
}

function toExecutionMode(value: string | undefined): ExecutionMode | undefined {
  switch (value) {
    case "in-process":
    case "process":
      return value
    default:
      return undefined
  }
}
