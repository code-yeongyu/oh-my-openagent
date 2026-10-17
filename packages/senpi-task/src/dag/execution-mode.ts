import { CURATED_READONLY_AGENT_NAMES } from "../agents/builtin"
import type { AgentDefinition } from "../agents/types"
import { resolveExecutionMode, type ConfiguredExecutionMode, type ExecutionMode } from "../manager/execution-mode"
import type { DagRoute } from "./types"

export type DagExecutionModeSources = {
  readonly route: DagRoute
  readonly agents: Readonly<Record<string, AgentDefinition>>
  // The narrow slice of the loaded omo.json the resolver reads. The full parsed OmoConfig
  // satisfies this structurally; callers may pass partial fixtures in tests.
  readonly config: { readonly task?: { readonly default_execution_mode?: ConfiguredExecutionMode } }
  // Live read of the parent session's `auto` resolution (the manager's gate), undefined until it
  // settles. A thunk, so one scheduler context keeps seeing the current answer.
  readonly autoMode?: () => ExecutionMode | undefined
}

// DAG node dispatch resolves execution mode through the existing chain verbatim:
// spec.execution_mode ?? agentDef.executionMode ?? omo.json task.default_execution_mode
// ?? "in-process". There is NO dag.default_execution_mode knob; the strict task schema
// rejects unknown keys inside task.dag. Curated read-only agents are forced in-process,
// mirroring the harness-side merge in omo-senpi's resolveTaskAgents.
//
// Returns undefined for an `auto` config the parent session has not resolved yet: the node's spec
// then names no mode and the manager decides at spawn, awaiting that one resolution.
export function resolveDagNodeExecutionMode(sources: DagExecutionModeSources): ExecutionMode | undefined {
  const agentName = sources.route.kind === "agent" ? sources.route.agent : undefined
  const definition = agentName === undefined ? undefined : sources.agents[agentName]
  const agentMode = agentName !== undefined && CURATED_READONLY_AGENT_NAMES.has(agentName)
    ? "in-process" as const
    : toExecutionMode(definition?.executionMode)
  const configMode = sources.config.task?.default_execution_mode
  const autoMode = sources.autoMode?.()
  if (configMode === "auto" && agentMode === undefined && autoMode === undefined) return undefined
  return resolveExecutionMode({
    ...(agentMode === undefined ? {} : { agentMode }),
    configMode,
    ...(autoMode === undefined ? {} : { autoMode }),
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
