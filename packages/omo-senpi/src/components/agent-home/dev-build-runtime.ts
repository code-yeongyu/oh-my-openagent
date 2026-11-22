import { spawnSync } from "node:child_process"
import { readFileSync, realpathSync, statSync } from "node:fs"
import { homedir, userInfo } from "node:os"
import { join, resolve } from "node:path"

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

function canonical(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

/**
 * Every home a released omo on this account may resolve its agent dir under: HOME, USERPROFILE and the OS account home
 * can differ (a Windows session launched without HOME uses %USERPROFILE%), so each one counts (#14622 review M2).
 * `os.homedir()` follows HOME on POSIX, so the account record's home is read too: an omob run under an alternate HOME
 * still sees the real account's store (#14622 review M4). It is read only when a source build is about to migrate.
 */
function accountHomes(env: NodeJS.ProcessEnv): readonly string[] {
  return [env.HOME, env.USERPROFILE, homedir(), passwdHome()].filter(
    (home): home is string => home !== undefined && home.length > 0,
  )
}

function passwdHome(): string | undefined {
  if (process.platform === "win32") return undefined
  // Node's userInfo() reads the passwd entry; Bun's follows HOME (and USER), so under Bun the record is asked for by uid.
  if (process.versions.bun === undefined) {
    try {
      return userInfo().homedir
    } catch {
      // No passwd entry for this uid (a container user): HOME and USERPROFILE still count.
      return undefined
    }
  }
  return process.platform === "darwin" ? directoryServicesHome() : getentHome()
}

function run(command: string, args: readonly string[]): string | undefined {
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true, timeout: 5_000 })
  return result.status === 0 ? result.stdout.trim() : undefined
}

function getentHome(): string | undefined {
  const uid = process.getuid?.()
  if (uid === undefined) return undefined
  // name:password:uid:gid:gecos:home:shell
  return (
    run("getent", ["passwd", String(uid)])
      ?.split("\n")[0]
      ?.split(":")[5] || undefined
  )
}

function directoryServicesHome(): string | undefined {
  const name = run("id", ["-un"])
  if (name === undefined || name.length === 0) return undefined
  // "NFSHomeDirectory: /Users/name"
  return (
    run("dscl", [".", "-read", `/Users/${name}`, "NFSHomeDirectory"])
      ?.split(": ")[1]
      ?.trim() || undefined
  )
}

/**
 * True when `agentDir` is one of the agent homes every released omo on this account shares (`resolveAgentHome`'s
 * defaults: `~/.omo/agent`, the flat `~/.omo`, `~/.senpi/agent`) under any of the account's home roots. An explicit
 * isolated dir is never shared.
 */
export function isSharedAgentDir(agentDir: string, homes: readonly string[] = accountHomes(process.env)): boolean {
  return homes.some((home) =>
    [join(home, ".omo", "agent"), join(home, ".omo"), join(home, ".senpi", "agent")].some((candidate) =>
      sameLocation(candidate, agentDir),
    ),
  )
}

/**
 * Two spellings name one store when the filesystem says so (#14622 review M3): an existing path is compared by its
 * device and inode, so a case-insensitive volume's `.OMO\agent` and `.omo\agent` match. A path that does not
 * exist yet falls back to its canonical spelling, case-folded where the platform's default volumes ignore case.
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
