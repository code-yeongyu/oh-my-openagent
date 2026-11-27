import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const BUNDLE_INPUTS = "packages/omo-senpi/bundle-inputs.json"
const SHIPPED_PATH = /plugin\/(?:extensions|runtime)\/|\.generated\.|\/install-dist\/|bundle-inputs\.json/
const GUARD_EXCLUDED_DIRS = ["script/fixtures/"]

type GitResult = { readonly ok: boolean; readonly out: string; readonly err: string }

function git(root: string, args: readonly string[]): GitResult {
  if (root.length === 0) throw new Error(`git ${args.join(" ")}: no repository root`)
  const result = Bun.spawnSync(["git", "-c", "core.hooksPath=/dev/null", "-c", "core.quotePath=false", ...args], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  })
  return { ok: result.exitCode === 0, out: result.stdout.toString(), err: result.stderr.toString().trim() }
}

function gitOut(root: string, args: readonly string[]): string {
  const result = git(root, args)
  if (!result.ok) throw new Error(`git ${args.join(" ")}: ${result.err}`)
  return result.out
}

function lines(text: string): string[] {
  return text.split("\n").filter((line) => line.length > 0)
}

export function deriveBundleGuards(root: string): string[] {
  const tracked = lines(gitOut(root, ["ls-files", "-z", "--", "script/"]).replaceAll("\0", "\n"))
  return tracked
    .filter((path) => path.endsWith(".test.ts"))
    .filter((path) => !GUARD_EXCLUDED_DIRS.some((dir) => path.startsWith(dir)))
    .filter((path) => existsSync(join(root, path)) && SHIPPED_PATH.test(readFileSync(join(root, path), "utf8")))
    .sort()
}

function bundleInputsAt(root: string, rev: string): Set<string> {
  gitOut(root, ["rev-parse", "--verify", "--end-of-options", `${rev}^{commit}`])
  const listed = gitOut(root, ["ls-tree", "--name-only", rev, "--", BUNDLE_INPUTS])
  if (listed.trim().length === 0) return new Set()
  const shown = { out: gitOut(root, ["show", `${rev}:${BUNDLE_INPUTS}`]) }
  const parsed: unknown = JSON.parse(shown.out)
  if (typeof parsed !== "object" || parsed === null || !("files" in parsed) || !Array.isArray(parsed.files)) {
    throw new Error(`${BUNDLE_INPUTS} at ${rev} has no files list`)
  }
  return new Set(parsed.files.filter((file): file is string => typeof file === "string"))
}

function bundlePathsTouched(root: string, base: string, head: string): string[] {
  const inputs = new Set([...bundleInputsAt(root, base), ...bundleInputsAt(root, head)])
  const diff = gitOut(root, ["diff", "--no-renames", "--name-only", `${base}...${head}`])
  return lines(diff).filter((path) => inputs.has(path) || SHIPPED_PATH.test(path))
}

function sandboxedEnv(home: string): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env, HOME: home, USERPROFILE: home }
  for (const name of ["XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME", "XDG_RUNTIME_DIR"]) {
    env[name] = join(home, name.toLowerCase())
    mkdirSync(join(home, name.toLowerCase()), { recursive: true, mode: 0o700 })
  }
  delete env.DBUS_SESSION_BUS_ADDRESS
  return env
}

function trackedChanges(root: string): string[] {
  return lines(gitOut(root, ["status", "--porcelain", "--untracked-files=no"])).map((line) => line.slice(3))
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
  const headSha = gitOut(root, ["rev-parse", "--verify", "--end-of-options", `${head}^{commit}`]).trim()
  const checkedOut = gitOut(root, ["rev-parse", "HEAD"]).trim()
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
  if (guards.length === 0)
    return {
      exitCode: 1,
      lines: [header, "BUNDLE_GUARDS_EMPTY no script test reads a shipped path; nothing checked this bundle change"],
    }
  const run = withScratchHome((home) =>
    Bun.spawnSync([process.execPath, "test", ...guards.map((guard) => `./${guard}`)], {
      cwd: root,
      env: sandboxedEnv(home),
      stdout: "pipe",
      stderr: "pipe",
    }),
  )
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
    const root = gitOut(process.cwd(), ["rev-parse", "--show-toplevel"]).trim()
    const verdict = runBundleGuards(root, args.base, args.head)
    for (const line of verdict.lines) (verdict.exitCode === 0 ? console.log : console.error)(line)
    process.exitCode = verdict.exitCode
  } catch (error) {
    console.error(`BUNDLE_GUARDS_ERROR ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}

export function withScratchHome<T>(work: (home: string) => T): T {
  const home = mkdtempSync(join(tmpdir(), "bundle-guards-home-"))
  try {
    return work(home)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}
