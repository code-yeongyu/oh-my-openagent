// @ts-check
import { existsSync, readdirSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { finding } from "./diagnostics-findings.js"

/** @typedef {Readonly<Record<string, string | undefined>>} Env */
/** @typedef {{ durable: number, transient: number, runs: number }} IdentityCounts */

// Mirrors memory-core's layout: OMO_MEMORY_HOME (relative to cwd) else ~/.omo/memory, identities
// under agents/<id>, one-shot run roots under transient-runs/<token>.
const MEMORY_ROOT_ENV_VAR = "OMO_MEMORY_HOME"
const MEMORY_AGENTS_DIRNAME = "agents"
const MEMORY_TRANSIENT_DIRNAME = "transient-runs"
const MEMORY_REPO_DIRNAME = "repo"

/** @param {Env} env */
function memoryRoot(env) {
  const override = env[MEMORY_ROOT_ENV_VAR]
  if (override === undefined || override.trim() === "") return join(homedir(), ".omo", "memory")
  return resolve(process.cwd(), override)
}

// An unreadable or absent directory is `undefined`, never an empty list: the report must stay
// silent on a machine without memory instead of inventing zeros.
/** @param {string} path */
function listSubdirectories(path) {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => join(path, entry.name))
  } catch {
    return undefined
  }
}

/**
 * A memory identity is durable exactly when it owns a `repo/`; everything else under the agents
 * root is runtime scratch a one-shot run left behind (#7765). The count is what makes an
 * unbounded pile visible before it slows every guarded tool call.
 * @param {{
 *   agentsRoot: string,
 *   transientRoot: string,
 *   listDirs: (path: string) => string[] | undefined,
 *   hasRepo: (identityRoot: string) => boolean,
 * }} input
 * @returns {IdentityCounts | undefined}
 */
export function countTransientMemoryIdentities(input) {
  const identities = input.listDirs(input.agentsRoot)
  const runs = input.listDirs(input.transientRoot)
  if (identities === undefined && runs === undefined) return undefined
  let durable = 0
  let transient = 0
  for (const identity of identities ?? []) {
    if (input.hasRepo(identity)) durable += 1
    else transient += 1
  }
  return { durable, transient, runs: (runs ?? []).length }
}

/** @param {IdentityCounts | undefined} counts */
export function transientMemoryFindings(counts) {
  if (counts === undefined) return []
  return [
    finding(
      "memory.identities",
      "notice",
      `memory identities: ${counts.durable} durable, ${counts.transient} transient (no repo/); transient run roots: ${counts.runs}`,
      counts,
    ),
  ]
}

/**
 * @param {{
 *   env?: Env,
 *   listDirs?: (path: string) => string[] | undefined,
 *   hasRepo?: (identityRoot: string) => boolean,
 * }} ports
 */
export function memoryIdentityFindings(ports) {
  const root = memoryRoot(ports.env ?? process.env)
  return transientMemoryFindings(
    countTransientMemoryIdentities({
      agentsRoot: join(root, MEMORY_AGENTS_DIRNAME),
      transientRoot: join(root, MEMORY_TRANSIENT_DIRNAME),
      listDirs: ports.listDirs ?? listSubdirectories,
      hasRepo: ports.hasRepo ?? ((identityRoot) => existsSync(join(identityRoot, MEMORY_REPO_DIRNAME))),
    }),
  )
}
