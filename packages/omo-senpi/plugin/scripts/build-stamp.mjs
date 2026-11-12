import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

/**
 * The commit a checkout's plugin build was made from (#13232).
 *
 * The plugin bundles are build outputs that git does not track (#13192), so a local install keeps running the last
 * build after the checkout moves. `build-extension.mjs` writes this stamp beside the bundles after an in-tree build, and
 * the local launcher (`src/install/local-launcher.ts`) imports this module from the checkout to warn once when a plugin
 * build input changed since. Uncommitted edits are out of scope: the stamp compares commits only.
 *
 * Built-ins only, and no process is spawned unless the checkout's commit differs from the stamp.
 */
export const BUILD_STAMP_FILE = ".build-stamp"

const BUILD_INPUTS = "packages/omo-senpi/bundle-inputs.json"
const OBJECT_ID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/
const BUILD_COMMAND = "bun run build:senpi-plugin"

function readText(path) {
  try {
    return readFileSync(path, "utf8")
  } catch {
    return undefined
  }
}

/** The nearest directory at or above `start` that holds `.git` (a directory, or a worktree's `gitdir:` file). */
export function findCheckoutRoot(start) {
  let directory = resolve(start)
  for (;;) {
    if (existsSync(join(directory, ".git"))) return directory
    const parent = dirname(directory)
    if (parent === directory) return undefined
    directory = parent
  }
}

function gitDirectories(root) {
  const dotGit = join(root, ".git")
  let gitDir = dotGit
  try {
    if (statSync(dotGit).isFile()) {
      const pointer = readText(dotGit)?.match(/^gitdir:\s*(.+?)\s*$/m)?.[1]
      if (pointer === undefined) return undefined
      gitDir = resolve(root, pointer)
    }
  } catch {
    return undefined
  }
  const common = readText(join(gitDir, "commondir"))?.trim()
  return { gitDir, commonDir: common ? resolve(gitDir, common) : gitDir }
}

function packedRef(commonDir, ref) {
  for (const line of (readText(join(commonDir, "packed-refs")) ?? "").split("\n")) {
    const [id, name] = line.trim().split(" ")
    if (name === ref && id !== undefined && OBJECT_ID.test(id)) return id
  }
  return undefined
}

/**
 * The commit HEAD names, read from files only. Anything the reader does not fully understand (reftable storage, a
 * symbolic ref that points at another symbolic ref, a malformed file) is `undefined`, never a guess.
 */
export function readCheckoutHead(root) {
  const dirs = gitDirectories(root)
  if (dirs === undefined || existsSync(join(dirs.commonDir, "reftable"))) return undefined
  const head = readText(join(dirs.gitDir, "HEAD"))?.trim()
  if (head === undefined) return undefined
  if (OBJECT_ID.test(head)) return head
  const ref = head.match(/^ref: (refs\/\S+)$/)?.[1]
  if (ref === undefined) return undefined
  // Per-worktree refs live under the worktree's git dir; branches live in the common dir.
  for (const dir of [dirs.gitDir, dirs.commonDir]) {
    const loose = readText(join(dir, ref))?.trim()
    if (loose !== undefined) return OBJECT_ID.test(loose) ? loose : undefined
  }
  return packedRef(dirs.commonDir, ref)
}

/**
 * Writes the stamp after an in-tree build. A build into an output override (`OMO_SENPI_PLUGIN_OUTPUT`: the omo-ai
 * staging, a temporary root) is not a checkout build and writes none. When the checkout's commit cannot be read, an
 * older stamp is removed so it cannot vouch for this build.
 */
export function writeBuildStamp(pluginRoot, env = process.env) {
  if (env.OMO_SENPI_PLUGIN_OUTPUT !== undefined) return false
  const stampPath = join(pluginRoot, BUILD_STAMP_FILE)
  const root = findCheckoutRoot(pluginRoot)
  const commit = root === undefined ? undefined : readCheckoutHead(root)
  if (commit === undefined) {
    rmSync(stampPath, { force: true })
    return false
  }
  writeFileSync(stampPath, `${JSON.stringify({ version: 1, commit })}\n`)
  return true
}

function stampedCommit(pluginRoot) {
  try {
    const stamp = JSON.parse(readText(join(pluginRoot, BUILD_STAMP_FILE)) ?? "")
    return stamp?.version === 1 && typeof stamp.commit === "string" && OBJECT_ID.test(stamp.commit)
      ? stamp.commit
      : undefined
  } catch {
    return undefined
  }
}

function changedPaths(root, from, to) {
  const result = spawnSync("git", ["diff", "--name-only", "-z", "--no-renames", from, to], {
    cwd: root,
    encoding: "utf8",
    timeout: 10_000,
    windowsHide: true,
  })
  if (result.status !== 0 || typeof result.stdout !== "string") return undefined
  return result.stdout.split("\0").filter((path) => path.length > 0)
}

function isBuildInput(path, inputs) {
  if (path === BUILD_INPUTS) return true
  return inputs.files.has(path) || inputs.directories.some((directory) => path.startsWith(`${directory}/`))
}

function readBuildInputs(root) {
  try {
    const map = JSON.parse(readText(join(root, BUILD_INPUTS)) ?? "")
    if (!Array.isArray(map?.files)) return undefined
    return {
      files: new Set(map.files),
      directories: Array.isArray(map.directories) ? map.directories.map((entry) => entry.replace(/\/+$/, "")) : [],
    }
  } catch {
    return undefined
  }
}

/**
 * One line when the plugin build at `pluginRoot` predates a change to a plugin build input in its checkout, else
 * `undefined`. Silent when there is no checkout, no stamp, an unreadable HEAD, no input map, or git cannot compare the
 * two commits: the check only ever adds a warning, it never blocks or guesses.
 */
export function staleBuildWarning(pluginRoot) {
  const stamped = stampedCommit(pluginRoot)
  if (stamped === undefined) return undefined
  const root = findCheckoutRoot(pluginRoot)
  if (root === undefined) return undefined
  const head = readCheckoutHead(root)
  if (head === undefined || head === stamped) return undefined
  const inputs = readBuildInputs(root)
  const changed = inputs === undefined ? undefined : changedPaths(root, stamped, head)
  if (changed === undefined || !changed.some((path) => isBuildInput(path, inputs))) return undefined
  return `omo: the plugin build at ${pluginRoot} predates this checkout's plugin sources (built from ${stamped.slice(0, 12)}, checkout at ${head.slice(0, 12)}); run \`${BUILD_COMMAND}\` in that checkout`
}
