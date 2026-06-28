import { loadSkillFromPath } from "./src/features/opencode-skill-loader/loaded-skill-from-path"
import { parseFrontmatter } from "@oh-my-opencode/utils"
import * as fs from "node:fs/promises"
import * as path from "path"

const SKILLS = [
  "grilling",
  "grill-with-docs",
  "teach",
  "scaffold-exercises",
  "git-guardrails-claude-code",
  "migrate-to-shoehorn",
  "edit-article",
  "obsidian-vault",
  "decision-mapping",
  "obsidian",
  "codex",
  "claude",
  "review",
]

const SKILLS_DIR = path.resolve("/root/.config/opencode/skills")

async function testSkill(name: string) {
  const skillPath = path.join(SKILLS_DIR, name, "SKILL.md")
  const resolvedPath = path.join(SKILLS_DIR, name)
  
  console.log(`\n=== Testing: ${name} ===`)
  console.log(`Path: ${skillPath}`)
  
  try {
    const stat = await fs.stat(skillPath)
    console.log(`File exists: ${stat.size} bytes`)
    
    const content = await fs.readFile(skillPath, "utf-8")
    console.log(`Content length: ${content.length}`)
    
    const { data, body } = parseFrontmatter(content)
    console.log(`Frontmatter parsed successfully:`)
    console.log(`  name: ${data.name}`)
    console.log(`  description: ${data.description?.substring(0, 80)}...`)
    console.log(`  model: ${data.model}`)
    console.log(`  license: ${data.license}`)
    console.log(`  compatibility: ${data.compatibility}`)
    
    const result = await loadSkillFromPath({
      skillPath,
      resolvedPath,
      defaultName: name,
      scope: "opencode",
    })
    
    if (result) {
      console.log(`loadSkillFromPath: SUCCESS`)
      console.log(`  result.name: ${result.name}`)
    } else {
      console.log(`loadSkillFromPath: returned null`)
    }
  } catch (error) {
    console.error(`Test failed:`, error)
  }
}

async function main() {
  for (const skill of SKILLS) {
    await testSkill(skill)
  }
}

main()
