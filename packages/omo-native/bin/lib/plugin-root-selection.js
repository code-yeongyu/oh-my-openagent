import { dirname } from "node:path"
import { resolvePluginRoot } from "./plugin-root.js"

/**
 * @param {string} installedPluginRoot
 * @param {string} cacheRoot
 * @param {Parameters<typeof resolvePluginRoot>[2] & { warn?: (line: string) => void }} [io]
 * @returns {() => { root: string, warning?: string }}
 */
export function createPluginRootSelection(installedPluginRoot, cacheRoot, io = {}) {
  /** @type {{ root: string, warning?: string } | undefined} */
  let selection
  return () => {
    if (selection !== undefined) return selection
    try {
      selection = { root: resolvePluginRoot(installedPluginRoot, cacheRoot, io) }
    } catch (error) {
      const reason = (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, " ")
      const agentDir = dirname(cacheRoot)
      const warning = `WARN launch spec: private plugin copy refused: ${reason}; continuing from the shared install, whose launch spec task and team hosts may still refuse. For writable agent directories, run: chmod 700 ${dirname(agentDir)} ${agentDir}; otherwise reinstall omo with a user-owned npm prefix. Run omo doctor for diagnostics.`
      selection = { root: installedPluginRoot, warning }
      ;(io.warn ?? console.error)(warning)
    }
    return selection
  }
}
