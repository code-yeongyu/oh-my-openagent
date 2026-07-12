import type { OmoConfig } from "@oh-my-opencode/omo-config-core"
import {
  DEFAULT_CATEGORIES,
  SenpiTeamSpecError,
  loadTeamRegistry,
  normalizeSenpiTeamSpec,
  readMemberTaskMap,
  resolveTeamRuntimeDirs,
  validateSenpiTeamMembers,
  type SenpiTeamMemberPorts,
  type ShutdownMessenger,
  type StateDirConfig,
  type TaskManager,
  type TeamSpecSource,
} from "@oh-my-opencode/senpi-task"
import type { TeamSpec } from "@oh-my-opencode/team-core/types"

export type ResolvedTeamSpec = { readonly spec: TeamSpec; readonly source: TeamSpecSource }

// The senpi vocabulary the team spec validator checks against: a category is any built-in default or
// omo.json-declared category name; a subagent_type is any loaded agent definition. Membership-only
// (the concrete model resolution happens later, at spawn, through the planner + live model registry).
export function buildMemberPorts(omoConfig: OmoConfig, agentNames: ReadonlySet<string>): SenpiTeamMemberPorts {
  const categoryNames = new Set<string>([...Object.keys(DEFAULT_CATEGORIES), ...Object.keys(omoConfig.categories ?? {})])
  return {
    isCategoryResolvable: (category) => categoryNames.has(category),
    isKnownAgent: (subagentType) => agentNames.has(subagentType),
  }
}

function inlineTeamName(inlineSpec: unknown): string {
  if (typeof inlineSpec === "object" && inlineSpec !== null) {
    const name = (inlineSpec as { name?: unknown }).name
    if (typeof name === "string" && name.length > 0) return name
  }
  return "inline-team"
}

/**
 * Resolves the create request into a parsed, member-validated team spec. An inline spec is normalized
 * and validated directly (recorded as the omo-json / inline source); a named spec is loaded from the
 * project `.omo/teams` + omo.json registry, where an unknown or failed name throws the recorded spec
 * error so the tool surfaces spec_error rather than a runtime failure.
 */
export async function resolveTeamSpec(
  input: { readonly teamName?: string; readonly inlineSpec?: unknown },
  ports: SenpiTeamMemberPorts,
  projectRoot: string,
  omoTeams: Record<string, unknown> | undefined,
): Promise<ResolvedTeamSpec> {
  if (input.inlineSpec !== undefined) {
    const name = inlineTeamName(input.inlineSpec)
    const spec = normalizeSenpiTeamSpec(input.inlineSpec, name)
    validateSenpiTeamMembers(spec, ports)
    return { spec, source: "omo-json" }
  }

  const teamName = input.teamName
  if (teamName === undefined) throw new SenpiTeamSpecError("no team_name or inline_spec provided", "INVALID_SPEC", "unknown")

  const registry = await loadTeamRegistry({ projectRoot, ports, ...(omoTeams !== undefined ? { omoTeams } : {}) })
  const entry = registry.teams.find((candidate) => candidate.name === teamName)
  if (entry !== undefined) return { spec: entry.spec, source: entry.source }

  const failure = registry.errors.find((error) => error.name === teamName)
  const message = failure !== undefined ? failure.message : `team '${teamName}' not found in project .omo/teams or omo.json`
  throw new SenpiTeamSpecError(message, "INVALID_SPEC", teamName)
}

async function memberTaskId(stateDir: StateDirConfig, teamRunId: string, memberName: string): Promise<string | undefined> {
  const runtimeDir = resolveTeamRuntimeDirs(stateDir, teamRunId).runtimeDir
  const map = await readMemberTaskMap(runtimeDir)
  return map[memberName]
}

// Delivers a shutdown-protocol notice to the target member's background child as a follow-up, resolving
// the member->task mapping from the run sidecar. A member with no live task is a silent no-op.
export function makeShutdownMessenger(manager: TaskManager, stateDir: StateDirConfig, teamRunId: string): ShutdownMessenger {
  return async (message) => {
    const taskId = await memberTaskId(stateDir, teamRunId, message.to)
    if (taskId === undefined) return
    await manager.sendToTask({ idOrName: taskId, message: `[team ${message.kind}] ${message.body}`, deliverAs: "followUp" })
  }
}

// Cancels a member's background child (approve-shutdown teardown), resolving its task via the sidecar.
export function makeCancelMemberTask(manager: TaskManager, stateDir: StateDirConfig, teamRunId: string): (memberName: string) => Promise<void> {
  return async (memberName) => {
    const taskId = await memberTaskId(stateDir, teamRunId, memberName)
    if (taskId === undefined) return
    await manager.cancelTask(taskId, `team ${teamRunId} shutdown approved`)
  }
}
