import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"

// The generated outputs that only the release commit may change (#9903), read from the list next to this file. The
// PR gate runs the BASE branch's copy of this module, so a PR's edit to the list does not judge that PR.
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

// The generators whose outputs the list names: the ones the release job runs. script/build-generated.ts runs exactly
// these, and the list test builds through them. `fixedOutputs` names the files of a generator that has no output
// override, so the list test can account for them without writing into the tree.
export const RELEASE_GENERATORS: readonly {
  readonly script: string
  readonly runtime: "node" | "bun"
  readonly fixedOutputs?: readonly string[]
}[] = [
  { script: "packages/omo-senpi/plugin/scripts/build-extension.mjs", runtime: "node" },
  { script: "script/build-codex-install.ts", runtime: "bun" },
  {
    script: "script/build-service-auth.ts",
    runtime: "bun",
    fixedOutputs: ["packages/omo-native/bin/lib/service-auth.generated.js"],
  },
]

export function isGeneratedBundlePath(path: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(path))
}

export function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
}

export function nulSeparated(output: string): string[] {
  return output.split("\0").filter((entry) => entry.length > 0)
}
