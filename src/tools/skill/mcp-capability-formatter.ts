import type { Prompt, Resource, Tool } from "@modelcontextprotocol/sdk/types.js"
import { sanitizeJsonSchema } from "../../plugin/normalize-tool-arg-schemas"
import type {
  SkillMcpClientInfo,
  SkillMcpManager,
  SkillMcpServerContext,
} from "../../features/skill-mcp-manager"
import type { LoadedSkill } from "../../features/opencode-skill-loader"

export async function formatMcpCapabilities(
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
      scope: skill.scope,
    }
    const context: SkillMcpServerContext = {
      config,
      skillName: skill.name,
    }

    sections.push(`### ${serverName}`, "")

    try {
      const [tools, resources, prompts] = await Promise.all([
        manager.listTools(info, context).catch(() => []),
        manager.listResources(info, context).catch(() => []),
        manager.listPrompts(info, context).catch(() => []),
      ])

      appendToolSections(sections, tools as Tool[])
      appendResourceSection(sections, resources as Resource[])
      appendPromptSection(sections, prompts as Prompt[])

      if (tools.length === 0 && resources.length === 0 && prompts.length === 0) {
        sections.push("*No capabilities discovered*")
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      sections.push(`*Failed to connect: ${errorMessage.split("\n")[0]}*`)
    }

    sections.push("", `Use \`skill_mcp\` tool with \`mcp_name=\"${serverName}\"\` to invoke.`, "")
  }

  return sections.join("\n")
}

function appendToolSections(sections: string[], tools: Tool[]): void {
  if (tools.length === 0) {
    return
  }

  sections.push("**Tools:**", "")

  for (const toolDefinition of tools) {
    sections.push(`#### \`${toolDefinition.name}\``)
    if (toolDefinition.description) {
      sections.push(toolDefinition.description)
    }
    sections.push(
      "",
      "**inputSchema:**",
      "```json",
      JSON.stringify(sanitizeJsonSchema(toolDefinition.inputSchema), null, 2),
      "```",
      ""
    )
  }
}

function appendResourceSection(sections: string[], resources: Resource[]): void {
  if (resources.length === 0) {
    return
  }

  sections.push(`**Resources**: ${resources.map((resource) => resource.uri).join(", ")}`)
}

function appendPromptSection(sections: string[], prompts: Prompt[]): void {
  if (prompts.length === 0) {
    return
  }

  sections.push(`**Prompts**: ${prompts.map((prompt) => prompt.name).join(", ")}`)
}
