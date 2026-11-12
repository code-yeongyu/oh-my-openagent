import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"

// The generated outputs that only the release commit may change (#9903), read from the list next to this file. The
// PR gate runs the BASE branch's copy of this module, so a PR cannot shorten the list that judges it.
const LIST_URL = new URL("./generated-bundles.json", import.meta.url)

export function loadGeneratedBundlePatterns(): readonly RegExp[] {
  const list: unknown = JSON.parse(readFileSync(LIST_URL, "utf8"))
  const patterns = typeof list === "object" && list !== null && "patterns" in list ? list.patterns : undefined
  if (!Array.isArray(patterns) || patterns.length === 0) throw new Error("generated-bundles.json has no patterns")
  return patterns.map((pattern) => {
    if (typeof pattern !== "string" || !pattern.startsWith("^") || !pattern.endsWith("$"))
      throw new Error(
        `generated-bundles.json: every pattern must be an anchored string, got ${JSON.stringify(pattern)}`,
      )
    return new RegExp(pattern)
  })
}

export function isGeneratedBundlePath(path: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(path))
}

export function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
}

export function nulSeparated(output: string): string[] {
  return output.split("\0").filter((entry) => entry.length > 0)
}
