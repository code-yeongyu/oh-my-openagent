import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

const BUNDLE_INPUTS = "packages/omo-senpi/bundle-inputs.json"
const SHIPPED_PATH = /plugin\/(?:extensions|runtime)\/|\.generated\.|\/install-dist\/|bundle-inputs\.json/
const GUARD_EXCLUDED_DIRS = ["script/fixtures/"]

type GitResult = { readonly ok: boolean; readonly out: string; readonly err: string }

function git(root: string, args: readonly string[]): GitResult {
  const result = Bun.spawnSync(["git", "-c", "core.hooksPath=/dev/null", "-c", "core.quotePath=false", ...args], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  })
  return { ok: result.exitCode === 0, out: result.stdout.toString(), err: result.stderr.toString().trim() }
}

function lines(text: string): string[] {
  return text.split("\n").filter((line) => line.length > 0)
}

export function deriveBundleGuards(root: string): string[] {
  const tracked = lines(git(root, ["ls-files", "-z", "--", "script/"]).out.replaceAll("\0", "\n"))
  return tracked
    .filter((path) => path.endsWith(".test.ts"))
    .filter((path) => !GUARD_EXCLUDED_DIRS.some((dir) => path.startsWith(dir)))
    .filter((path) => existsSync(join(root, path)) && SHIPPED_PATH.test(readFileSync(join(root, path), "utf8")))
    .sort()
}

function bundleInputsAt(root: string, rev: string): Set<string> {
  const shown = git(root, ["show", `${rev}:${BUNDLE_INPUTS}`])
  if (!shown.ok) return new Set()
  const parsed: unknown = JSON.parse(shown.out)
  if (typeof parsed !== "object" || parsed === null || !("files" in parsed) || !Array.isArray(parsed.files)) {
    throw new Error(`${BUNDLE_INPUTS} at ${rev} has no files list`)
  }
  return new Set(parsed.files.filter((file): file is string => typeof file === "string"))
}

function bundlePathsTouched(root: string, base: string, head: string): string[] {
  const diff = git(root, ["diff", "--no-renames", "--name-only", `${base}...${head}`])
  if (!diff.ok) throw new Error(`git diff ${base}...${head}: ${diff.err}`)
  const inputs = new Set([...bundleInputsAt(root, base), ...bundleInputsAt(root, head)])
  return lines(diff.out).filter((path) => inputs.has(path) || SHIPPED_PATH.test(path))
}

function trackedChanges(root: string): string[] {
  return lines(git(root, ["status", "--porcelain", "--untracked-files=no"]).out).map((line) => line.slice(3))
}

function failingTests(output: string): string[] {
  const failures: string[] = []
  let file = ""
  for (const line of output.split("\n")) {
    if (/^\d+ tests? failed:$/.test(line.trim())) break
    const header = /^(\S+\.test\.ts):$/.exec(line.trim())
    if (header?.[1]) file = header[1]
    const failed = /^\(fail\) (.+?)(?: \[[\d.]+m?s\])?$/.exec(line.trim())
    if (failed?.[1]) failures.push(`${file} > ${failed[1]}`)
  }
  return failures
}

type Verdict = { readonly exitCode: 0 | 1; readonly lines: readonly string[] }

function runBundleGuards(root: string, base: string, head: string): Verdict {
  const touched = bundlePathsTouched(root, base, head)
  if (touched.length === 0) {
    return {
      exitCode: 0,
      lines: [`BUNDLE_GUARDS_NOT_APPLICABLE ${base}...${head} touches no bundle input or generated path`],
    }
  }
  const headSha = git(root, ["rev-parse", "--verify", `${head}^{commit}`]).out.trim()
  const checkedOut = git(root, ["rev-parse", "HEAD"]).out.trim()
  const dirty = trackedChanges(root)
  if (headSha !== checkedOut || dirty.length > 0) {
    const why =
      headSha === checkedOut
        ? `tracked files differ from ${headSha}: ${dirty.join(" ")}`
        : `checkout is ${checkedOut}, not ${headSha}`
    return {
      exitCode: 1,
      lines: [
        `BUNDLE_GUARDS_DIRTY_TREE ${why}`,
        "the guards must read the pushed bytes; restore with git checkout -- <paths>",
      ],
    }
  }
  const guards = deriveBundleGuards(root)
  const header = `BUNDLE_GUARDS head=${headSha} touched=${touched.length} guards=${guards.length}`
  if (guards.length === 0) return { exitCode: 0, lines: [header, "BUNDLE_GUARDS_OK no guard reads a shipped path"] }
  const run = Bun.spawnSync([process.execPath, "test", ...guards.map((guard) => `./${guard}`)], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  })
  const output = `${run.stdout.toString()}${run.stderr.toString()}`
  if (run.exitCode === 0) return { exitCode: 0, lines: [header, `BUNDLE_GUARDS_OK ${guards.join(" ")}`] }
  const failures = failingTests(output)
  return {
    exitCode: 1,
    lines: [
      header,
      `BUNDLE_GUARDS_FAILED bun test exited ${run.exitCode}`,
      ...(failures.length > 0 ? failures : output.split("\n").slice(-40)),
    ],
  }
}

function parseArgs(argv: readonly string[]): { base: string; head: string } | undefined {
  let base = ""
  let head = "HEAD"
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (value === undefined) return undefined
    if (flag === "--base") base = value
    else if (flag === "--head") head = value
    else return undefined
  }
  return base.length > 0 ? { base, head } : undefined
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2))
  if (args === undefined) {
    console.error("usage: bun script/bundle-guards.ts --base <rev> [--head <rev>]")
    process.exit(2)
  }
  try {
    const root = git(process.cwd(), ["rev-parse", "--show-toplevel"]).out.trim()
    const verdict = runBundleGuards(root, args.base, args.head)
    for (const line of verdict.lines) (verdict.exitCode === 0 ? console.log : console.error)(line)
    process.exitCode = verdict.exitCode
  } catch (error) {
    console.error(`BUNDLE_GUARDS_ERROR ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
