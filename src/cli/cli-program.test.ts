import { describe, expect, it } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const INSTALL_ARGS = [
  "install",
  "--no-tui",
  "--claude=yes",
  "--gemini=no",
  "--copilot=no",
  "--openai=no",
  "--opencode-zen=no",
  "--zai-coding-plan=no",
  "--kimi-for-coding=no",
  "--skip-auth",
]

const CLI_ENTRY = fileURLToPath(new URL("./index.ts", import.meta.url))

function getSpawnEnv(globalDir: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value
    }
  }
  env.OPENCODE_CONFIG_DIR = globalDir
  return env
}

function runInstall(extraArgs: string[], installArgs: string[] = INSTALL_ARGS): {
  tempDir: string
  globalConfigPath: string
  globalOpenCodeConfigPath: string
  projectConfigPath: string
  exitCode: number
} {
  const tempDir = join(tmpdir(), `omo-cli-program-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const projectDir = join(tempDir, "project")
  const globalDir = join(tempDir, "global")
  const globalConfigPath = join(globalDir, "oh-my-opencode.json")
  const globalOpenCodeConfigPath = join(globalDir, "opencode.json")
  const projectConfigPath = join(projectDir, ".opencode", "oh-my-opencode.json")

  mkdirSync(projectDir, { recursive: true })

  const result = Bun.spawnSync({
    cmd: [process.execPath, CLI_ENTRY, ...installArgs, ...extraArgs],
    cwd: projectDir,
    env: getSpawnEnv(globalDir),
    stdout: "ignore",
    stderr: "pipe",
  })

  return {
    tempDir,
    globalConfigPath,
    globalOpenCodeConfigPath,
    projectConfigPath,
    exitCode: result.exitCode,
  }
}

describe("cli-program install options", () => {
  it("parses --project for install command", () => {
    // #given install command with --project
    const result = runInstall(["--project"])

    try {
      // #then writes project-level config and exits successfully
      expect(result.exitCode).toBe(0)
      expect(existsSync(result.projectConfigPath)).toBe(true)
      expect(existsSync(result.globalConfigPath)).toBe(false)
      expect(existsSync(result.globalOpenCodeConfigPath)).toBe(true)

      const openCodeConfig = JSON.parse(readFileSync(result.globalOpenCodeConfigPath, "utf-8")) as {
        plugin?: string[]
      }
      expect(openCodeConfig.plugin?.some((plugin) => plugin.startsWith("oh-my-opencode"))).toBe(true)
    } finally {
      rmSync(result.tempDir, { recursive: true, force: true })
    }
  }, { timeout: 20000 })

  it("keeps provider configuration in global opencode.json when --project is enabled", () => {
    // #given install command with --project and Gemini enabled
    const geminiInstallArgs = INSTALL_ARGS.map((arg) => (arg === "--gemini=no" ? "--gemini=yes" : arg))
    const result = runInstall(["--project"], geminiInstallArgs)

    try {
      // #then provider config is written to global opencode config
      expect(result.exitCode).toBe(0)
      expect(existsSync(result.projectConfigPath)).toBe(true)
      expect(existsSync(result.globalOpenCodeConfigPath)).toBe(true)

      const openCodeConfig = JSON.parse(readFileSync(result.globalOpenCodeConfigPath, "utf-8")) as {
        provider?: Record<string, unknown>
      }
      expect(openCodeConfig.provider).toHaveProperty("google")
    } finally {
      rmSync(result.tempDir, { recursive: true, force: true })
    }
  }, { timeout: 20000 })
})
