import type { HostKind, HostToolDefinition, JsonObject } from "../host-contract"
import { discoverAllSkills, type LoadedSkill } from "../features/opencode-skill-loader"
import { SkillMcpManager, type SkillMcpServerContext } from "../features/skill-mcp-manager"
import { parseSkillMcpArguments } from "../tools/skill-mcp/parse-skill-mcp-arguments"
import { registerTargetTool, type TargetToolDefinition, type TargetToolRegistry } from "../host-tools"

type SkillMcpOperation = "tool" | "resource" | "prompt"

type TargetSkillMcpManager = Pick<SkillMcpManager, "callTool" | "readResource" | "getPrompt" | "disconnectSession">

const parameters: JsonObject = {
  type: "object",
  properties: {
    mcp_name: { type: "string" },
    tool_name: { type: "string" },
    resource_name: { type: "string" },
    prompt_name: { type: "string" },
    arguments: {
      type: "string",
      description: "Optional MCP arguments encoded as a JSON object string.",
    },
  },
  required: ["mcp_name"],
  additionalProperties: false,
}

function operation(input: Record<string, unknown>): { type: SkillMcpOperation; name: string } {
  const choices: Array<{ type: SkillMcpOperation; name: string }> = []
  for (const [key, type] of [
    ["tool_name", "tool"],
    ["resource_name", "resource"],
    ["prompt_name", "prompt"],
  ] as const) {
    if (typeof input[key] === "string" && input[key].length > 0) choices.push({ type, name: input[key] })
  }
  if (choices.length !== 1) throw new Error("Exactly one of tool_name, resource_name, or prompt_name is required.")
  return choices[0]
}

function findServer(skills: readonly LoadedSkill[], name: string): { skill: LoadedSkill; context: SkillMcpServerContext } {
  for (const skill of skills) {
    const config = skill.mcpConfig?.[name]
    if (config) return { skill, context: { skillName: skill.name, config } }
  }
  throw new Error(`Skill MCP server "${name}" was not found in discovered skills.`)
}

export function registerTargetSkillMcpTool(options: {
  host: Exclude<HostKind, "opencode">
  registry: TargetToolRegistry
  cwd: string
  sessionID?: () => string
  manager?: TargetSkillMcpManager
  discoverSkills?: () => Promise<LoadedSkill[]>
}): TargetToolDefinition {
  const manager = options.manager ?? new SkillMcpManager()
  const sessionID = options.sessionID ?? (() => `${options.host}:${process.pid}`)
  const discoverSkills = options.discoverSkills ?? (() => discoverAllSkills(options.cwd))
  const tool: HostToolDefinition<JsonObject> = {
    name: "skill_mcp",
    label: "Skill MCP",
    description: "Call tools, resources, and prompts from MCP servers embedded in discovered skills.",
    parameters,
    execute: async ({ input }) => {
      const mcpName = input.mcp_name
      if (typeof mcpName !== "string") throw new Error("mcp_name is required.")
      const selected = operation(input)
      const found = findServer(await discoverSkills(), mcpName)
      const info = {
        serverName: mcpName,
        skillName: found.skill.name,
        sessionID: sessionID(),
        scope: found.skill.scope,
        directory: options.cwd,
      }
      const rawArguments = input.arguments
      const args = parseSkillMcpArguments(
        typeof rawArguments === "string" || (typeof rawArguments === "object" && rawArguments !== null && !Array.isArray(rawArguments))
          ? rawArguments
          : undefined,
      )
      try {
        let result: unknown
        if (selected.type === "tool") result = await manager.callTool(info, found.context, selected.name, args)
        else if (selected.type === "resource") result = await manager.readResource(info, found.context, selected.name)
        else {
          result = await manager.getPrompt(
            info,
            found.context,
            selected.name,
            Object.fromEntries(Object.entries(args).map(([key, value]) => [key, String(value)])),
          )
        }
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }
      } finally {
        await manager.disconnectSession(info.sessionID)
      }
    },
  }

  return registerTargetTool(options.registry, tool, {
    host: options.host,
    parameters: { kind: "json-schema", schema: parameters },
    createSessionContext: () => ({
      id: sessionID(),
      cwd: options.cwd,
      actions: {
        sendUserMessage: async () => {},
        sendInternalMessage: async () => {},
        appendEntry: async () => {},
        getSessionName: () => undefined,
        setSessionName: async () => {},
        getContextUsage: () => undefined,
        compact: async () => {},
        abort: () => {},
        isIdle: () => true,
        hasPendingMessages: () => false,
      },
    }),
  })
}
