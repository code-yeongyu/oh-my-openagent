import path from "node:path"
import { z } from "zod"
import { getAgentToolRestrictions, normalizeSDKResponse } from "../../shared"
import type { DelegatedModelConfig } from "../../shared/model-resolution-types"

const REQUIRED_TEAM_TOOLS = [
  "team_send_message", "team_task_list", "team_task_get", "team_task_update", "team_status",
] as const
const FinalOpenCodeAgentSchema = z.object({
  name: z.string(),
  mode: z.string(),
  native: z.boolean(),
  hidden: z.boolean().nullish(),
  permission: z.array(z.object({
    permission: z.string(),
    pattern: z.string(),
    action: z.enum(["allow", "ask", "deny"]),
  })),
  model: z.object({ providerID: z.string(), modelID: z.string() }).nullish(),
  variant: z.string().nullish(),
})
const projectAgentNamesByDirectory = new Map<string, ReadonlySet<string>>()
type FinalOpenCodeAgent = z.infer<typeof FinalOpenCodeAgentSchema>

export type FinalOpenCodeAgentRegistryClient = {
  readonly app: {
    readonly agents: (input: { readonly query: { readonly directory: string } }) => Promise<unknown>
  }
}

export class ProjectAgentResolutionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ProjectAgentResolutionError"
  }
}

export function replaceProjectAgentProvenance(directory: string, names: readonly string[]): void {
  projectAgentNamesByDirectory.set(path.resolve(directory), new Set(
    names.filter((name) => !Object.hasOwn(Object.prototype, name)),
  ))
}

export function hasProjectAgentProvenance(directory: string, name: string): boolean {
  let candidate = path.resolve(directory)
  while (true) {
    const snapshot = projectAgentNamesByDirectory.get(candidate)
    if (snapshot !== undefined) return snapshot.has(name)
    const parent = path.dirname(candidate)
    if (parent === candidate) return false
    candidate = parent
  }
}

export function listProjectAgentProvenance(directory: string): readonly string[] {
  return [...(projectAgentNamesByDirectory.get(path.resolve(directory)) ?? [])]
}

export async function loadFinalOpenCodeAgentRegistry(
  client: FinalOpenCodeAgentRegistryClient,
  directory: string,
): Promise<readonly unknown[]> {
  const response = await client.app.agents({ query: { directory } })
  const normalized = normalizeSDKResponse<unknown>(response, [], { preferResponseOnMissingData: true })
  return Array.isArray(normalized) ? normalized : []
}

function wildcardMatches(value: string, pattern: string): boolean {
  const normalizedValue = value.replaceAll("\\", "/")
  let escapedPattern = pattern.replaceAll("\\", "/")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")
  if (escapedPattern.endsWith(" .*")) {
    escapedPattern = `${escapedPattern.slice(0, -3)}( .*)?`
  }
  return new RegExp(`^${escapedPattern}$`, process.platform === "win32" ? "si" : "s").test(normalizedValue)
}

function hasUnconditionalFinalAction(
  agent: FinalOpenCodeAgent,
  tool: string,
  expectedAction: "allow" | "deny",
): boolean {
  let matches = false
  for (const rule of agent.permission) {
    if (!wildcardMatches(tool, rule.permission)) continue
    if (rule.pattern === "*") {
      matches = rule.action === expectedAction
    } else if (matches && rule.action !== expectedAction) {
      matches = false
    }
  }
  return matches
}

export async function resolveFinalProjectAgent(
  client: FinalOpenCodeAgentRegistryClient,
  directory: string,
  name: string,
): Promise<{ readonly name: string; readonly model: DelegatedModelConfig | undefined }> {
  if (!hasProjectAgentProvenance(directory, name)) {
    throw new ProjectAgentResolutionError(
      `Project agent '${name}' has no config-time provenance in the nearest registered snapshot for this directory or its ancestors.`,
    )
  }
  const registry = await loadFinalOpenCodeAgentRegistry(client, directory)
  const agent = registry.map((entry) => FinalOpenCodeAgentSchema.safeParse(entry))
    .find((entry) => entry.success && entry.data.name === name)?.data
  if (agent === undefined) {
    throw new ProjectAgentResolutionError(`Project agent '${name}' has no exact final OpenCode registry entry.`)
  }
  if (agent.native !== false) {
    throw new ProjectAgentResolutionError(`Project agent '${name}' must have native === false.`)
  }
  if (agent.hidden === true) {
    throw new ProjectAgentResolutionError(`Project agent '${name}' must not be hidden.`)
  }
  if (agent.mode !== "subagent" && agent.mode !== "all") {
    throw new ProjectAgentResolutionError(`Project agent '${name}' mode must be 'subagent' or 'all'.`)
  }
  for (const tool of REQUIRED_TEAM_TOOLS) {
    if (!hasUnconditionalFinalAction(agent, tool, "allow")) {
      throw new ProjectAgentResolutionError(
        `Project agent '${name}' must unconditionally allow ${tool} in its final permission rules.`,
      )
    }
  }
  const launchToolPermissions = {
    task: false,
    call_omo_agent: true,
    question: false,
    ...getAgentToolRestrictions(name, { includeTeamToolDenylist: false }),
  }
  for (const [tool, allowed] of Object.entries(launchToolPermissions)) {
    if (!hasUnconditionalFinalAction(agent, tool, "allow")
      && (allowed || !hasUnconditionalFinalAction(agent, tool, "deny"))) {
      throw new ProjectAgentResolutionError(
        `Project agent '${name}' must already agree with the launch permission '${tool}: ${allowed}' in its final permission rules.`,
      )
    }
  }
  const model = agent.model == null ? undefined
    : agent.variant == null ? agent.model : { ...agent.model, variant: agent.variant }
  return { name: agent.name, model }
}
