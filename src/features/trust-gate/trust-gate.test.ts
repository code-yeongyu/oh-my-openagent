import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir, homedir } from "node:os"
import {
  evaluateProjectTrust,
  shouldGateProject,
  getExecutionSurfaces,
  loadTrustedProjects,
  addTrustedProject,
  removeTrustedProject,
  listTrustedProjects,
  type TrustStoreConfig,
  TRUST_ENV_VAR,
} from "./index"

// テスト用ヘルパー
function createTempProject(): string {
  return mkdtempSync(join(tmpdir(), "trust-gate-test-"))
}

function cleanupTempProject(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true })
  } catch {
    // ignore
  }
}

// テスト用Trust Store設定
function createTestStoreConfig(): TrustStoreConfig {
  const tempDir = mkdtempSync(join(tmpdir(), "trust-store-"))
  return {
    trustFilePath: join(tempDir, "trusted.json"),
    fileMode: 0o600,
  }
}

describe("trust-gate", () => {
  describe("#given a project with execution surfaces", () => {
    let projectDir: string
    let storeConfig: TrustStoreConfig
    const originalEnv = process.env[TRUST_ENV_VAR]

    beforeEach(() => {
      projectDir = createTempProject()
      storeConfig = createTestStoreConfig()
    })

    afterEach(() => {
      cleanupTempProject(projectDir)
      if (storeConfig) {
        cleanupTempProject(join(storeConfig.trustFilePath, ".."))
      }
      if (originalEnv !== undefined) {
        process.env[TRUST_ENV_VAR] = originalEnv
      } else {
        delete process.env[TRUST_ENV_VAR]
      }
    })

    describe("#when hooks are defined", () => {
      it("#then should detect hook execution surfaces", () => {
        // given: .claude/settings.json with hooks
        const claudeDir = join(projectDir, ".claude")
        mkdirSync(claudeDir, { recursive: true })
        writeFileSync(
          join(claudeDir, "settings.json"),
          JSON.stringify({
            hooks: [{ event: "pre-tool-use", command: "echo 'hook fired'" }],
          })
        )

        // when: 実行面をスキャン
        const surfaces = getExecutionSurfaces(projectDir)

        // then: hookが検出される
        expect(surfaces.length).toBeGreaterThan(0)
        expect(surfaces.some((s) => s.type === "hook")).toBe(true)
      })
    })

    describe("#when MCP servers are defined", () => {
      it("#then should detect MCP execution surfaces", () => {
        // given: .mcp.json with local MCP
        writeFileSync(
          join(projectDir, ".mcp.json"),
          JSON.stringify({
            mcpServers: {
              test: { command: "node", args: ["./mcp.js"] },
            },
          })
        )

        // when: 実行面をスキャン
        const surfaces = getExecutionSurfaces(projectDir)

        // then: MCPが検出される
        expect(surfaces.some((s) => s.type === "mcp")).toBe(true)
      })
    })

    describe("#when embedded commands are defined", () => {
      it("#then should detect !cmd execution surfaces", () => {
        // given: command file with embedded command
        const cmdDir = join(projectDir, ".opencode", "command")
        mkdirSync(cmdDir, { recursive: true })
        writeFileSync(
          join(cmdDir, "test.md"),
          "# Test\n\nRun this: !`echo hello`"
        )

        // when: 実行面をスキャン
        const surfaces = getExecutionSurfaces(projectDir)

        // then: embedded commandが検出される
        expect(surfaces.some((s) => s.type === "embedded-command")).toBe(true)
      })
    })

    describe("#when local skills are defined", () => {
      it("#then should detect local skill execution surfaces", () => {
        // given: .claude/skills with SKILL.md
        const skillsDir = join(projectDir, ".claude", "skills", "test-skill")
        mkdirSync(skillsDir, { recursive: true })
        writeFileSync(
          join(skillsDir, "SKILL.md"),
          "# Test Skill\n\nUse this: !`npm test`"
        )

        // when: 実行面をスキャン
        const surfaces = getExecutionSurfaces(projectDir)

        // then: local skillが検出される
        expect(surfaces.some((s) => s.type === "local-skill")).toBe(true)
      })
    })
  })

  describe("#given trust evaluation", () => {
    let projectDir: string
    let storeConfig: TrustStoreConfig
    const originalEnv = process.env[TRUST_ENV_VAR]

    beforeEach(() => {
      projectDir = createTempProject()
      storeConfig = createTestStoreConfig()

      // Setup execution surfaces
      const claudeDir = join(projectDir, ".claude")
      mkdirSync(claudeDir, { recursive: true })
      writeFileSync(
        join(claudeDir, "settings.json"),
        JSON.stringify({
          hooks: [{ event: "pre-tool-use", command: "echo 'hook fired'" }],
        })
      )
    })

    afterEach(() => {
      cleanupTempProject(projectDir)
      if (storeConfig) {
        cleanupTempProject(join(storeConfig.trustFilePath, ".."))
      }
      if (originalEnv !== undefined) {
        process.env[TRUST_ENV_VAR] = originalEnv
      } else {
        delete process.env[TRUST_ENV_VAR]
      }
    })

    describe("#when OMO_TRUST_PROJECT=1 is set", () => {
      it("#then should auto-approve via env var", async () => {
        // given: CI escape hatch環境変数
        process.env[TRUST_ENV_VAR] = "1"

        // when: 評価
        const decision = await evaluateProjectTrust(projectDir, {
          storeConfig,
          autoApprove: true,
        })

        // then: 承認される
        expect(decision.approved).toBe(true)
        expect(decision.trustRecord).toBeDefined()
        expect(decision.trustRecord?.approvedBy).toBe("env-var")
      })
    })

    describe("#when project has no execution surfaces", () => {
      it("#then should auto-approve without gate", async () => {
        // given: 実行面なしのproject
        const emptyProject = createTempProject()

        try {
          // when: 評価
          const decision = await evaluateProjectTrust(emptyProject, { storeConfig })

          // then: 自動承認
          expect(decision.approved).toBe(true)
          expect(decision.surfaces).toHaveLength(0)
        } finally {
          cleanupTempProject(emptyProject)
        }
      })
    })

    describe("#when hash changes after approval", () => {
      it("#then should require re-approval", async () => {
        // given: 初期承認
        process.env[TRUST_ENV_VAR] = "1"
        const firstDecision = await evaluateProjectTrust(projectDir, {
          storeConfig,
          autoApprove: true,
        })
        expect(firstDecision.approved).toBe(true)

        delete process.env[TRUST_ENV_VAR]

        // when: 設定ファイルを変更
        const settingsPath = join(projectDir, ".claude", "settings.json")
        writeFileSync(
          settingsPath,
          JSON.stringify({
            hooks: [{ event: "pre-tool-use", command: "echo 'modified hook'" }],
          })
        )

        // then: 再承認が必要（非TTY環境なので拒否される）
        const shouldGate = shouldGateProject(projectDir, storeConfig)
        expect(shouldGate).toBe(true)
      })
    })
  })

  describe("#given trust store operations", () => {
    let storeConfig: TrustStoreConfig

    beforeEach(() => {
      storeConfig = createTestStoreConfig()
    })

    afterEach(() => {
      if (storeConfig) {
        cleanupTempProject(join(storeConfig.trustFilePath, ".."))
      }
    })

    describe("#when adding a trusted project", () => {
      it("#then should persist to file", () => {
        // given: 信頼記録
        const project = {
          absPath: "/test/project",
          configHash: "abc123def456",
          approvedAt: new Date().toISOString(),
          approvedBy: "interactive" as const,
          scope: "all" as const,
        }

        // when: 追加
        addTrustedProject(project, storeConfig)

        // then: 読み出せる
        const list = listTrustedProjects(storeConfig)
        expect(list.length).toBe(1)
        expect(list[0]?.absPath).toBe("/test/project")
      })
    })

    describe("#when removing a trusted project", () => {
      it("#then should remove from file", () => {
        // given: 追加済み
        addTrustedProject(
          {
            absPath: "/test/project",
            configHash: "abc123",
            approvedAt: new Date().toISOString(),
            approvedBy: "interactive",
            scope: "all",
          },
          storeConfig
        )

        // when: 削除
        const removed = removeTrustedProject("/test/project", storeConfig)

        // then: 削除される
        expect(removed).toBe(true)
        const list = listTrustedProjects(storeConfig)
        expect(list.length).toBe(0)
      })
    })

    describe("#when listing trusted projects", () => {
      it("#then should return all projects", () => {
        // given: 複数追加
        addTrustedProject(
          {
            absPath: "/test/project1",
            configHash: "hash1",
            approvedAt: new Date().toISOString(),
            approvedBy: "interactive",
            scope: "all",
          },
          storeConfig
        )
        addTrustedProject(
          {
            absPath: "/test/project2",
            configHash: "hash2",
            approvedAt: new Date().toISOString(),
            approvedBy: "env-var",
            scope: "all",
          },
          storeConfig
        )

        // when: 一覧取得
        const list = listTrustedProjects(storeConfig)

        // then: 両方含まれる
        expect(list.length).toBe(2)
        expect(list.map((p) => p.absPath).sort()).toEqual(["/test/project1", "/test/project2"])
      })
    })
  })
})
