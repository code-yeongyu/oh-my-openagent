// Deterministic /doctor checks. Every check is read-only except the skill
// frontmatter repair, which is the one documented auto-fix (letta parity).

import { createHash } from "node:crypto"
import { existsSync } from "@oh-my-opencode/memory-core/fs"
import { readdir, readFile } from "@oh-my-opencode/memory-core/fs"
import { hostname } from "node:os"
import { join } from "node:path"

import { V1_PERSONA_SEED_SHA256, parseLockRecord, parseMemoryFile } from "@oh-my-opencode/memory-core"

import { readReflectionHealth, reflectionRemediation } from "../worker"
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

/**
 * v1 persona detection (advisory only, never an auto-rewrite): fires when
 * system/persona.md is byte-identical to the v1 seed, meaning the repo never
 * received the v2 soul seed.
 */
export async function checkSoulSeed(repoDir: string): Promise<DoctorCheck> {
  let content: Buffer
  try {
    content = await readFile(join(repoDir, PERSONA_PATH))
  } catch {
    return { name: "soul-seed", level: "ok", detail: "no persona file to compare" }
  }
  const hash = createHash("sha256").update(content).digest("hex")
  if (hash === V1_PERSONA_SEED_SHA256) {
    return {
      name: "soul-seed",
      level: "warn",
      detail: `${PERSONA_PATH} is still the v1 seed; review it against the v2 soul seed and rewrite it with the memory tools when ready`,
    }
  }
  return { name: "soul-seed", level: "ok", detail: "persona differs from the v1 seed" }
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

export async function checkAbandonedRuns(reflectionDir: string): Promise<DoctorCheck> {
  const runsDir = join(reflectionDir, "runs")
  let entries
  try {
    entries = await readdir(runsDir, { withFileTypes: true })
  } catch {
    return { name: "abandoned-runs", level: "ok", detail: "no abandoned runs" }
  }
  const abandoned = entries
    .filter((entry) => entry.isDirectory() && existsSync(join(runsDir, entry.name, "abandoned.json")))
    .map((entry) => join(runsDir, entry.name))
    .sort()
  if (abandoned.length === 0) return { name: "abandoned-runs", level: "ok", detail: "no abandoned runs" }
  return {
    name: "abandoned-runs",
    level: "warn",
    detail: `${abandoned.length} run${abandoned.length === 1 ? "" : "s"} need manual disposal: ${abandoned.join("; ")}`,
  }
}

/**
 * The streak severity is a function of a clock: `readReflectionHealth` retires a trailing failure
 * burst once its newest failure is older than REFLECTION_HEALTH_STALE_MS, so `[warn]` decays to
 * `[ok]` purely with the passage of time. Reading that clock from `deps.now` (the seam `checkFacts`
 * already uses) keeps the derivation a pure function of its inputs instead of the wall clock, so a
 * fixture can pin either side of the boundary and stay pinned. Omitting `now` falls back to
 * `Date.now()`, which is byte-identical to the previous behavior.
 */
export async function checkReflectionHealth(
  reflectionDir: string,
  options: { readonly now?: number } = {},
): Promise<DoctorCheck> {
  const health = await readReflectionHealth(join(reflectionDir, "completions"), {
    now: options.now ?? Date.now(),
  })
  const lastSuccess = health.lastSuccessAt ?? "never"
  if (health.streak === 0 && health.pendingCount === 0) {
    return {
      name: "reflection-health",
      level: "ok",
      detail: `streak 0; pending 0; last success ${lastSuccess}`,
    }
  }
  const failure = health.lastFailure
  const hint = reflectionRemediation(failure?.reason, failure?.detail)
  return {
    name: "reflection-health",
    level: health.streak >= 3 ? "warn" : "ok",
    detail: `streak ${health.streak}; fingerprint ${health.fingerprint || "none"}; pending ${health.pendingCount}; last success ${lastSuccess}; ${hint}`,
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
