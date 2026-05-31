import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { clearCommandLoaderCache } from "../../features/claude-code-command-loader"

function requireFresh<T>(modulePath: string): T {
  const resolvedPath = require.resolve(modulePath)
  if (require.cache?.[resolvedPath]) {
    delete require.cache[resolvedPath]
  }
  return require(modulePath) as T
}

function executeSlashCommand(...args: Parameters<typeof import("../../hooks/auto-slash-command/executor").executeSlashCommand>): ReturnType<typeof import("../../hooks/auto-slash-command/executor").executeSlashCommand> {
  return requireFresh<typeof import("../../hooks/auto-slash-command/executor")>("../../hooks/auto-slash-command/executor").executeSlashCommand(...args)
}

function discoverCommandsSync(...args: Parameters<typeof import("./command-discovery").discoverCommandsSync>): ReturnType<typeof import("./command-discovery").discoverCommandsSync> {
  return requireFresh<typeof import("./command-discovery")>("./command-discovery").discoverCommandsSync(...args)
}

describe("slashcommand discovery and execution compatibility", () => {
  let tempDir = ""
  let originalWorkingDirectory = ""
  let originalOpencodeConfigDir: string | undefined

  beforeEach(() => {
    clearCommandLoaderCache()
    tempDir = mkdtempSync(join(tmpdir(), "omo-slashcommand-compat-test-"))
    originalWorkingDirectory = process.cwd()
    originalOpencodeConfigDir = process.env.OPENCODE_CONFIG_DIR
  })

  afterEach(() => {
    clearCommandLoaderCache()
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

  it("executes project commands using the provided directory even when cwd differs", async () => {
    // given
    const projectDir = join(tempDir, "project")
    const commandDir = join(projectDir, ".claude", "commands")
    const commandName = "project-only-command"

    mkdirSync(commandDir, { recursive: true })
    writeFileSync(
      join(commandDir, `${commandName}.md`),
      `---\ndescription: Project command\n---\nExecute from project directory.\n`,
    )
    process.chdir("/tmp")

    expect(discoverCommandsSync(projectDir).some(command => command.name === commandName)).toBe(true)

    // when
    const result = await executeSlashCommand({
      command: commandName,
      args: "",
      raw: `/${commandName}`,
    }, { skills: [], directory: projectDir })

    // then
    expect(result.success).toBe(true)
    expect(result.replacementText).toContain("Execute from project directory.")
    expect(result.replacementText).toContain("**Scope**: project")
  })
})
