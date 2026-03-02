import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { validateSkillWrite } from "./validator"

function skillContent(description: string): string {
  return `---\ndescription: ${description}\n---\nbody`
}

describe("validator", () => {
  let tempDir: string
  let originalOpenCodeConfigDir: string | undefined
  let originalClaudeConfigDir: string | undefined

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "skill-manage-validator-"))
    originalOpenCodeConfigDir = process.env.OPENCODE_CONFIG_DIR
    originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR
    process.env.OPENCODE_CONFIG_DIR = join(tempDir, "opencode-config")
    process.env.CLAUDE_CONFIG_DIR = join(tempDir, "claude-config")
  })

  afterEach(() => {
    if (originalOpenCodeConfigDir === undefined) delete process.env.OPENCODE_CONFIG_DIR
    else process.env.OPENCODE_CONFIG_DIR = originalOpenCodeConfigDir

    if (originalClaudeConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir

    rmSync(tempDir, { recursive: true, force: true })
  })

  describe("#given invalid input", () => {
    it("#when name format is invalid #then rejects", async () => {
      await expect(validateSkillWrite({ name: "Bad_Name", content: skillContent("test"), scope: "project" })).rejects.toThrow(
        /Invalid skill name/
      )
    })

    it("#when frontmatter description is missing #then rejects", async () => {
      await expect(validateSkillWrite({ name: "valid-name", content: "---\nname: a\n---\nbody", scope: "project" })).rejects.toThrow(
        /description/
      )
    })

    it("#when YAML is invalid #then rejects", async () => {
      await expect(validateSkillWrite({ name: "valid-name", content: "---\ndescription: [\n---\nbody", scope: "project" })).rejects.toThrow(
        /frontmatter/
      )
    })
  })

  describe("#given builtin protected names", () => {
    const builtins = ["git-master", "playwright", "dev-browser", "frontend-ui-ux", "playwright-cli", "agent-browser"]

    for (const builtinName of builtins) {
      it(`#when validating ${builtinName} #then rejects`, async () => {
        await expect(
          validateSkillWrite({ name: builtinName, content: skillContent("test"), scope: "project" })
        ).rejects.toThrow(/reserved/)
      })
    }
  })

  describe("#given potential scope conflict", () => {
    it("#when project scope matches non-project skill #then returns warning", async () => {
      const opencodeSkillsDir = join(process.env.OPENCODE_CONFIG_DIR!, "skills")
      mkdirSync(opencodeSkillsDir, { recursive: true })
      writeFileSync(join(opencodeSkillsDir, "shadowed.md"), skillContent("existing"), "utf8")

      const result = await validateSkillWrite({
        name: "shadowed",
        content: skillContent("new project skill"),
        scope: "project",
      })

      expect(result.warnings.some((warning) => warning.includes("shadow"))).toBe(true)
    })
  })
})
