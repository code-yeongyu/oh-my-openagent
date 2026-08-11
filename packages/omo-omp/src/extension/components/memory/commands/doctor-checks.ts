// Deterministic /doctor checks. Every check is read-only except the skill
// frontmatter repair, which is the one documented auto-fix (letta parity).

import { existsSync } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
import { hostname } from "node:os"
import { join } from "node:path"

import { parseLockRecord, parseMemoryFile } from "@oh-my-opencode/memory-core"

import { runGit } from "./repo"
import { estimateSystemTokens } from "./tokens"
import { defaultIsProcessAlive, type MemoryCommandDeps, type MemoryCommandIdentity } from "./types"

export type CheckLevel = "ok" | "warn" | "fail"

export interface DoctorCheck {
  readonly name: string
  readonly level: CheckLevel
  readonly detail: string
}

const PERSONA_PATH = "system/persona.md"

async function listMarkdown(root: string, prefix: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(prefix === "" ? root : join(root, prefix), { withFileTypes: true })
  } catch {
    return []
  }
  const files: string[] = []
  for (const entry of entries) {
    if (entry.name === ".git" || (prefix === "" && entry.name === "skills")) continue
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) {
      files.push(...(await listMarkdown(root, relative)))
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(relative)
    }
  }
  return files
}

export function checkRepository(identity: MemoryCommandIdentity): DoctorCheck {
  if (!existsSync(join(identity.identityPaths.repo, ".git"))) {
    return {
      name: "repository",
      level: "fail",
      detail: `missing at ${identity.identityPaths.repo}; run /memfs init to create it`,
    }
  }
  return { name: "repository", level: "ok", detail: identity.identityPaths.repo }
}

export async function checkFrontmatter(repoDir: string): Promise<DoctorCheck[]> {
  const paths = await listMarkdown(repoDir, "")
  const failures: string[] = []
  for (const path of paths) {
    try {
      parseMemoryFile(await readFile(join(repoDir, path), "utf8"))
    } catch (error) {
      failures.push(`${path} (${error instanceof Error ? error.message : String(error)})`)
    }
  }

  const frontmatter: DoctorCheck = failures.length === 0
    ? { name: "frontmatter", level: "ok", detail: `${paths.length} memory file${paths.length === 1 ? "" : "s"} valid` }
    : {
        name: "frontmatter",
        level: "fail",
        detail: `${failures.length} invalid file${failures.length === 1 ? "" : "s"}: ${failures.join("; ")}; fix the frontmatter or remove the file`,
      }

  const persona: DoctorCheck = paths.includes(PERSONA_PATH)
    ? { name: "persona", level: "ok", detail: `${PERSONA_PATH} present` }
    : { name: "persona", level: "warn", detail: `${PERSONA_PATH} is missing; create it with /init or the memory tools` }

  return [frontmatter, persona]
}

export async function checkLocks(deps: MemoryCommandDeps, locksDir: string): Promise<DoctorCheck> {
  let entries: string[]
  try {
    entries = await readdir(locksDir)
  } catch {
    return { name: "locks", level: "ok", detail: "no lock directory yet" }
  }

  const isAlive = deps.isProcessAlive ?? defaultIsProcessAlive
  const stale: string[] = []
  for (const entry of entries.filter((name) => name.endsWith(".lock"))) {
    const path = join(locksDir, entry)
    const record = parseLockRecord(await readFile(path, "utf8").catch(() => ""))
    if (record === null) {
      stale.push(`${path} (unreadable lock record)`)
      continue
    }
    if (record.hostname !== hostname()) continue
    if (isAlive(record.pid)) continue
    stale.push(`${path} (pid ${record.pid} is not running)`)
  }

  if (stale.length === 0) return { name: "locks", level: "ok", detail: "no stale locks" }
  return {
    name: "locks",
    level: "warn",
    detail: `${stale.length} stale lock${stale.length === 1 ? "" : "s"}: ${stale.join("; ")}; delete the file after confirming no run is active`,
  }
}

export async function checkWorktrees(
  deps: MemoryCommandDeps,
  identity: MemoryCommandIdentity,
): Promise<DoctorCheck> {
  const { repo, worktrees } = identity.identityPaths
  if (!existsSync(join(repo, ".git"))) {
    return { name: "worktrees", level: "ok", detail: "no repository to inspect" }
  }

  const result = await runGit(deps, repo, ["worktree", "list", "--porcelain"])
  if (result.code !== 0) {
    return {
      name: "worktrees",
      level: "warn",
      detail: `could not list worktrees: ${result.stderr.trim() || `exit ${result.code}`}`,
    }
  }

  const registered = new Set(
    result.stdout
      .split(/\r?\n/)
      .filter((line) => line.startsWith("worktree "))
      .map((line) => line.slice("worktree ".length).trim()),
  )

  let entries: string[]
  try {
    entries = await readdir(worktrees)
  } catch {
    return { name: "worktrees", level: "ok", detail: "no reflection worktrees" }
  }

  const orphans = entries.map((entry) => join(worktrees, entry)).filter((path) => !registered.has(path))
  const missing = [...registered].filter((path) => path.startsWith(`${worktrees}/`) && !existsSync(path))

  const problems = [
    ...orphans.map((path) => `${path} (not registered with git)`),
    ...missing.map((path) => `${path} (registered but missing; run git worktree prune)`),
  ]
  if (problems.length === 0) return { name: "worktrees", level: "ok", detail: "no orphaned worktrees" }
  return {
    name: "worktrees",
    level: "warn",
    detail: `${problems.length} orphan${problems.length === 1 ? "" : "s"}: ${problems.join("; ")}`,
  }
}

export async function checkTokens(repoDir: string, warnTokens: number): Promise<DoctorCheck> {
  const estimate = await estimateSystemTokens(repoDir)
  if (estimate.totalTokens < warnTokens) {
    return {
      name: "tokens",
      level: "ok",
      detail: `~${estimate.totalTokens} tokens in system/ (warn at ${warnTokens})`,
    }
  }
  return {
    name: "tokens",
    level: "warn",
    detail: `~${estimate.totalTokens} tokens in system/ reached the ${warnTokens} warning threshold; trim system/ and move detail into external memory`,
  }
}
