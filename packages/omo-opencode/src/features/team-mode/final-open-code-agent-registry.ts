import path from "node:path"

import { z } from "zod"

import { normalizeSDKResponse } from "../../shared"
import type { DelegatedModelConfig } from "../../shared/model-resolution-types"

const EMPTY_AGENT_REGISTRY: readonly unknown[] = []
const REQUIRED_TEAM_TOOLS = [
  "team_send_message",
  "team_task_list",
  "team_task_get",
  "team_task_update",
  "team_status",
] as const
const PermissionRuleSchema = z.object({
  permission: z.string(),
  pattern: z.string(),
  action: z.enum(["allow", "ask", "deny"]),
})
const FinalOpenCodeAgentSchema = z.object({
  name: z.string(),
  mode: z.string(),
  native: z.boolean(),
  hidden: z.boolean().optional(),
  permission: z.array(PermissionRuleSchema),
  model: z.object({
    providerID: z.string(),
    modelID: z.string(),
  }).optional(),
  variant: z.string().optional(),
})
const projectAgentNamesByDirectory = new Map<string, ReadonlySet<string>>()

type FinalOpenCodeAgent = z.infer<typeof FinalOpenCodeAgentSchema>
type ResolvedFinalProjectAgent = {
  readonly name: string
  readonly model: DelegatedModelConfig | undefined
}

export type FinalOpenCodeAgentRegistryClient = {
  readonly app: {
    readonly agents: (input: {
      readonly query: { readonly directory: string }
    }) => Promise<unknown>
  }
}

export class ProjectAgentResolutionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ProjectAgentResolutionError"
  }
}

export function replaceProjectAgentProvenance(
  directory: string,
  names: readonly string[],
): void {
  projectAgentNamesByDirectory.set(path.resolve(directory), new Set(names))
}

export function hasProjectAgentProvenance(directory: string, name: string): boolean {
  return projectAgentNamesByDirectory.get(path.resolve(directory))?.has(name) === true
}

export function listProjectAgentProvenance(directory: string): readonly string[] {
  return [...(projectAgentNamesByDirectory.get(path.resolve(directory)) ?? [])]
}

export async function loadFinalOpenCodeAgentRegistry(
  client: FinalOpenCodeAgentRegistryClient,
  directory: string,
): Promise<readonly unknown[]> {
  const response = await client.app.agents({ query: { directory } })
  const normalized = normalizeSDKResponse<unknown>(response, EMPTY_AGENT_REGISTRY, {
    preferResponseOnMissingData: true,
  })
  return Array.isArray(normalized) ? normalized : EMPTY_AGENT_REGISTRY
}

function wildcardMatches(value: string, pattern: string): boolean {
  const normalizedValue = value.replaceAll("\\", "/")
  const normalizedPattern = pattern.replaceAll("\\", "/")
  let escapedPattern = normalizedPattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")

  if (escapedPattern.endsWith(" .*")) {
    escapedPattern = `${escapedPattern.slice(0, -3)}( .*)?`
  }

  const flags = process.platform === "win32" ? "si" : "s"
  return new RegExp(`^${escapedPattern}$`, flags).test(normalizedValue)
}

function hasUnconditionalFinalAllow(
  agent: FinalOpenCodeAgent,
  tool: string,
): boolean {
  let hasUnconditionalAllow = false
  for (const rule of agent.permission) {
    if (!wildcardMatches(tool, rule.permission)) {
      continue
    }
    if (rule.action === "allow" && rule.pattern === "*") {
      hasUnconditionalAllow = true
      continue
    }
    if (hasUnconditionalAllow && rule.action !== "allow") {
      return false
    }
  }
  return hasUnconditionalAllow
}

function findExactAgent(registry: readonly unknown[], name: string): FinalOpenCodeAgent | undefined {
  for (const entry of registry) {
    const parsed = FinalOpenCodeAgentSchema.safeParse(entry)
    if (parsed.success && parsed.data.name === name) {
      return parsed.data
    }
  }
  return undefined
}

export async function resolveFinalProjectAgent(
  client: FinalOpenCodeAgentRegistryClient,
  directory: string,
  name: string,
): Promise<ResolvedFinalProjectAgent> {
  if (!hasProjectAgentProvenance(directory, name)) {
    throw new ProjectAgentResolutionError(
      `Project agent '${name}' has no config-time provenance for this exact directory.`,
    )
  }

  const registry = await loadFinalOpenCodeAgentRegistry(client, directory)
  const agent = findExactAgent(registry, name)
  if (agent === undefined) {
    throw new ProjectAgentResolutionError(
      `Project agent '${name}' has no exact final OpenCode registry entry.`,
    )
  }
  if (agent.native !== false) {
    throw new ProjectAgentResolutionError(`Project agent '${agent.name}' must have native === false.`)
  }
  if (agent.hidden === true) {
    throw new ProjectAgentResolutionError(`Project agent '${agent.name}' must not be hidden.`)
  }
  if (agent.mode !== "subagent" && agent.mode !== "all") {
    throw new ProjectAgentResolutionError(
      `Project agent '${agent.name}' mode must be 'subagent' or 'all'.`,
    )
  }
  for (const tool of REQUIRED_TEAM_TOOLS) {
    if (!hasUnconditionalFinalAllow(agent, tool)) {
      throw new ProjectAgentResolutionError(
        `Project agent '${agent.name}' must unconditionally allow ${tool} in its final permission rules.`,
      )
    }
  }

  const model = agent.model === undefined
    ? undefined
    : agent.variant === undefined
      ? agent.model
      : { ...agent.model, variant: agent.variant }
  return { name: agent.name, model }
}
