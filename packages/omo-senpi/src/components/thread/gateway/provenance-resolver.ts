import { execFile } from "node:child_process"
import { existsSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"

import type { OmoProvenanceSettings } from "@oh-my-opencode/omo-config-core"
import type { Provenance } from "./types"

export type ProvenanceWorkspaces = NonNullable<OmoProvenanceSettings["workspaces"]>

export type ProvenanceRuntime = {
  readonly cwd: string
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly workspaces?: ProvenanceWorkspaces
  /**
   * Reads the sender's `provenance.workspaces` table when none is given. Injected rather than imported: the config
   * loader carries the schema library, which the standalone thread SDK build must not inline.
   */
  readonly loadWorkspaces?: (cwd: string, env: Readonly<Record<string, string | undefined>>) => ProvenanceWorkspaces
  /** Where a degraded classification is reported (git or the config table failed); the send itself goes on. */
  readonly onWarning?: (message: string) => void
  /** A runtime IO seam, not an agent/tool argument. When given, it replaces the whole git probe, so `execGit` and `readGitFile` are not used. */
  readonly gitRemote?: (cwd: string) => Promise<string | undefined>
  /** Runtime IO seams for the git probe, so every failure class is exercised the same way on every platform. */
  readonly execGit?: ExecGit
  readonly readGitFile?: (path: string) => string
}

/** One git run: its stdout, or how it failed (an exit code, ENOENT for a missing binary, or killed by the timeout). */
export type GitRun =
  | { readonly ok: true; readonly stdout: string }
  | { readonly ok: false; readonly code: number | string | null; readonly killed: boolean; readonly stderr: string; readonly message: string }
export type ExecGit = (args: readonly string[], options: { readonly cwd: string; readonly env: Readonly<Record<string, string | undefined>>; readonly timeoutMs: number }) => Promise<GitRun>

const GIT_ORIGIN_TIMEOUT_MS = 1_000

const execGitFile: ExecGit = (args, options) => new Promise((done) => {
  execFile("git", [...args], { cwd: options.cwd, env: options.env, encoding: "utf8", windowsHide: true, timeout: options.timeoutMs }, (error, stdout, stderr) => {
    if (error === null) return done({ ok: true, stdout })
    done({ ok: false, code: error.code ?? null, killed: error.killed === true, stderr, message: error.message })
  })
})

/** A `.git` directory, or a worktree `.git` file whose `gitdir:` target still exists (a pruned worktree leaves a dangling one). */
function liveGitEntry(dir: string, readGitFile: (path: string) => string): boolean {
  const entry = join(dir, ".git")
  if (!existsSync(entry)) return false
  if (statSync(entry).isDirectory()) return true
  const target = /^gitdir:\s*(.+?)\s*$/m.exec(readGitFile(entry))?.[1]
  return target !== undefined && existsSync(resolve(dir, target))
}

/**
 * Structural, locale-independent: a repository is an explicit GIT_DIR or a live `.git` entry above the cwd. The walk
 * stops below the sender's GIT_CEILING_DIRECTORIES, as git's own discovery does.
 */
function insideRepository(cwd: string, env: Readonly<Record<string, string | undefined>>, warn: (message: string) => void, readGitFile: (path: string) => string): boolean {
  if (env.GIT_DIR) return true
  const ceilings = new Set((env.GIT_CEILING_DIRECTORIES ?? "").split(delimiter).filter((path) => isAbsolute(path)).map((path) => resolve(path)))
  try {
    for (let dir = resolve(cwd); ; dir = dirname(dir)) {
      if (liveGitEntry(dir, readGitFile)) return true
      if (dirname(dir) === dir || ceilings.has(dirname(dir))) return false
    }
  } catch (error) {
    warn(`finding the sender's repository failed, so git does not classify this send: ${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}

// The sender's own environment drives git (URL rewrites, GIT_CONFIG_*), so the origin is read the way the sender sees it.
// "No repository" and "no origin" are decided from structure and git's exit code (2: no such remote), never from its
// message text, which a translated git prints in the sender's language. Provenance is metadata on the message, so any
// other git failure (a refused ownership check, a broken config, the timeout) is reported and the sender is
// classified without git: it never fails the send.
async function originRemote(cwd: string, env: Readonly<Record<string, string | undefined>>, warn: (message: string) => void, runtime: ProvenanceRuntime): Promise<string | undefined> {
  if (!insideRepository(cwd, env, warn, runtime.readGitFile ?? ((path) => readFileSync(path, "utf8")))) return undefined
  const run = await (runtime.execGit ?? execGitFile)(["remote", "get-url", "origin"], { cwd, env, timeoutMs: GIT_ORIGIN_TIMEOUT_MS })
  if (run.ok) return run.stdout.trim()
  if (run.code === "ENOENT") warn("git is not installed for the sender, so git does not classify this send")
  else if (run.killed) warn(`reading the sender's git origin failed, so git does not classify this send: git did not answer within ${GIT_ORIGIN_TIMEOUT_MS} ms`)
  else if (run.code !== 2) warn(`reading the sender's git origin failed, so git does not classify this send: ${run.stderr.trim() || run.message}`)
  return undefined
}

/** Parse only the path of a network remote: credentials and host identities never become labels. */
function repository(remote: string | undefined): { readonly owners: readonly string[]; readonly project: string } | undefined {
  if (remote === undefined) return undefined
  const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(remote) ? URL.parse(remote) : null
  const scp = url !== null || /^[a-z]:[\\/]/i.test(remote) ? undefined : /^(?:[^/@:]+@)?[^/:]+:(.+)$/.exec(remote)?.[1]
  const path = url?.pathname ?? scp ?? remote
  const parts = path.replace(/\\/g, "/").replace(/\/+$/, "").split("/").filter(Boolean)
  const project = parts?.at(-1)?.replace(/\.git$/, "")
  // Every parent segment of a network remote is a candidate owner: a GitLab subgroup path `group/sub/project` matches
  // a `git_owners` entry of either `group` or `sub`. The first matching row in table order wins, so list the more
  // specific workspace first.
  const owners = (url !== null && url.protocol !== "file:") || scp !== undefined ? parts.slice(0, -1) : []
  return project ? { owners, project } : undefined
}

function contains(cwd: string, prefix: string, home: string): boolean {
  const expanded = prefix === "~" ? home : prefix.startsWith("~/") ? resolve(home, prefix.slice(2)) : prefix
  if (!isAbsolute(expanded)) return false
  const child = relative(resolve(expanded), resolve(cwd))
  return child === "" || (!isAbsolute(child) && child !== ".." && !child.startsWith(`..${sep}`))
}

function loadTable(runtime: ProvenanceRuntime, env: Readonly<Record<string, string | undefined>>, warn: (message: string) => void): ProvenanceWorkspaces {
  try {
    return runtime.loadWorkspaces?.(runtime.cwd, env) ?? []
  } catch (error) {
    warn(`reading provenance.workspaces failed, so the table does not classify this send: ${error instanceof Error ? error.message : String(error)}`)
    return []
  }
}

/** Called in the sender runtime; the receiver renders only the provenance saved in the envelope. */
export async function resolveProvenance(runtime: ProvenanceRuntime): Promise<Provenance> {
  const env = runtime.env ?? process.env
  const explicitWorkspace = env.OMO_PROVENANCE_WORKSPACE?.trim()
  const explicitProject = env.OMO_PROVENANCE_PROJECT?.trim()
  const lane = env.OMO_PROVENANCE_LANE?.trim()
  const extra = lane ? { lane } : {}
  if (explicitWorkspace && explicitProject) return { workspace: explicitWorkspace, project: explicitProject, ...extra }
  const warn = runtime.onWarning ?? (() => {})
  const repo = repository(await (runtime.gitRemote ?? ((cwd: string) => originRemote(cwd, env, warn, runtime)))(runtime.cwd))
  const project = explicitProject || repo?.project || basename(resolve(runtime.cwd)) || "root"
  if (explicitWorkspace) return { workspace: explicitWorkspace, project, ...extra }
  const table = runtime.workspaces ?? loadTable(runtime, env, warn)
  const owners = new Set(repo?.owners.map((owner) => owner.toLowerCase()) ?? [])
  const byOwner = owners.size === 0 ? undefined : table.find((row) => row.git_owners?.some((candidate) => owners.has(candidate.toLowerCase())))
  const home = env.HOME ?? env.USERPROFILE ?? homedir()
  const workspace = byOwner ?? table.find((row) => row.paths?.some((prefix) => contains(runtime.cwd, prefix, home)))
  return { workspace: workspace?.name ?? "unclassified", project, ...extra }
}
