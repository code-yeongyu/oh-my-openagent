import { execFileSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, posix } from "node:path"
import { type ParseError, parse } from "jsonc-parser"

// knip's configuration, composed from knip.base.jsonc (global keys) and one knip.workspace.jsonc per directory that owns
// part of it, so two PRs for two packages never edit the same file (omo#13200). knip loads knip.ts under Node (jiti), and
// the knip-* tests import this under Bun, so only node: APIs and jsonc-parser are used here.

const BASE_FILE = "knip.base.jsonc"
export const FRAGMENT_FILE = "knip.workspace.jsonc"
// knip looks for these before knip.ts, so under `knip:check` a leftover one (say, from rebasing an older PR) is what knip
// loads and this check never runs there (knip then reports knip.ts itself as unused and fails). It runs wherever this
// module composes the config - script/knip-run.ts knipConfig() in the knip-* tests - and names the file to fold.
const SHADOWING_CONFIGS = ["knip.json", "knip.jsonc", ".knip.json", ".knip.jsonc"]
// Root-workspace keys whose values are paths or globs; the rest (dependency and binary names, flags) stay in ./knip.workspace.jsonc.
export const PATH_KEYS: ReadonlySet<string> = new Set(["entry", "project", "ignore", "ignoreFiles"])
const SKIPPED_DIRS: ReadonlySet<string> = new Set(["node_modules", ".git"])

export type JsonObject = { [key: string]: unknown }
export const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export class KnipConfigError extends Error {
  constructor(
    readonly file: string,
    readonly detail: string,
  ) {
    super(`${file}: ${detail}`)
    this.name = "KnipConfigError"
  }
}

export const readJsonc = (root: string, file: string): JsonObject => {
  const errors: ParseError[] = []
  const value: unknown = parse(readFileSync(join(root, file), "utf8"), errors, { allowTrailingComma: true })
  if (errors.length > 0) throw new KnipConfigError(file, `not valid JSONC (${errors.length} parse errors)`)
  if (!isObject(value)) throw new KnipConfigError(file, "is not an object")
  return value
}

// In a checkout: tracked plus untracked-but-not-gitignored fragments (what knip itself can see). The knip probe tests run
// knip in a plain copy holding exactly those files and no .git (script/knip-run.ts copyRepo), so there the copy is walked,
// never its dependency links. Sorted POSIX paths (code-unit order on every platform): a fixed merge order.
export const fragmentDirs = (root: string): string[] => {
  if (existsSync(join(root, ".git")))
    return execFileSync(
      "git",
      ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", `*${FRAGMENT_FILE}`],
      {
        cwd: root,
      },
    )
      .toString("utf8")
      .split("\0")
      .filter((file) => posix.basename(file) === FRAGMENT_FILE)
      .map((file) => posix.dirname(file))
      .sort()
  const found: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      if (entry.isFile() && entry.name === FRAGMENT_FILE) found.push(dir)
      else if (entry.isDirectory() && !SKIPPED_DIRS.has(entry.name))
        walk(dir === "." ? entry.name : `${dir}/${entry.name}`)
    }
  }
  walk(".")
  return found.sort()
}

// The one directory whose fragment must hold a root-workspace pattern or a pre-existing export row: the deepest directory
// with a fragment that the pattern's fixed leading directories lie in (every workspace has one, and any subtree may add
// its own, e.g. script/qa/computer), else its crates/<name> or packages/<name> unit, else its top-level directory, else
// the root (a pattern with no fixed leading directory, such as "**/*.test.ts").
const ownerOf = (root: string, fragmentDirs: readonly string[], pattern: string): string => {
  const literal = pattern.split(/[*?{[!(]/)[0] ?? ""
  let deepest = ""
  for (const dir of fragmentDirs)
    if (dir !== "." && literal.startsWith(`${dir}/`) && dir.length > deepest.length) deepest = dir
  if (deepest) return deepest
  const unit = /^(?:crates|packages)\/[^/]+(?=\/)/.exec(literal)
  if (unit) return unit[0]
  const top = literal.split("/")[0] ?? ""
  return literal.includes("/") && top && statSync(join(root, top), { throwIfNoEntry: false })?.isDirectory() ? top : "."
}

const mergeInto = (file: string, path: string, into: JsonObject, from: JsonObject): void => {
  for (const [key, value] of Object.entries(from)) {
    const existing = into[key]
    const at = `${path} / ${key}`
    if (existing === undefined) into[key] = Array.isArray(value) ? [...value] : isObject(value) ? { ...value } : value
    else if (Array.isArray(existing) && Array.isArray(value))
      for (const item of value) {
        if (existing.includes(item)) throw new KnipConfigError(file, `${at} repeats ${JSON.stringify(item)}`)
        existing.push(item)
      }
    else if (isObject(existing) && isObject(value)) mergeInto(file, at, existing, value)
    else throw new KnipConfigError(file, `${at} is already set by another fragment`)
  }
}

type Fragment = {
  readonly dir: string
  readonly file: string
  readonly workspaces: JsonObject
  readonly rows: JsonObject
}

const readFragment = (root: string, dir: string): Fragment => {
  const file = posix.join(dir, FRAGMENT_FILE)
  const fragment = readJsonc(root, file)
  for (const key of Object.keys(fragment))
    if (key !== "workspaces" && key !== "preExistingExports") throw new KnipConfigError(file, `unknown key "${key}"`)
  const workspaces = fragment["workspaces"] ?? {}
  const rows = fragment["preExistingExports"] ?? {}
  if (!isObject(workspaces)) throw new KnipConfigError(file, `"workspaces" is not an object`)
  if (!isObject(rows)) throw new KnipConfigError(file, `"preExistingExports" is not an object`)
  return { dir, file, workspaces, rows }
}

const checkPlacement = (root: string, fragmentDirs: readonly string[], fragment: Fragment): void => {
  const { dir, file } = fragment
  const misplaced = (value: string, owner: string) =>
    new KnipConfigError(file, `${JSON.stringify(value)} belongs in ${posix.join(owner, FRAGMENT_FILE)}`)
  for (const [workspace, config] of Object.entries(fragment.workspaces)) {
    if (!isObject(config)) throw new KnipConfigError(file, `workspace "${workspace}" is not an object`)
    if (workspace !== "." && workspace !== dir) throw misplaced(workspace, workspace)
    if (workspace === ".")
      for (const [key, value] of Object.entries(config))
        if (PATH_KEYS.has(key) && Array.isArray(value))
          for (const item of value)
            if (typeof item === "string" && ownerOf(root, fragmentDirs, item) !== dir)
              throw misplaced(item, ownerOf(root, fragmentDirs, item))
  }
  for (const path of Object.keys(fragment.rows))
    if (ownerOf(root, fragmentDirs, path) !== dir) throw misplaced(path, ownerOf(root, fragmentDirs, path))
}

export const composeKnipConfig = (root: string): JsonObject => {
  for (const name of SHADOWING_CONFIGS)
    if (existsSync(join(root, name)))
      throw new KnipConfigError(
        name,
        `knip reads it before knip.ts: move its content into ${BASE_FILE} and ${FRAGMENT_FILE} files`,
      )
  const config = readJsonc(root, BASE_FILE)
  if ("workspaces" in config) throw new KnipConfigError(BASE_FILE, `"workspaces" belongs in ${FRAGMENT_FILE} files`)
  const options = isObject(config["preprocessorOptions"]) ? config["preprocessorOptions"] : {}
  if ("preExistingExports" in options)
    throw new KnipConfigError(BASE_FILE, `"preExistingExports" belongs in ${FRAGMENT_FILE} files`)
  const fragments = fragmentDirs(root).map((dir) => readFragment(root, dir))
  const dirs = fragments.map((fragment) => fragment.dir)
  const workspaces: JsonObject = {}
  const rows: JsonObject = {}
  for (const fragment of fragments) {
    checkPlacement(root, dirs, fragment)
    mergeInto(fragment.file, "workspaces", workspaces, fragment.workspaces)
    mergeInto(fragment.file, "preExistingExports", rows, fragment.rows)
  }
  return { ...config, preprocessorOptions: { ...options, preExistingExports: rows }, workspaces }
}
