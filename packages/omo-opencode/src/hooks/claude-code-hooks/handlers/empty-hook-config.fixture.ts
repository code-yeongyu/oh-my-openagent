import { afterEach, beforeEach } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { clearClaudeHooksConfigCache } from "../config"
import { clearPluginExtendedConfigCache } from "../config-loader"

const configEnvKeys = ["CLAUDE_CONFIG_DIR", "OPENCODE_CONFIG_DIR", "XDG_CONFIG_HOME"]

export function useEmptyHookConfig(): void {
  let restore: (() => void) | undefined

  beforeEach(() => {
    const cwd = process.cwd()
    const configEnv = configEnvKeys.map((key) => [key, process.env[key]] as const)
    const emptyDir = mkdtempSync(join(tmpdir(), "omo-empty-hook-config-"))
    restore = () => {
      process.chdir(cwd)
      for (const [key, value] of configEnv) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      clearClaudeHooksConfigCache()
      clearPluginExtendedConfigCache()
      rmSync(emptyDir, { recursive: true, force: true })
    }
    process.chdir(emptyDir)
    for (const key of configEnvKeys) process.env[key] = emptyDir
  })

  afterEach(() => {
    restore?.()
    restore = undefined
  })
}
