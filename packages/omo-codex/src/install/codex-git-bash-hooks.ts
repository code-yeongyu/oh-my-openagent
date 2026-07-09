import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { isPlainRecord } from "./codex-cache-fs"
import type { CodexInstallPlatform } from "./types"

const WINDOWS_ONLY_GIT_BASH_HOOKS = new Set([
  "./hooks/pre-tool-use-recommending-git-bash-mcp.json",
  "./hooks/post-compact-resetting-git-bash-mcp-reminder.json",
])

export async function removeGitBashHooksOffWindows(input: {
  readonly platform: CodexInstallPlatform
  readonly pluginRoot: string
}): Promise<void> {
  if (input.platform === "win32") return

  const manifestPath = join(input.pluginRoot, ".codex-plugin", "plugin.json")
  const parsed: unknown = JSON.parse(await readFile(manifestPath, "utf8"))
  if (!isPlainRecord(parsed) || !Array.isArray(parsed.hooks)) return

  const hooks = parsed.hooks.filter((hook) => typeof hook !== "string" || !WINDOWS_ONLY_GIT_BASH_HOOKS.has(hook))
  if (hooks.length === parsed.hooks.length) return

  await writeFile(manifestPath, `${JSON.stringify({ ...parsed, hooks }, null, "\t")}\n`)
}
