import { describe, expect, test } from "bun:test"
import { stat } from "node:fs/promises"

interface NpmPackFile {
  readonly path: string
}

interface NpmPackEntry {
  readonly files: readonly NpmPackFile[]
}

class NpmPackJsonShapeError extends Error {
  constructor() {
    super("npm pack --json output did not match expected file manifest shape")
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isNpmPackFile(value: unknown): value is NpmPackFile {
  return isRecord(value) && typeof value.path === "string"
}

function isNpmPackEntry(value: unknown): value is NpmPackEntry {
  return isRecord(value) && Array.isArray(value.files) && value.files.every(isNpmPackFile)
}

function parseNpmPackEntries(stdout: string): readonly NpmPackEntry[] {
  const parsed: unknown = JSON.parse(stdout)
  const entries = Array.isArray(parsed) ? parsed : isRecord(parsed) ? Object.values(parsed) : undefined
  if (entries?.length !== 1 || !entries.every(isNpmPackEntry)) {
    throw new NpmPackJsonShapeError()
  }
  return entries
}

describe("shared skills package manifest", () => {
  test("#given root package metadata #when shared-skills package is required #then workspace and tarball entries include it", async () => {
    // given
    const rootPackageJson = await Bun.file("package.json").json()

    // when
    const workspaces = rootPackageJson.workspaces
    const files = rootPackageJson.files
    const devDependency = rootPackageJson.devDependencies["@oh-my-opencode/shared-skills"]
    const sharedPackageJson = await Bun.file("packages/shared-skills/package.json").json()

    // then
    expect(workspaces).toContain("packages/shared-skills")
    expect(files).toContain("packages/shared-skills/skills")
    expect(devDependency).toBe("workspace:*")
    expect(sharedPackageJson).toEqual({
      name: "@oh-my-opencode/shared-skills",
      version: "0.1.0",
      type: "module",
      private: true,
      description: "Cross-harness SKILL.md files shared between OMO and Codex",
      exports: {
        ".": {
          types: "./index.d.ts",
          import: "./index.mjs",
        },
      },
      types: "./index.d.ts",
      files: ["index.d.ts", "index.mjs", "skills"],
    })
  })

  test("#given shared user skills #when copied into the package #then frontmatter and resource directories are preserved", async () => {
    // given
    const copiedSkills = ["coding-agent-sessions", "debugging", "programming", "refactor", "remove-ai-slops"] as const

    // when
    const skillFiles = await Promise.all(
      copiedSkills.map(async (skillName) => ({
        name: skillName,
        content: await Bun.file(`packages/shared-skills/skills/${skillName}/SKILL.md`).text(),
      })),
    )

    // then
    for (const skill of skillFiles) {
      expect(skill.content.startsWith("---\n")).toBe(true)
      expect(skill.content).toContain(`name: ${skill.name}`)
    }
    expect((await stat("packages/shared-skills/skills/debugging/references")).isDirectory()).toBe(true)
    expect((await stat("packages/shared-skills/skills/coding-agent-sessions/scripts")).isDirectory()).toBe(true)
    expect((await stat("packages/shared-skills/skills/coding-agent-sessions/references")).isDirectory()).toBe(true)
    expect((await stat("packages/shared-skills/skills/programming/references")).isDirectory()).toBe(true)
    expect((await stat("packages/shared-skills/skills/programming/scripts")).isDirectory()).toBe(true)
  })

  test("#given coding-agent-sessions skill #when shared-skills is packed #then dev fixtures and caches are excluded", () => {
    // when
    const result = Bun.spawnSync(["npm", "pack", "--dry-run", "--json", "./packages/shared-skills"], {
      cwd: process.cwd(),
      stderr: "pipe",
      stdout: "pipe",
    })

    // then
    expect(result.exitCode).toBe(0)
    const entries = parseNpmPackEntries(result.stdout.toString())
    const files = entries[0]?.files.map((file) => file.path) ?? []
    const codingAgentFiles = files.filter((file) => file.startsWith("skills/coding-agent-sessions/"))
    const forbiddenFiles = codingAgentFiles.filter(
      (file) =>
        file.startsWith("skills/coding-agent-sessions/scripts/tests/") ||
        file.includes("__pycache__") ||
        file.endsWith(".pyc") ||
        file.includes(".pytest_cache") ||
        file.includes(".ruff_cache") ||
        file.endsWith(".gitignore") ||
        file.endsWith("pyrightconfig.json"),
    )

    expect(codingAgentFiles).toContain("skills/coding-agent-sessions/scripts/find-agent-sessions.py")
    expect(codingAgentFiles).toContain("skills/coding-agent-sessions/scripts/agent_sessions/cli.py")
    expect(codingAgentFiles).toContain("skills/coding-agent-sessions/references/all-platforms.md")
    expect(forbiddenFiles).toEqual([])
  })
})
