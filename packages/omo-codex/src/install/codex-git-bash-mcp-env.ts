import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileExistsStrict, isPlainRecord } from "./codex-cache-fs"
import type { CodexInstallPlatform } from "./types"

const GIT_BASH_ENV_KEY = "OMO_CODEX_GIT_BASH_PATH"

export async function stampGitBashMcpEnv(input: {
  readonly pluginRoot: string
  readonly env?: NodeJS.ProcessEnv
  readonly platform?: CodexInstallPlatform
}): Promise<boolean> {
  const manifestPath = join(input.pluginRoot, ".mcp.json")
  if (!(await fileExistsStrict(manifestPath))) return false
  const parsed: unknown = JSON.parse(await readFile(manifestPath, "utf8"))
  if (!isPlainRecord(parsed) || !isPlainRecord(parsed["mcpServers"])) return false

  let changed = false

  if (input.platform === "win32") {
    const rawOverride = input.env?.[GIT_BASH_ENV_KEY]
    const override = typeof rawOverride === "string" ? rawOverride.trim() : ""
    const gitBashServer = parsed["mcpServers"]["git_bash"]

    if (override !== "" && isPlainRecord(gitBashServer)) {
      const serverEnv = isPlainRecord(gitBashServer["env"]) ? gitBashServer["env"] : {}
      if (serverEnv[GIT_BASH_ENV_KEY] !== override) {
        gitBashServer["env"] = { ...serverEnv, [GIT_BASH_ENV_KEY]: override }
        changed = true
      }
    }
  }

  if (!changed) return false
  await writeFile(manifestPath, `${JSON.stringify(parsed, null, "\t")}\n`)
  return true
}
