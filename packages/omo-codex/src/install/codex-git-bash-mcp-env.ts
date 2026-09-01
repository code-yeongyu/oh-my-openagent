import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileExistsStrict, isPlainRecord } from "./codex-cache-fs"
import type { CodexInstallPlatform } from "./types"

const GIT_BASH_ENV_KEY = "OMO_CODEX_GIT_BASH_PATH"
const CODEGRAPH_RELATIVE_ARGS = new Set(["components/codegraph/dist/serve.js", "./components/codegraph/dist/serve.js"])

export async function stampGitBashMcpEnv(input: {
  readonly pluginRoot: string
  readonly env?: NodeJS.ProcessEnv
  readonly platform?: CodexInstallPlatform
}): Promise<boolean> {
  const manifestPath = join(input.pluginRoot, ".mcp.json")
  if (!(await fileExistsStrict(manifestPath))) return false
  const parsed: unknown = JSON.parse(await readFile(manifestPath, "utf8"))
  if (!isPlainRecord(parsed) || !isPlainRecord(parsed["mcpServers"])) return false

  let changed = stampCodegraphMcpPath(parsed["mcpServers"], input.pluginRoot)

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

function stampCodegraphMcpPath(mcpServers: Record<string, unknown>, pluginRoot: string): boolean {
  const codegraphServer = mcpServers["codegraph"]
  if (!isPlainRecord(codegraphServer) || !Array.isArray(codegraphServer["args"])) return false

  const args = codegraphServer["args"]
  const entrypoint = args[0]
  if (typeof entrypoint !== "string" || !CODEGRAPH_RELATIVE_ARGS.has(entrypoint)) return false

  codegraphServer["args"] = [join(pluginRoot, "components", "codegraph", "dist", "serve.js"), ...args.slice(1)]
  return true
}
