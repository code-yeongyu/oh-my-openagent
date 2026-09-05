import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import {
  BUNDLED_SDK_FLOOR,
  claudeCodeExecutableOverride,
  STANDALONE_CLAUDE_CODE_FLOOR,
} from "../bin/lib/claude-code-executable.js"

const roots: string[] = []

type Fixture = { senpiRoot: string; root: string; standaloneBinary: string }

function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(value))
}

function createFixture(options: { bundled?: string; standalone?: string } = {}): Fixture {
  const { bundled = "0.3.241", standalone } = options
  const home = mkdtempSync(join(tmpdir(), "omo-claude-executable-"))
  roots.push(home)
  const nodeModules = join(home, "node_modules")
  const senpiRoot = join(nodeModules, "@code-yeongyu", "senpi")
  const root = join(nodeModules, "omo-ai")
  writeJson(join(senpiRoot, "package.json"), { name: "@code-yeongyu/senpi", version: "2026.9.2-4" })
  writeJson(join(root, "package.json"), { name: "omo-ai", version: "5.0.0-0.beta.35" })
  if (bundled !== "") {
    writeJson(join(nodeModules, "@anthropic-ai", "claude-agent-sdk", "package.json"), {
      name: "@anthropic-ai/claude-agent-sdk",
      version: bundled,
    })
  }
  const standaloneRoot = join(nodeModules, "@anthropic-ai", "claude-code")
  const standaloneBinary = join(standaloneRoot, "bin", "claude.exe")
  if (standalone !== undefined) {
    writeJson(join(standaloneRoot, "package.json"), {
      name: "@anthropic-ai/claude-code",
      version: standalone,
      bin: { claude: "bin/claude.exe" },
    })
    mkdirSync(dirname(standaloneBinary), { recursive: true })
    writeFileSync(standaloneBinary, "")
  }
  return { senpiRoot, root, standaloneBinary }
}

function override(fixture: Fixture, env: Record<string, string> = {}) {
  return claudeCodeExecutableOverride({ env, senpiRoot: fixture.senpiRoot, root: fixture.root })
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("claudeCodeExecutableOverride", () => {
  describe("#given a bundled claude-agent-sdk below the floor and a newer standalone Claude Code", () => {
    describe("#when the launcher composes the engine environment", () => {
      test("#then the standalone binary is handed to the engine", () => {
        const fixture = createFixture({ bundled: "0.3.241", standalone: "2.1.259" })
        expect(override(fixture)).toBe(fixture.standaloneBinary)
      })
    })
  })

  describe("#given the user already set CLAUDE_CODE_EXECUTABLE", () => {
    describe("#when the bundled build is stale and a newer standalone exists", () => {
      test("#then the explicit value is left untouched", () => {
        const fixture = createFixture({ bundled: "0.3.241", standalone: "2.1.259" })
        expect(override(fixture, { CLAUDE_CODE_EXECUTABLE: "/custom/claude" })).toBeUndefined()
      })
    })
  })

  describe("#given a bundled claude-agent-sdk at the floor", () => {
    describe("#when a newer standalone Claude Code is installed", () => {
      test("#then the bundled binary keeps serving the lane", () => {
        const fixture = createFixture({ bundled: BUNDLED_SDK_FLOOR, standalone: "2.1.259" })
        expect(override(fixture)).toBeUndefined()
      })
    })
  })

  describe("#given a stale bundled claude-agent-sdk", () => {
    describe("#when no standalone Claude Code is installed", () => {
      test("#then nothing is injected", () => {
        const fixture = createFixture({ bundled: "0.3.241" })
        expect(override(fixture)).toBeUndefined()
      })
    })

    describe("#when the installed standalone Claude Code is itself below the floor", () => {
      test("#then nothing is injected, because it carries the same stale binary", () => {
        const fixture = createFixture({ bundled: "0.3.241", standalone: "2.1.251" })
        expect(override(fixture)).toBeUndefined()
      })
    })

    describe("#when the standalone Claude Code is exactly at the floor", () => {
      test("#then that binary is handed to the engine", () => {
        const fixture = createFixture({ bundled: "0.3.241", standalone: STANDALONE_CLAUDE_CODE_FLOOR })
        expect(override(fixture)).toBe(fixture.standaloneBinary)
      })
    })
  })

  describe("#given the bundled claude-agent-sdk cannot be inspected", () => {
    describe("#when the launcher composes the engine environment", () => {
      test("#then resolution fails open and the engine spawns unchanged", () => {
        const fixture = createFixture({ bundled: "", standalone: "2.1.259" })
        expect(override(fixture)).toBeUndefined()
      })
    })
  })

  describe("#given a standalone manifest that cannot be parsed", () => {
    describe("#when the launcher composes the engine environment", () => {
      test("#then the thrown parse error never reaches the spawn path", () => {
        const fixture = createFixture({ bundled: "0.3.241", standalone: "2.1.259" })
        writeFileSync(join(dirname(dirname(fixture.standaloneBinary)), "package.json"), "{ not json")
        expect(override(fixture)).toBeUndefined()
      })
    })
  })
})
