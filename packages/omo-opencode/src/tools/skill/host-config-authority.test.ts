import { expect, spyOn, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as configDirs from "../../../../skills-loader-core/src/shared"
import { usesProjectEnvironment } from "../../../../mcp-client-core/src/skill-mcp-manager/project-env-policy"
import { OhMyOpenCodeConfigSchema } from "../../config"
import { createSkillContext } from "../../plugin/skill-context"
import { skillMcpClientInfo } from "./skill-mcp-authority"

test.each([false, true])("global opencode skill paths keep user MCP authority with merged host config %s", async (merged: boolean) => {
  // given
  const root = mkdtempSync(join(tmpdir(), "host-config-authority-"))
  const project = join(root, "project")
  const globalConfig = join(root, "global-config")
  const globalSkills = join(root, "team-skills")
  const projectSkills = join(project, "local-skills")
  const projectEscape = join(root, "project-escape")
  for (const dir of [join(project, ".git"), join(project, ".opencode"), globalConfig, globalSkills, projectSkills, projectEscape]) {
    mkdirSync(dir, { recursive: true })
  }
  for (const [dir, name] of [[globalSkills, "global-owned"], [projectSkills, "project-owned"], [projectEscape, "project-escape"]] as const) {
    writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: fixture\nmcp:\n  fixture:\n    command: synthetic\n    env:\n      AUTH: "\${REVIEW_TOKEN}"\n---\nBody\n`)
  }
  writeFileSync(join(globalConfig, "opencode.json"), JSON.stringify({ skills: { paths: [globalSkills] } }))
  writeFileSync(join(project, ".opencode", "opencode.json"), JSON.stringify({ skills: { paths: [projectSkills, projectEscape] } }))
  const dirs = spyOn(configDirs, "getOpenCodeConfigDirs").mockReturnValue([globalConfig])
  try {
    // when
    const context = await createSkillContext({
      directory: project,
      pluginConfig: OhMyOpenCodeConfigSchema.parse({ claude_code: { skills: false } }),
      hostSkills: merged ? { paths: [projectSkills, globalSkills, projectEscape] } : undefined,
    })
    const global = context.mergedSkills.find((skill) => skill.name === "global-owned")
    const local = context.mergedSkills.find((skill) => skill.name === "project-owned")
    if (!global || !local) throw new Error("Configured skills did not load")
    // then
    expect(usesProjectEnvironment(skillMcpClientInfo(global, "fixture", "session", project))).toBe(false)
    expect(usesProjectEnvironment(skillMcpClientInfo(local, "fixture", "session", project))).toBe(true)
    expect(context.mergedSkills.some((skill) => skill.name === "project-escape")).toBe(false)
  } finally {
    dirs.mockRestore()
    rmSync(root, { recursive: true, force: true })
  }
})
