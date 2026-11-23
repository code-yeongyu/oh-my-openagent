import { lstatSync, readFileSync, readlinkSync, realpathSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"

import { type PlatformFacts, systemPlatformFacts, userRecordHome } from "@oh-my-opencode/omo-opencode/account-home"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

/**
 * An omob dev build stamps `omoBuild` into the runtime payload's package.json and the launcher points OMO_PACKAGE_DIR at
 * that payload; release payloads carry no stamp. SENPI_BRAND also names the dev command, but the engine consumes and
 * scrubs it before any extension runs.
 */
export function isDevBuildRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  const packageDir = env.OMO_PACKAGE_DIR
  if (packageDir === undefined || packageDir.trim().length === 0) return false
  let manifest: unknown
  try {
    manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"))
  } catch {
    return false
  }
  if (!isRecord(manifest)) return false
  const stamp = manifest["omoBuild"]
  return isRecord(stamp) && typeof stamp["command"] === "string" && stamp["command"].length > 0
}

/** The canonical spelling of a path, symlinks resolved even where their target does not exist yet. */
function canonical(path: string, depth = 0): string {
  try {
    return realpathSync(path)
  } catch {
    const absolute = resolve(path)
    if (depth > 40) return absolute
    try {
      if (lstatSync(absolute).isSymbolicLink()) {
        return canonical(resolve(dirname(absolute), readlinkSync(absolute)), depth + 1)
      }
    } catch {
      // Nothing at this path: its parent decides where it would be created.
    }
    const parent = dirname(absolute)
    return parent === absolute ? absolute : join(canonical(parent, depth + 1), basename(absolute))
  }
}

/**
 * Every home a released omo on this account may resolve its agent dir under: HOME, USERPROFILE and the OS user record's
 * home can differ (a Windows session launched without HOME uses %USERPROFILE%), so each one counts (#14622 review M2).
 * The record's home is read from the OS account database, never from the environment (Bun's homedir() and userInfo()
 * follow HOME and USERPROFILE, review M4): the shared `userRecordHome` reads /etc/passwd by uid on Linux, Open Directory
 * through `id -P` on macOS (network directories included), and the SID's profile on Windows with System32 tools only.
 * Null when the record cannot be read: then no agent dir can be proven isolated. Read only when a source build is about
 * to migrate.
 */
function accountHomes(env: NodeJS.ProcessEnv, facts: PlatformFacts): readonly string[] | null {
  const record = userRecordHome(facts)
  if (record === undefined) return null
  return [env.HOME, env.USERPROFILE, homedir(), record].filter(
    (home): home is string => home !== undefined && home.length > 0,
  )
}

/**
 * True when `agentDir` may be one of the agent homes every released omo on this account shares (`resolveAgentHome`'s
 * defaults: `~/.omo/agent`, the flat `~/.omo`, `~/.senpi/agent`) under any of the account's home roots, or when
 any of `stores` maps it to the same path one of them uses: a `gateway/` linked into the release's (#14622 review M8), or
 * only its `gateway/gateway.sqlite` linked to the release database (review M9). With
 * the account's homes unknown (`null`) it answers true: a store that cannot be proven isolated is treated as shared.
 */
export function isSharedAgentDir(
  agentDir: string,
  options: {
    readonly homes?: readonly string[] | null
    readonly stores?: readonly ((agentDir: string) => string)[]
    readonly facts?: PlatformFacts
  } = {},
): boolean {
  const candidates = sharedAgentDirs(options)
  if (candidates === null) return true
  const stores = options.stores ?? []
  return candidates.some(
    (candidate) =>
      sameLocation(candidate, agentDir) || stores.some((store) => sameLocation(store(candidate), store(agentDir))),
  )
}

/**
 * True when `file`, a store file already opened (its path with links resolved), is the file `store` names under one
 * of the shared agent dirs, by filesystem identity (#14622 review M9): a shared store kept outside the default layout
 * (`~/.omo/agent/gateway/gateway.sqlite` linked to `/data/thread.sqlite`) is recognized by the file itself. Answers
 * true when the account's homes are unknown, as `isSharedAgentDir` does.
 */
export function isSharedStoreFile(
  file: string,
  store: (agentDir: string) => string,
  options: { readonly homes?: readonly string[] | null; readonly facts?: PlatformFacts } = {},
): boolean {
  const candidates = sharedAgentDirs(options)
  return candidates === null || candidates.some((candidate) => sameLocation(store(candidate), file))
}

/** The agent dirs every released omo on this account may use, under each of its homes; null when the homes are unknown. */
function sharedAgentDirs(options: {
  readonly homes?: readonly string[] | null
  readonly facts?: PlatformFacts
}): readonly string[] | null {
  const homes =
    options.homes === undefined ? accountHomes(process.env, options.facts ?? systemPlatformFacts) : options.homes
  if (homes === null) return null
  return homes.flatMap((home) => [join(home, ".omo", "agent"), join(home, ".omo"), join(home, ".senpi", "agent")])
}

/**
 * Two spellings name one store when the filesystem says so (#14622 review M3): an existing path is compared by its
 * device and inode, so a case-insensitive volume's `.OMO\agent` and `.omo\agent` match. A path that does not
 * exist yet falls back to its canonical spelling (symlinks resolved), case-folded where the platform's default volumes
 * ignore case.
 */
function sameLocation(left: string, right: string): boolean {
  const a = identity(left)
  const b = identity(right)
  if (a !== undefined && b !== undefined) return a === b
  const fold = (path: string) =>
    process.platform === "win32" || process.platform === "darwin" ? path.toLowerCase() : path
  return fold(canonical(left)) === fold(canonical(right))
}

function identity(path: string): string | undefined {
  try {
    const stat = statSync(path, { bigint: true })
    return `${stat.dev}:${stat.ino}`
  } catch {
    return undefined
  }
}
