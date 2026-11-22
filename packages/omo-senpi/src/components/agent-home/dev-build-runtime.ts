import { readFileSync, realpathSync } from "node:fs"
import { homedir } from "node:os"
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
 * True when `agentDir` is one of the agent homes every released omo on this account shares (`resolveAgentHome`'s
 * defaults: `~/.omo/agent`, the flat `~/.omo`, `~/.senpi/agent`). An explicit isolated dir is never shared.
 */
export function isSharedAgentDir(
  agentDir: string,
  home: string = process.env.HOME || process.env.USERPROFILE || homedir(),
): boolean {
  const target = canonical(agentDir)
  return [join(home, ".omo", "agent"), join(home, ".omo"), join(home, ".senpi", "agent")].some(
    (candidate) => canonical(candidate) === target,
  )
}
