import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import { BUILTIN_MCP_TOOL_HINTS, SKILL_MCP_DESCRIPTION } from "./constants"
import type { SkillMcpArgs } from "./types"
import type { SkillMcpManager, SkillMcpClientInfo, SkillMcpServerContext } from "../../features/skill-mcp-manager"
import type { LoadedSkill } from "../../features/opencode-skill-loader/types"
import type { ClaudeCodeMcpServer } from "../../features/claude-code-mcp-loader/types"

interface SkillMcpToolOptions {
  manager: SkillMcpManager
  getLoadedSkills: () => LoadedSkill[]
  getSessionID?: () => string | undefined
}

type OperationType = { type: "tool" | "resource" | "prompt" | "list_tools"; name: string }

interface ResolvedMcpServer {
  mcpName: string
  skill: LoadedSkill
  config: NonNullable<LoadedSkill["mcpConfig"]>[string]
  deprecationMessage?: string
}

function validateOperationParams(args: SkillMcpArgs): OperationType {
  const operations: OperationType[] = []
  if (args.list_tools) operations.push({ type: "list_tools", name: "list_tools" })
  if (args.tool_name) operations.push({ type: "tool", name: args.tool_name })
  if (args.resource_name) operations.push({ type: "resource", name: args.resource_name })
  if (args.prompt_name) operations.push({ type: "prompt", name: args.prompt_name })

  if (operations.length === 0) {
    throw new Error(
      `Missing operation. Exactly one of tool_name, resource_name, or prompt_name must be specified.\n\n` +
        `Legacy compatibility: list_tools=true is also supported.\n\n` +
        `Examples:\n` +
        `  skill_mcp(mcp_name="sqlite", list_tools=true)\n` +
        `  skill_mcp(mcp_name="sqlite", tool_name="query", arguments='{"sql": "SELECT * FROM users"}')\n` +
        `  skill_mcp(mcp_name="memory", resource_name="memory://notes")\n` +
        `  skill_mcp(mcp_name="helper", prompt_name="summarize", arguments='{"text": "..."}')`,
    )
  }

  if (operations.length > 1) {
    const provided = [
      args.list_tools ? `list_tools=true` : undefined,
      args.tool_name && `tool_name="${args.tool_name}"`,
      args.resource_name && `resource_name="${args.resource_name}"`,
      args.prompt_name && `prompt_name="${args.prompt_name}"`,
    ]
      .filter(Boolean)
      .join(", ")

    throw new Error(
      `Multiple operations specified. Exactly one of list_tools, tool_name, resource_name, or prompt_name must be provided.\n\n` +
        `Received: ${provided}\n\n` +
        `Use separate calls for each operation.`,
    )
  }

  return operations[0]
}

function findMcpServer(
  mcpName: string,
  skills: LoadedSkill[],
): { skill: LoadedSkill; config: NonNullable<LoadedSkill["mcpConfig"]>[string] } | null {
  for (const skill of skills) {
    if (skill.mcpConfig && mcpName in skill.mcpConfig) {
      return { skill, config: skill.mcpConfig[mcpName] }
    }
  }
  return null
}

function findSkillByName(skillName: string, skills: LoadedSkill[]): LoadedSkill | null {
  for (const skill of skills) {
    if (skill.name === skillName) {
      return skill
    }
  }
  return null
}

function formatAvailableSkills(skills: LoadedSkill[]): string {
  const skillNames = skills.map((skill) => skill.name).sort()
  return skillNames.length > 0 ? skillNames.map((name) => `  - "${name}"`).join("\n") : "  (none found)"
}

function resolveMcpServer(args: SkillMcpArgs, skills: LoadedSkill[]): ResolvedMcpServer {
  if (args.mcp_name) {
    const found = findMcpServer(args.mcp_name, skills)
    if (!found) {
      const builtinHint = formatBuiltinMcpHint(args.mcp_name)
      if (builtinHint) {
        throw new Error(builtinHint)
      }

      throw new Error(
        `MCP server "${args.mcp_name}" not found.\n\n` +
          `Available MCP servers in loaded skills:\n` +
          formatAvailableMcps(skills) +
          `\n\n` +
          `Hint: Load the skill first using the 'skill' tool, then call skill_mcp.`,
      )
    }

    return {
      mcpName: args.mcp_name,
      skill: found.skill,
      config: found.config,
    }
  }

  if (!args.skill_name) {
    throw new Error(
      `Missing target MCP server. Provide mcp_name, or use legacy skill_name compatibility during the bridge window.\n\n` +
        `Available loaded skills:\n` +
        formatAvailableSkills(skills),
    )
  }

  const skill = findSkillByName(args.skill_name, skills)
  if (!skill) {
    throw new Error(
      `Skill "${args.skill_name}" is not loaded.\n\n` +
        `Available loaded skills:\n` +
        formatAvailableSkills(skills),
    )
  }

  const mcpConfig = skill.mcpConfig
  if (!mcpConfig || Object.keys(mcpConfig).length === 0) {
    throw new Error(`Skill "${skill.name}" has no MCP servers configured.`)
  }

  const serverNames = Object.keys(mcpConfig)
  if (serverNames.length !== 1) {
    throw new Error(
      `Legacy skill_name compatibility is ambiguous for skill "${skill.name}".\n` +
        `This skill exposes multiple MCP servers: ${serverNames.join(", ")}.\n` +
        `Use mcp_name="<server>" explicitly instead.`,
    )
  }

  const [mcpName] = serverNames
  return {
    mcpName,
    skill,
    config: mcpConfig[mcpName],
    deprecationMessage:
      `[deprecated] skill_name="${skill.name}" compatibility is temporary. ` +
      `Use mcp_name="${mcpName}" instead.`,
  }
}

function getIncludedToolNames(config: ClaudeCodeMcpServer): string[] | null {
  return Array.isArray(config.includeTools) ? config.includeTools : null
}

function formatToolListOutput(tools: Array<{ name: string; description?: string; inputSchema?: unknown }>): string {
  return JSON.stringify(
    tools.map((toolDefinition) => ({
      name: toolDefinition.name,
      description: toolDefinition.description,
      inputSchema: toolDefinition.inputSchema,
    })),
    null,
    2,
  )
}

function formatAvailableMcps(skills: LoadedSkill[]): string {
  const mcps: string[] = []
  for (const skill of skills) {
    if (skill.mcpConfig) {
      for (const serverName of Object.keys(skill.mcpConfig)) {
        mcps.push(`  - "${serverName}" from skill "${skill.name}"`)
      }
    }
  }
  return mcps.length > 0 ? mcps.join("\n") : "  (none found)"
}

function formatBuiltinMcpHint(mcpName: string): string | null {
  const nativeTools = BUILTIN_MCP_TOOL_HINTS[mcpName]
  if (!nativeTools) return null
  return (
    `"${mcpName}" is a builtin MCP, not a skill MCP.\n` +
    `Use the native tools directly:\n` +
    nativeTools.map((toolName) => `  - ${toolName}`).join("\n")
  )
}

function parseArguments(argsJson: string | Record<string, unknown> | undefined): Record<string, unknown> {
  if (!argsJson) return {}
  if (typeof argsJson === "object" && argsJson !== null) {
    return argsJson
  }
  try {
    // Strip outer single quotes if present (common in LLM output)
    const jsonStr = argsJson.startsWith("'") && argsJson.endsWith("'") ? argsJson.slice(1, -1) : argsJson

    const parsed = JSON.parse(jsonStr)
    if (typeof parsed !== "object" || parsed === null) {
      throw new Error("Arguments must be a JSON object")
    }
    return parsed as Record<string, unknown>
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Invalid arguments JSON: ${errorMessage}\n\n` +
        `Expected a valid JSON object, e.g.: '{"key": "value"}'\n` +
        `Received: ${argsJson}`,
    )
  }
}

export function applyGrepFilter(output: string, pattern: string | undefined): string {
  if (!pattern) return output
  try {
    const regex = new RegExp(pattern, "i")
    const lines = output.split("\n")
    const filtered = lines.filter((line) => regex.test(line))
    return filtered.length > 0 ? filtered.join("\n") : `[grep] No lines matched pattern: ${pattern}`
  } catch {
    return output
  }
}

export function createSkillMcpTool(options: SkillMcpToolOptions): ToolDefinition {
  const { manager, getLoadedSkills, getSessionID } = options

  return tool({
    description: SKILL_MCP_DESCRIPTION,
    args: {
      mcp_name: tool.schema.string().optional().describe("Name of the MCP server from skill config"),
      skill_name: tool.schema.string().optional().describe("Legacy compatibility: loaded skill name to resolve when exactly one MCP server exists"),
      list_tools: tool.schema.boolean().optional().describe("Legacy compatibility: list available tools for the resolved MCP server"),
      tool_name: tool.schema.string().optional().describe("MCP tool to call"),
      resource_name: tool.schema.string().optional().describe("MCP resource URI to read"),
      prompt_name: tool.schema.string().optional().describe("MCP prompt to get"),
      arguments: tool.schema
        .union([tool.schema.string(), tool.schema.object({})])
        .optional()
        .describe("JSON string or object of arguments"),
      grep: tool.schema
        .string()
        .optional()
        .describe("Regex pattern to filter output lines (only matching lines returned)"),
    },
    async execute(args: SkillMcpArgs, toolContext: ToolContext) {
      const operation = validateOperationParams(args)
      const skills = getLoadedSkills()
      const resolved = resolveMcpServer(args, skills)

      const sessionID = toolContext.sessionID || getSessionID?.()
      if (!sessionID) {
        throw new Error("No active session available for skill MCP call.")
      }

      const info: SkillMcpClientInfo = {
        serverName: resolved.mcpName,
        skillName: resolved.skill.name,
        sessionID,
        scope: resolved.skill.scope,
      }

      const context: SkillMcpServerContext = {
        config: resolved.config,
        skillName: resolved.skill.name,
      }

      const parsedArgs = parseArguments(args.arguments)

      let output: string
      switch (operation.type) {
        case "list_tools": {
          const availableTools = await manager.listTools(info, context)
          const includeTools = getIncludedToolNames(resolved.config)
          const filteredTools = includeTools
            ? availableTools.filter((toolDefinition) => includeTools.includes(toolDefinition.name))
            : availableTools
          output = formatToolListOutput(filteredTools)
          break
        }
        case "tool": {
          const result = await manager.callTool(info, context, operation.name, parsedArgs)
          output = JSON.stringify(result, null, 2)
          break
        }
        case "resource": {
          const result = await manager.readResource(info, context, operation.name)
          output = JSON.stringify(result, null, 2)
          break
        }
        case "prompt": {
          const stringArgs: Record<string, string> = {}
          for (const [key, value] of Object.entries(parsedArgs)) {
            stringArgs[key] = String(value)
          }
          const result = await manager.getPrompt(info, context, operation.name, stringArgs)
          output = JSON.stringify(result, null, 2)
          break
        }
      }

      const filteredOutput = applyGrepFilter(output, args.grep)
      if (resolved.deprecationMessage) {
        return `${resolved.deprecationMessage}\n\n${filteredOutput}`
      }

      return filteredOutput
    },
  })
}
