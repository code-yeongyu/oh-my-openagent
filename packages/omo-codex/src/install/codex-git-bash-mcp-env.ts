import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileExistsStrict, isPlainRecord } from "./codex-cache-fs"
import type { CodexInstallPlatform } from "./types"

const GIT_BASH_ENV_KEY = "OMO_CODEX_GIT_BASH_PATH"
const GIT_BASH_TRANSPORT_ID_ENV_KEY = "OMO_CODEX_GIT_BASH_MCP_TRANSPORT_ID"
const CODEGRAPH_RELATIVE_ARGS = new Set(["components/codegraph/dist/serve.js", "./components/codegraph/dist/serve.js"])

export async function stampGitBashMcpEnv(input: {
  readonly pluginRoot: string
  readonly transportRoot?: string
  readonly env?: { readonly [key: string]: string | undefined }
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

    if (isPlainRecord(gitBashServer)) {
      const serverEnv = isPlainRecord(gitBashServer["env"]) ? gitBashServer["env"] : {}
      const transportId = createGitBashTransportId(input.transportRoot ?? input.pluginRoot)
      const nextEnv = override === ""
        ? { ...serverEnv, [GIT_BASH_TRANSPORT_ID_ENV_KEY]: transportId }
        : { ...serverEnv, [GIT_BASH_ENV_KEY]: override, [GIT_BASH_TRANSPORT_ID_ENV_KEY]: transportId }

      if (JSON.stringify(serverEnv) !== JSON.stringify(nextEnv)) {
        gitBashServer["env"] = nextEnv
        changed = true
      }
    }
  }

  if (!changed) return false
  await writeFile(manifestPath, `${JSON.stringify(parsed, null, "\t")}\n`)
  return true
}

function createGitBashTransportId(pluginRoot: string): string {
  const digest = createHash("sha256").update(pluginRoot).digest("hex").slice(0, 16)
  return `git-bash-${digest}`
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
