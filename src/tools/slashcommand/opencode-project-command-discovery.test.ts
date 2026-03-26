import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { discoverCommandsSync } from "./command-discovery"

function writeCommand(path: string, description: string, body: string): void {
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, `---\ndescription: ${description}\n---\n${body}\n`)
}

describe("opencode project command discovery", () => {
  let tempDir = ""

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "omo-opencode-project-command-discovery-"))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it("discovers ancestor opencode commands with slash-separated nested names and worktree boundaries", () => {
    // given
    const repositoryDir = join(tempDir, "repo")
    const nestedDirectory = join(repositoryDir, "packages", "app", "src")

    mkdirSync(nestedDirectory, { recursive: true })
    // Use Bun.spawnSync instead of execFileSync to avoid mock leakage
    // from parallel test files (e.g. image-converter.test.ts mocks execFileSync globally)
    Bun.spawnSync(["git", "init"], {
      cwd: repositoryDir,
      stdout: "ignore",
      stderr: "ignore",
    })

    writeCommand(
      join(repositoryDir, ".opencode", "commands", "deploy", "staging.md"),
      "Deploy to staging",
      "Run the staged deploy.",
    )
    writeCommand(
      join(repositoryDir, ".opencode", "command", "release.md"),
      "Release command",
      "Run the release.",
    )
    writeCommand(
      join(tempDir, ".opencode", "commands", "outside.md"),
      "Outside command",
      "Should not be discovered.",
    )

    // when
    const names = discoverCommandsSync(nestedDirectory).map(command => command.name)

    // then
    expect(names).toContain("deploy/staging")
    expect(names).toContain("release")
    expect(names).not.toContain("deploy:staging")
    expect(names).not.toContain("outside")
  })
})
