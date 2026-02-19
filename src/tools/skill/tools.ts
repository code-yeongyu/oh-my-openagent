import { dirname } from "node:path"
import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { TOOL_DESCRIPTION_NO_SKILLS, TOOL_DESCRIPTION_PREFIX } from "./constants"
import type { SkillArgs, SkillInfo, SkillLoadOptions } from "./types"
import type { LoadedSkill } from "../../features/opencode-skill-loader"
import { getAllSkills, extractSkillTemplate } from "../../features/opencode-skill-loader/skill-content"
import { injectGitMasterConfig } from "../../features/opencode-skill-loader/skill-content"
import type { SkillMcpManager, SkillMcpClientInfo, SkillMcpServerContext } from "../../features/skill-mcp-manager"
import type { Tool, Resource, Prompt } from "@modelcontextprotocol/sdk/types.js"
import { discoverCommandsSync } from "../slashcommand/command-discovery"
import type { CommandInfo } from "../slashcommand/types"
import { formatLoadedCommand } from "../slashcommand/command-output-formatter"

function loadedSkillToInfo(skill: LoadedSkill): SkillInfo {
  return {
    name: skill.name,
    description: skill.definition.description || "",
    location: skill.path,
    scope: skill.scope,
    license: skill.license,
    compatibility: skill.compatibility,
    metadata: skill.metadata,
    allowedTools: skill.allowedTools,
  }
}

function formatCombinedDescription(skills: SkillInfo[], commands: CommandInfo[]): string {
  const lines: string[] = []

  if (skills.length === 0 && commands.length === 0) {
    return TOOL_DESCRIPTION_NO_SKILLS
  }

  // Priority: project > user > opencode/opencode-project > builtin/config
  const scopePriority: Record<string, number> = {
    project: 4,
    user: 3,
    opencode: 2,
    "opencode-project": 2,
    config: 1,
    builtin: 1,
  }

  const allItems: string[] = []

  // Sort and add skills first (skills before commands)
  if (skills.length > 0) {
    const sortedSkills = [...skills].sort((a, b) => {
      const priorityA = scopePriority[a.scope] || 0
      const priorityB = scopePriority[b.scope] || 0
      return priorityB - priorityA // Higher priority first
    })
    sortedSkills.forEach(skill => {
      const parts = [
        "  <skill>",
        `    <name>${skill.name}</name>`,
        `    <description>${skill.description}</description>`,
      ]
      if (skill.compatibility) {
        parts.push(`    <compatibility>${skill.compatibility}</compatibility>`)
      }
      parts.push("  </skill>")
      allItems.push(parts.join("\n"))
    })
  }

  // Sort and add commands second (commands after skills)
  if (commands.length > 0) {
    const sortedCommands = [...commands].sort((a, b) => {
      const priorityA = scopePriority[a.scope] || 0
      const priorityB = scopePriority[b.scope] || 0
      return priorityB - priorityA // Higher priority first
    })
    sortedCommands.forEach(cmd => {
      const hint = cmd.metadata.argumentHint ? ` ${cmd.metadata.argumentHint}` : ""
      const parts = [
        "  <command>",
        `    <name>/${cmd.name}</name>`,
        `    <description>${cmd.metadata.description || "(no description)"}</description>`,
        `    <scope>${cmd.scope}</scope>`,
      ]
      if (hint) {
        parts.push(`    <argument>${hint.trim()}</argument>`)
      }
      parts.push("  </command>")
      allItems.push(parts.join("\n"))
    })
  }

  if (allItems.length > 0) {
    lines.push(`\n<available_items>\nPriority: project > user > opencode > builtin | Skills listed before commands\nInvoke via: skill(name="item-name") — omit leading slash for commands.\n${allItems.join("\n")}\n</available_items>`)
  }

  return TOOL_DESCRIPTION_PREFIX + lines.join("")
}

async function extractSkillBody(skill: LoadedSkill): Promise<string> {
  if (skill.lazyContent) {
    const fullTemplate = await skill.lazyContent.load()
    const templateMatch = fullTemplate.match(/<skill-instruction>([\s\S]*?)<\/skill-instruction>/)
    return templateMatch ? templateMatch[1].trim() : fullTemplate
  }

  if (skill.path) {
    return extractSkillTemplate(skill)
  }

  const templateMatch = skill.definition.template?.match(/<skill-instruction>([\s\S]*?)<\/skill-instruction>/)
  return templateMatch ? templateMatch[1].trim() : skill.definition.template || ""
}

async function formatMcpCapabilities(
  skill: LoadedSkill,
  manager: SkillMcpManager,
  sessionID: string
): Promise<string | null> {
  if (!skill.mcpConfig || Object.keys(skill.mcpConfig).length === 0) {
    return null
  }

  const sections: string[] = ["", "## Available MCP Servers", ""]

  for (const [serverName, config] of Object.entries(skill.mcpConfig)) {
    const info: SkillMcpClientInfo = {
      serverName,
      skillName: skill.name,
      sessionID,
    }
    const context: SkillMcpServerContext = {
      config,
      skillName: skill.name,
    }

    sections.push(`### ${serverName}`)
    sections.push("")

    try {
      const [tools, resources, prompts] = await Promise.all([
        manager.listTools(info, context).catch(() => []),
        manager.listResources(info, context).catch(() => []),
        manager.listPrompts(info, context).catch(() => []),
      ])

      if (tools.length > 0) {
        sections.push("**Tools:**")
        sections.push("")
        for (const t of tools as Tool[]) {
          sections.push(`#### \`${t.name}\``)
          if (t.description) {
            sections.push(t.description)
          }
          sections.push("")
          sections.push("**inputSchema:**")
          sections.push("```json")
          sections.push(JSON.stringify(t.inputSchema, null, 2))
          sections.push("```")
          sections.push("")
        }
      }
      if (resources.length > 0) {
        sections.push(`**Resources**: ${resources.map((r: Resource) => r.uri).join(", ")}`)
      }
      if (prompts.length > 0) {
        sections.push(`**Prompts**: ${prompts.map((p: Prompt) => p.name).join(", ")}`)
      }

      if (tools.length === 0 && resources.length === 0 && prompts.length === 0) {
        sections.push("*No capabilities discovered*")
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      sections.push(`*Failed to connect: ${errorMessage.split("\n")[0]}*`)
    }

    sections.push("")
    sections.push(`Use \`skill_mcp\` tool with \`mcp_name="${serverName}"\` to invoke.`)
    sections.push("")
  }

  return sections.join("\n")
}

export function createSkillTool(options: SkillLoadOptions = {}): ToolDefinition {
  let cachedSkills: LoadedSkill[] | null = null
  let cachedCommands: CommandInfo[] | null = options.commands ?? null
  let cachedDescription: string | null = null

  const getSkills = async (): Promise<LoadedSkill[]> => {
    if (options.skills) return options.skills
    if (cachedSkills) return cachedSkills
    cachedSkills = await getAllSkills({disabledSkills: options?.disabledSkills})
    return cachedSkills
  }

  const getCommands = (): CommandInfo[] => {
    if (cachedCommands) return cachedCommands
    cachedCommands = discoverCommandsSync()
    return cachedCommands
  }

  const buildDescription = async (): Promise<string> => {
    if (cachedDescription) return cachedDescription
    const skills = await getSkills()
    const commands = getCommands()
    const skillInfos = skills.map(loadedSkillToInfo)
    cachedDescription = formatCombinedDescription(skillInfos, commands)
    return cachedDescription
  }

  // Eagerly build description when callers pre-provide skills/commands.
  if (options.skills !== undefined) {
    const skillInfos = options.skills.map(loadedSkillToInfo)
    const commandsForDescription = options.commands ?? []
    cachedDescription = formatCombinedDescription(skillInfos, commandsForDescription)
  } else if (options.commands !== undefined) {
    cachedDescription = formatCombinedDescription([], options.commands)
  } else {
    void buildDescription()
  }

  return tool({
    get description() {
      return cachedDescription ?? TOOL_DESCRIPTION_PREFIX
    },
    args: {
      name: tool.schema.string().describe("The skill or command name (e.g., 'code-review' or 'publish'). Use without leading slash for commands."),
    },
    async execute(args: SkillArgs, ctx?: { agent?: string }) {
      const skills = await getSkills()
      const commands = getCommands()

      const requestedName = args.name.replace(/^\//, "")

      // Check skills first (exact match, case-insensitive)
      const matchedSkill = skills.find(s => s.name.toLowerCase() === requestedName.toLowerCase())

      if (matchedSkill) {
        if (matchedSkill.definition.agent && (!ctx?.agent || matchedSkill.definition.agent !== ctx.agent)) {
          throw new Error(`Skill "${matchedSkill.name}" is restricted to agent "${matchedSkill.definition.agent}"`)
        }

        let body = await extractSkillBody(matchedSkill)

        if (matchedSkill.name === "git-master") {
          body = injectGitMasterConfig(body, options.gitMasterConfig)
        }

        const dir = matchedSkill.path ? dirname(matchedSkill.path) : matchedSkill.resolvedPath || process.cwd()

        const output = [
          `## Skill: ${matchedSkill.name}`,
          "",
          `**Base directory**: ${dir}`,
          "",
          body,
        ]

        if (options.mcpManager && options.getSessionID && matchedSkill.mcpConfig) {
          const mcpInfo = await formatMcpCapabilities(
            matchedSkill,
            options.mcpManager,
            options.getSessionID()
          )
          if (mcpInfo) {
            output.push(mcpInfo)
          }
        }

        return output.join("\n")
      }

      // Check commands (exact match, case-insensitive)
      const matchedCommand = commands.find(c => c.name.toLowerCase() === requestedName.toLowerCase())

      if (matchedCommand) {
        return await formatLoadedCommand(matchedCommand)
      }

      // No match found — provide helpful error with partial matches
      const allNames = [
        ...skills.map(s => s.name),
        ...commands.map(c => `/${c.name}`),
      ]

      const partialMatches = allNames.filter(n =>
        n.toLowerCase().includes(requestedName.toLowerCase())
      )

      if (partialMatches.length > 0) {
        throw new Error(
          `Skill or command "${args.name}" not found. Did you mean: ${partialMatches.join(", ")}?`
        )
      }

      const available = allNames.join(", ")
      throw new Error(
        `Skill or command "${args.name}" not found. Available: ${available || "none"}`
      )
    },
  })
}

export const skill: ToolDefinition = createSkillTool()
