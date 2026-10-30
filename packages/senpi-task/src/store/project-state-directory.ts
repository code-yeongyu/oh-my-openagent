import { createHash } from "node:crypto"
import { existsSync, lstatSync, readdirSync, realpathSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, join, resolve } from "node:path"

export type ProjectStateName = "senpi-task" | "thread-tools"

type AgentDirEnv = Readonly<Record<string, string | undefined>>

export interface ProjectStateDirectoryOptions {
  readonly env?: AgentDirEnv
  readonly exists?: (path: string) => boolean
  readonly hasRecords?: (directory: string) => boolean
  readonly markAdopted?: (directory: string) => void
}

// Written into a legacy in-project store once it is seen holding records. Records can later be
// expunged, but the store must not move: sessions that already resolved it keep writing there.
export const IN_PROJECT_STORE_MARKER = ".in-project"

const AGENT_DIR_ENV_NAMES = ["OMO_CODING_AGENT_DIR", "SENPI_CODING_AGENT_DIR", "PI_CODING_AGENT_DIR"] as const

function agentDirectory(env: AgentDirEnv): string {
  for (const name of AGENT_DIR_ENV_NAMES) {
    const configured = env[name]?.trim()
    if (configured) return resolve(configured)
  }
  return join(env.HOME ?? env.USERPROFILE ?? homedir(), ".omo", "agent")
}

// Keyed by the real path: a project reached through a symlink (or macOS /var vs /private/var) must
// share one store, as its in-project `.omo` folder did.
function canonicalProjectPath(projectDir: string): string {
  const absolute = resolve(projectDir)
  try {
    return realpathSync.native(absolute)
  } catch (error) {
    if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")) return absolute
    throw error
  }
}

// Conservative on purpose: only a real directory whose subtree is truly empty reads as scaffolding.
// The store root being a symlink or a file, a symlink entry, or a subtree that fails to read for any
// reason other than "gone" is treated as holding records, so a migration probe never strands
// in-flight state. Artifact filenames also count when malformed into directories: ignoring them
// would turn a readable diagnostic into a missing record.
function holdsRecords(directory: string): boolean {
  try {
    if (!lstatSync(directory).isDirectory()) return true
  } catch (error) {
    if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")) return false
    return true
  }
  return subtreeHoldsRecords(directory)
}

function subtreeHoldsRecords(directory: string): boolean {
  try {
    return readdirSync(directory, { withFileTypes: true }).some((entry) =>
      entry.isDirectory() && !entry.name.includes(".") ? subtreeHoldsRecords(join(directory, entry.name)) : true,
    )
  } catch (error) {
    if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")) return false
    return true
  }
}

function markInProjectStoreAdopted(directory: string): void {
  try {
    writeFileSync(join(directory, IN_PROJECT_STORE_MARKER), "", { flag: "wx" })
  } catch {
    // Already marked, or a read-only legacy store: its records still select it on every probe.
  }
}

export function projectStateKey(projectDir: string): string {
  const absolute = canonicalProjectPath(projectDir)
  const hash = createHash("sha256").update(absolute).digest("hex").slice(0, 12)
  const name = basename(absolute).replace(/[^\p{L}\p{N}._-]/gu, "_") || "root"
  return `${name}-${hash}`
}

/**
 * Where omo keeps a project's runtime bookkeeping (task records, locks, team runtime, DAG runs, the
 * thread tools' mailbox): in the agent dir next to the sessions it belongs to, never inside the
 * project, so it never shows up in the user's `git status`. A state directory an earlier release
 * already created inside the project keeps being used when it holds a record, so in-flight tasks and
 * resumable DAG runs are not stranded by an upgrade, and is marked so it stays selected after its
 * records are expunged. A directory that never held a record is only scaffolding and is ignored.
 */
export function resolveProjectStateDirectory(
  projectDir: string,
  name: ProjectStateName,
  options: ProjectStateDirectoryOptions = {},
): string {
  const { env = process.env, exists = existsSync, hasRecords = holdsRecords, markAdopted = markInProjectStoreAdopted } =
    options
  const inProject = join(resolve(projectDir), ".omo", name)
  if (exists(inProject) && hasRecords(inProject)) {
    markAdopted(inProject)
    return inProject
  }
  return join(agentDirectory(env), "projects", projectStateKey(projectDir), name)
}
