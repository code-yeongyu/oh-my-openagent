/**
 * /create-skill command: Creates a new SKILL.md from a template.
 * Activated when the user or agent detects a reusable pattern.
 */
export function createSkillCreatorCommand() {
  return {
    name: "/create-skill" as const,
    description: "Create a new AI agent skill following the Agent Skills spec. " +
      "Usage: /create-skill <name> [description]",
    execute: async (args: { params?: string[] }) => {
      const name = args.params?.[0]
      if (!name) {
        return "Usage: /create-skill <skill-name> [description]\nExample: /create-skill react-testing"
      }

      const description = args.params?.slice(1).join(" ") ?? `Skill for ${name}`
      const skillDir = `${process.cwd()}/.agents/skills/${name}`
      const skillPath = `${skillDir}/SKILL.md`

      try {
        const fs = await import("node:fs")
        const path = await import("node:path")

        fs.mkdirSync(skillDir, { recursive: true })

        const template = `---
name: ${name}
description: >
  ${description}.
  Trigger: When {condition} or user mentions {keywords}.
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## When to Use

- {Trigger scenario 1}
- {Trigger scenario 2}

## Critical Patterns

- {Rule 1}
- {Rule 2}

## Commands

\`\`\`bash
{commands}
\`\`\`
`

        fs.writeFileSync(skillPath, template, "utf-8")
        return `Skill created at ${skillPath}\nEdit the SKILL.md to add rules, then load with skill(name="${name}").`
      } catch (error) {
        return `Error creating skill: ${error}`
      }
    },
  }
}

/**
 * /update-skill-registry command: Scans all skill directories and rebuilds registry.
 * Auto-triggered after installing/removing skills.
 */
export function createSkillRegistryCommand() {
  return {
    name: "/update-skill-registry" as const,
    description: "Scan all skill directories and rebuild .atl/skill-registry.md. " +
      "Auto-triggered after skill installs/removals.",
    execute: async () => {
      const fs = await import("node:fs")
      const path = await import("node:path")
      const projectRoot = process.cwd()
      const results: Array<{ name: string; trigger: string; path: string }> = []
      const compactRules: Array<{ name: string; rules: string[] }> = []

      // Scan all known skill directories
      const scanDirs = [
        path.join(projectRoot, ".agents", "skills"),
        path.join(projectRoot, ".opencode", "skills"),
        path.join(process.env.HOME || "", ".config", "opencode", "skills"),
        path.join(process.env.HOME || "", ".claude", "skills"),
      ]

      for (const dir of scanDirs) {
        if (!fs.existsSync(dir)) continue
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          if (!entry.isDirectory()) continue
          if (entry.name.startsWith("sdd-") || entry.name === "_shared" || entry.name === "skill-registry") continue
          const skillMdPath = path.join(dir, entry.name, "SKILL.md")
          if (!fs.existsSync(skillMdPath)) continue

          const content = fs.readFileSync(skillMdPath, "utf-8")
          const nameMatch = content.match(/name:\s*(\S+)/)
          const descMatch = content.match(/description:\s*>\s*\n\s*(.+)/) || content.match(/description:\s*(.+)/)
          const name = nameMatch?.[1] ?? entry.name
          const desc = descMatch?.[1] ?? ""
          const triggerMatch = desc.match(/Trigger:\s*(.+?)(?:\.|$)/)
          const trigger = triggerMatch?.[1]?.trim() ?? ""

          if (results.some(r => r.name === name)) continue
          results.push({ name, trigger, path: skillMdPath })

          const rules: string[] = []
          const lines = content.split("\n")
          let inRules = false
          for (const line of lines) {
            if (line.startsWith("## Critical Patterns") || line.startsWith("## Instructions") || line.startsWith("## Rules")) {
              inRules = true
              continue
            }
            if (line.startsWith("## ") && !line.startsWith("## Critical") && !line.startsWith("## Instruction") && !line.startsWith("## Rule")) {
              inRules = false
            }
            if (inRules && (line.startsWith("- ") || line.startsWith("* "))) {
              rules.push(line.replace(/^[-*]\s*/, "").trim())
            }
            if (rules.length >= 15) break
          }
          compactRules.push({ name, rules })
        }
      }

      const atlDir = path.join(projectRoot, ".atl")
      fs.mkdirSync(atlDir, { recursive: true })

      let registry = "# Skill Registry\n\n"
      registry += "**Delegator use only.** Sub-agents receive compact rules pre-resolved.\n\n"
      registry += "## User Skills\n\n"
      registry += "| Trigger | Skill | Path |\n|---------|-------|------|\n"
      for (const r of results) {
        registry += `| ${r.trigger} | ${r.name} | ${r.path} |\n`
      }

      registry += "\n## Compact Rules\n\n"
      for (const cr of compactRules) {
        if (cr.rules.length === 0) continue
        registry += `### ${cr.name}\n`
        for (const rule of cr.rules) {
          registry += `- ${rule}\n`
        }
        registry += "\n"
      }

      fs.writeFileSync(path.join(atlDir, "skill-registry.md"), registry, "utf-8")
      return `Skill registry updated at .atl/skill-registry.md\nFound ${results.length} skills, extracted rules for ${compactRules.filter(c => c.rules.length > 0).length} skills.`
    },
  }
}
