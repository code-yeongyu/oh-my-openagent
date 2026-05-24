import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"

/**
 * Built-in find_skills tool.
 * Searches the local skill registry and skills.sh ecosystem for matching skills.
 * Activated automatically by the auto-skill-detector when agents need a capability.
 */
export function createFindSkillsTool(): ToolDefinition {
  return tool({
    description:
      "Search the skill registry and skills.sh ecosystem for capabilities matching a query. " +
      "Use this when you encounter an unfamiliar domain, the user asks for functionality you lack, " +
      "or you need specialized knowledge for a task. Returns skill name, trigger, and path.",
    args: {
      query: tool.schema.string().describe("Domain, task, or capability to search for (e.g. 'playwright', 'React testing', 'deploy')"),
    },
    execute: async ({ query }: { query: string }) => {
      const results: Array<{
        name: string
        description: string
        trigger: string
        path: string
      }> = []

      try {
        const fs = await import("node:fs")
        const path = await import("node:path")
        const projectRoot = process.cwd()
        const searchDirs = [
          path.join(projectRoot, ".agents", "skills"),
          path.join(process.env.HOME || "", ".config", "opencode", "skills"),
        ]

        for (const dir of searchDirs) {
          if (!fs.existsSync(dir)) continue
          const entries = fs.readdirSync(dir, { withFileTypes: true })
          for (const entry of entries) {
            if (!entry.isDirectory()) continue
            const skillMdPath = path.join(dir, entry.name, "SKILL.md")
            if (!fs.existsSync(skillMdPath)) continue

            const content = fs.readFileSync(skillMdPath, "utf-8")
            const nameMatch = content.match(/name:\s*(\S+)/)
            const descMatch = content.match(/description:\s*>\s*\n\s*(.+)/) || content.match(/description:\s*(.+)/)
            const name = nameMatch?.[1] ?? entry.name
            const desc = descMatch?.[1] ?? ""

            const queryLower = query.toLowerCase()
            const nameLower = name.toLowerCase()
            const descLower = desc.toLowerCase()

            if (nameLower.includes(queryLower) || descLower.includes(queryLower)) {
              if (results.some(r => r.name === name)) continue
              const triggerMatch = desc.match(/Trigger:\s*(.+?)(?:\.|$)/)
              results.push({
                name,
                description: desc.substring(0, 120),
                trigger: triggerMatch?.[1]?.trim() ?? "",
                path: skillMdPath,
              })
            }
          }
        }
      } catch {
        // File system search is non-critical
      }

      if (results.length === 0) {
        return JSON.stringify({
          found: false,
          message: `No skills found matching "${query}". You can handle this task directly or create a new skill with /create-skill.`,
          skills: [],
        }, null, 2)
      }

      return JSON.stringify({
        found: true,
        message: `Found ${results.length} matching skill(s)`,
        skills: results,
      }, null, 2)
    },
  })
}
