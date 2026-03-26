import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadOpencodeGlobalCommands, loadOpencodeProjectCommands } from "./loader"

const TEST_DIR = join(tmpdir(), `claude-code-command-loader-${Date.now()}`)

function writeCommand(directory: string, name: string, description: string): void {
  mkdirSync(directory, { recursive: true })
  writeFileSync(
    join(directory, `${name}.md`),
    `---\ndescription: ${description}\n---\nRun ${name}.\n`,
  )
}

describe("claude-code command loader", () => {
  let originalOpencodeConfigDir: string | undefined

  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true })
    originalOpencodeConfigDir = process.env.OPENCODE_CONFIG_DIR
  })

  afterEach(() => {
    if (originalOpencodeConfigDir === undefined) {
      delete process.env.OPENCODE_CONFIG_DIR
    } else {
      process.env.OPENCODE_CONFIG_DIR = originalOpencodeConfigDir
    }
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  it("#given a parent .opencode/commands directory #when loadOpencodeProjectCommands is called from child directory #then it loads the ancestor command", async () => {
    // given
    const projectDir = join(TEST_DIR, "project")
    const childDir = join(projectDir, "apps", "desktop")
    writeCommand(join(projectDir, ".opencode", "commands"), "ancestor", "Ancestor command")

    // when
    const commands = await loadOpencodeProjectCommands(childDir)

    // then
    expect(commands.ancestor?.description).toBe("(opencode-project) Ancestor command")
  })

  it("#given a .opencode/command directory #when loadOpencodeProjectCommands is called #then it loads the singular alias directory", async () => {
    // given
    writeCommand(join(TEST_DIR, ".opencode", "command"), "singular", "Singular command")

    // when
    const commands = await loadOpencodeProjectCommands(TEST_DIR)

    // then
    expect(commands.singular?.description).toBe("(opencode-project) Singular command")
  })

  it("#given a global .opencode/commands directory #when loadOpencodeGlobalCommands is called #then it loads the plural alias directory", async () => {
    // given
    const opencodeConfigDir = join(TEST_DIR, "opencode-config")
    process.env.OPENCODE_CONFIG_DIR = opencodeConfigDir
    writeCommand(join(opencodeConfigDir, "commands"), "global-plural", "Global plural command")

    // when
    const commands = await loadOpencodeGlobalCommands()

    // then
    expect(commands["global-plural"]?.description).toBe("(opencode) Global plural command")
  })
})
