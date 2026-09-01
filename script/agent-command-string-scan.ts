/// <reference types="bun-types" />

import { existsSync, readFileSync, statSync } from "node:fs"
import { resolve } from "node:path"

export const AGENT_COMMAND_RE = /\bomo (ulw-loop|boulder)\b/g
export const HUMAN_COMMAND_RE = /\bomo (install|uninstall|cleanup|doctor|run|get-local-version|version|mcp)\b/g
export const BARE_BIN_RE = /(command -v omo|\/bin\/omo|=omo|\$\(which omo\))(?![\w-])/g

export const ALLOWLIST_RELATIVE_PATH = "script/agent-command-string-audit.allowlist.json"
export const AUDIT_TEST_RELATIVE_PATH = "script/agent-command-string-audit.test.ts"
export const SCAN_MODULE_RELATIVE_PATH = "script/agent-command-string-scan.ts"
export const SCAN_TEST_RELATIVE_PATH = "script/agent-command-string-scan.test.ts"

export function isExcluded(filePath: string): boolean {
  return filePath === ALLOWLIST_RELATIVE_PATH
    || filePath === AUDIT_TEST_RELATIVE_PATH
    || filePath === SCAN_MODULE_RELATIVE_PATH
    || filePath === SCAN_TEST_RELATIVE_PATH
    || filePath === "CHANGELOG.md"
    || filePath.endsWith("/CHANGELOG.md")
    || filePath === ".omo"
    || filePath.startsWith(".omo/")
    || filePath.split("/").some((part) => part === "node_modules" || part === "install-dist" || part === "dist")
}

/**
 * Occurrence fingerprint for one tracked file.
 *
 * Deliberately line-number-free: a release version stamp or a doc edit shifts every line below it, and a
 * line-pinned fingerprint turns that shift into a red release gate. The count keeps the audit sensitive to
 * a NEW legacy command occurrence inside an already-allowlisted file.
 */
export function fingerprintSource(filePath: string, source: string): string[] {
  const counts = new Map<string, number>()
  for (const line of source.split("\n")) {
    for (const pattern of [AGENT_COMMAND_RE, HUMAN_COMMAND_RE, BARE_BIN_RE]) {
      for (const match of line.matchAll(pattern)) {
        const key = `${filePath}: ${match[0]}`
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
    }
  }
  return [...counts.entries()].map(([key, count]) => (count === 1 ? key : `${key} x${count}`))
}

export function trackedSourceFiles(workspaceRoot: string): string[] {
  const result = Bun.spawnSync(["git", "ls-files", "-z"], { cwd: workspaceRoot, stdout: "pipe", stderr: "pipe" })
  if (result.exitCode !== 0) {
    throw new Error(`git ls-files failed: ${result.stderr.toString("utf8")}`)
  }
  return result.stdout.toString("utf8").split("\0").filter((filePath) => {
    if (!filePath || isExcluded(filePath)) {
      return false
    }
    const absolutePath = resolve(workspaceRoot, filePath)
    return existsSync(absolutePath) && statSync(absolutePath).isFile()
  })
}

export function collectHits(workspaceRoot: string): string[] {
  return trackedSourceFiles(workspaceRoot)
    .flatMap((filePath) => fingerprintSource(filePath, readFileSync(resolve(workspaceRoot, filePath), "utf8")))
    .sort()
}
