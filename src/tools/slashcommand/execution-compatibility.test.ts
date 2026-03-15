import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { executeSlashCommand } from "../../hooks/auto-slash-command/executor"
import { discoverCommandsSync } from "./command-discovery"

describe("slashcommand discovery and execution compatibility", () => {
  let tempDir = ""
  let originalWorkingDirectory = ""
  let originalOpencodeConfigDir: string | undefined

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "omo-slashcommand-compat-test-"))
    originalWorkingDirectory = process.cwd()
    originalOpencodeConfigDir = process.env.OPENCODE_CONFIG_DIR
  })

  afterEach(() => {
    process.chdir(originalWorkingDirectory)

    if (originalOpencodeConfigDir === undefined) {
      delete process.env.OPENCODE_CONFIG_DIR
    } else {
      process.env.OPENCODE_CONFIG_DIR = originalOpencodeConfigDir
    }

    rmSync(tempDir, { recursive: true, force: true })
  })

  it("executes commands discovered from a parent opencode config dir", async () => {
    // given
    const projectDir = join(tempDir, "project")
    const opencodeRootDir = join(tempDir, "opencode-root")
    const profileConfigDir = join(opencodeRootDir, "profiles", "codex")
    const parentCommandDir = join(opencodeRootDir, "command")
    const commandName = "parent-only-command"

    mkdirSync(projectDir, { recursive: true })
    mkdirSync(profileConfigDir, { recursive: true })
    mkdirSync(parentCommandDir, { recursive: true })
    writeFileSync(
      join(parentCommandDir, `${commandName}.md`),
      `---\ndescription: Parent config command\n---\nExecute from parent config.\n`,
    )
    process.env.OPENCODE_CONFIG_DIR = profileConfigDir
    process.chdir(projectDir)

    expect(discoverCommandsSync(projectDir).some(command => command.name === commandName)).toBe(true)

    // when
    const result = await executeSlashCommand({
      command: commandName,
      args: "",
      raw: `/${commandName}`,
    }, { skills: [] })

    // then
    expect(result.success).toBe(true)
    expect(result.replacementText).toContain("Execute from parent config.")
    expect(result.replacementText).toContain("**Scope**: opencode")
  })
})
