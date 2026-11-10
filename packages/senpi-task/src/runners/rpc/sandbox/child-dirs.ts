import { lstatSync, mkdirSync, readdirSync, rmdirSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import type { DenyLivePlan } from "./plan"
import { sandboxRequired } from "./policy"

// Engine state the child must write that lives in the agent dir: fresh, private, never live.
const PRIVATE_VIEW_DIRS = new Set(["cache", "logs", "gateway", "process-crashes"])
// Never exposed to the child: other tasks' records, the daemon sockets and keys, the parent's sessions.
const HIDDEN_VIEW_ENTRIES = new Set(["projects", "rpc", "rpc-host-daemon", "sessions"])

export type ChildDirs = { readonly release: () => void }

/**
 * Rebuilds the child's private dirs before EVERY spawn (start, resume, respawn, fallback rung), so a
 * symlink the child planted in an earlier run is gone before any rule names the path, then makes the
 * Linux placeholders for absent project-control entries. The returned release removes only the
 * placeholders this call created, and only while they are still empty.
 */
export function prepareChildDirs(plan: DenyLivePlan): ChildDirs {
  requireRealDir(plan.stateDir)
  for (const dir of [plan.viewDir, plan.tmpDir]) {
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { mode: 0o700 })
    requireRealDir(dir)
  }
  const sessions = join(plan.stateDir, "sessions")
  if (lexists(sessions)) requireRealDir(sessions)
  buildAgentView(plan.agentDir, plan.viewDir)
  mkdirSync(plan.artifactDir, { recursive: true })
  const placeholders = plan.platform === "linux" ? createPlaceholders(plan.projectControl) : []
  return { release: () => removePlaceholders(placeholders) }
}

function buildAgentView(agentDir: string, viewDir: string): void {
  for (const name of readdirSync(agentDir)) {
    if (HIDDEN_VIEW_ENTRIES.has(name)) continue
    const live = join(agentDir, name)
    const view = join(viewDir, name)
    if (PRIVATE_VIEW_DIRS.has(name)) {
      mkdirSync(view)
      continue
    }
    // senpi mkdirs some agent-dir folders (extensions/); bun's recursive mkdir refuses a symlinked
    // directory with EEXIST, so a live folder is a real view folder of per-entry links.
    if (lstatSync(live).isDirectory()) {
      mkdirSync(view)
      for (const entry of readdirSync(live)) symlinkSync(join(live, entry), join(view, entry))
    } else {
      symlinkSync(live, view)
    }
  }
}

function createPlaceholders(entries: readonly string[]): readonly string[] {
  const created: string[] = []
  for (const path of entries) {
    if (lexists(path)) continue
    if (path.endsWith(".json")) writeFileSync(path, "", { flag: "wx" })
    else mkdirSync(path)
    created.push(path)
  }
  return created
}

function removePlaceholders(created: readonly string[]): void {
  for (const path of created) {
    try {
      const stat = lstatSync(path)
      if (stat.isDirectory() && readdirSync(path).length === 0) rmdirSync(path)
      else if (stat.isFile() && stat.size === 0) unlinkSync(path)
    } catch {
      // Already gone, or replaced by content someone wants: leave it.
    }
  }
}

function requireRealDir(path: string): void {
  const stat = lstatSync(path)
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw sandboxRequired(`review-role child refused: ${path} is not a real directory`)
  }
  if (!statSync(path).isDirectory()) throw sandboxRequired(`review-role child refused: ${path} is not a directory`)
}

function lexists(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}
