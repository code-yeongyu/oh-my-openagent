import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"

// The generated outputs (#9903, #13192), read from the list next to this file. None is tracked: the build writes them and
// git ignores them.
const LIST_URL = new URL("./generated-bundles.json", import.meta.url)

export function loadGeneratedBundlePatterns(): readonly RegExp[] {
  const list: unknown = JSON.parse(readFileSync(LIST_URL, "utf8"))
  // The patterns use ECMAScript syntax such as (?:...), which POSIX tools read differently; tooling outside the
  // repository that reads this list checks the same field.
  const dialect = typeof list === "object" && list !== null && "dialect" in list ? list.dialect : undefined
  if (dialect !== "ecmascript")
    throw new Error(`generated-bundles.json: dialect must be "ecmascript", got ${JSON.stringify(dialect)}`)
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
