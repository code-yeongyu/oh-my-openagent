import * as fs from "node:fs/promises"
import * as path from "path"
import { parseFrontmatter } from "@oh-my-opencode/utils"
import { parseSkillMcpConfigFromFrontmatter, loadMcpJsonFromDir } from "./src/features/opencode-skill-loader/skill-mcp-config"
import { resolveSkillPathReferences } from "./src/shared/skill-path-resolver"
import { sanitizeModelField } from "@oh-my-opencode/model-core"
import { parseAllowedTools } from "./src/features/opencode-skill-loader/allowed-tools-parser"

const SKILLS_DIR = "/root/.config/opencode/skills"

async function testDownstream(name: string) {
  const skillPath = path.join(SKILLS_DIR, name, "SKILL.md")
  const resolvedPath = path.join(SKILLS_DIR, name)
  
  console.log(`\n=== ${name} ===`)
  
  const content = await fs.readFile(skillPath, "utf-8")
  
  // 1. Test parseFrontmatter
  try {
    const { data, body } = parseFrontmatter(content)
    console.log(`  [1] parseFrontmatter: OK (name=${data.name})`)
    
    // 2. Test parseSkillMcpConfigFromFrontmatter
    try {
      const mcpConfig = parseSkillMcpConfigFromFrontmatter(content)
      console.log(`  [2] parseSkillMcpConfigFromFrontmatter: OK`)
    } catch (err: any) {
      console.log(`  [2] parseSkillMcpConfigFromFrontmatter: FAILED - ${err.message}`)
    }
    
    // 3. Test loadMcpJsonFromDir
    try {
      const mcpJson = await loadMcpJsonFromDir(resolvedPath)
      console.log(`  [3] loadMcpJsonFromDir: OK`)
    } catch (err: any) {
      console.log(`  [3] loadMcpJsonFromDir: FAILED - ${err.message}`)
    }
    
    // 4. Test resolveSkillPathReferences
    try {
      const resolvedBody = resolveSkillPathReferences(body.trim(), resolvedPath)
      console.log(`  [4] resolveSkillPathReferences: OK (len=${resolvedBody.length})`)
    } catch (err: any) {
      console.log(`  [4] resolveSkillPathReferences: FAILED - ${err.message}`)
    }
    
    // 5. Test sanitizeModelField
    try {
      const model = sanitizeModelField(data.model, "opencode")
      console.log(`  [5] sanitizeModelField: OK (model=${model})`)
    } catch (err: any) {
      console.log(`  [5] sanitizeModelField: FAILED - ${err.message}`)
    }
    
    // 6. Test parseAllowedTools
    try {
      const allowedTools = parseAllowedTools(data["allowed-tools"])
      console.log(`  [6] parseAllowedTools: OK (tools=${JSON.stringify(allowedTools)})`)
    } catch (err: any) {
      console.log(`  [6] parseAllowedTools: FAILED - ${err.message}`)
    }
    
  } catch (err: any) {
    console.log(`  [1] parseFrontmatter: FAILED - ${err.message}`)
  }
}

const SKILLS = ["grilling", "grill-with-docs", "teach", "scaffold-exercises", "obsidian", "codex", "claude", "review"]

for (const skill of SKILLS) {
  await testDownstream(skill)
}
