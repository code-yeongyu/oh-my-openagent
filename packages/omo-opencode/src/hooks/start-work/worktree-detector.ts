import { execFileSync } from "node:child_process"
import { existsSync, realpathSync } from "node:fs"
import { resolve, win32 } from "node:path"

export type WorktreeEntry = {
  path: string
  branch: string | undefined
  bare: boolean
}

function normalizePath(path: string): string {
  const resolvedPath = process.platform !== "win32" && win32.isAbsolute(path) ? path : resolve(path)
  if (!existsSync(resolvedPath)) {
    return resolvedPath
  }

  try {
    return realpathSync.native(resolvedPath)
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error
    }
    try {
      return realpathSync(resolvedPath)
    } catch (fallbackError) {
      if (!(fallbackError instanceof Error)) {
        throw fallbackError
      }
      return resolvedPath
    }
  }
}

export function parseWorktreeListPorcelain(output: string): WorktreeEntry[] {
  const lines = output.split("\n").map((line) => line.trim())
  const entries: WorktreeEntry[] = []
  let current: Partial<WorktreeEntry> | undefined

  for (const line of lines) {
    if (!line) {
      if (current?.path) {
        entries.push({
          path: current.path,
          branch: current.branch,
          bare: current.bare ?? false,
        })
      }
      current = undefined
      continue
    }

    if (line.startsWith("worktree ")) {
      current = { path: line.slice("worktree ".length).trim() }
      continue
    }

    if (!current) continue

    if (line.startsWith("branch ")) {
      current.branch = line.slice("branch ".length).trim().replace(/^refs\/heads\//, "")
    } else if (line === "bare") {
      current.bare = true
    }
  }

  if (current?.path) {
    entries.push({
      path: current.path,
      branch: current.branch,
      bare: current.bare ?? false,
    })
  }

  return entries
}

export function listWorktrees(directory: string): WorktreeEntry[] {
  try {
    const output = execFileSync("git", ["worktree", "list", "--porcelain"], {
      cwd: directory,
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    })
    return parseWorktreeListPorcelain(output)
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error
    }
    return []
  }
}

export function detectWorktreePath(directory: string): string | null {
  try {
    const worktreePath = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: directory,
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim()
    return normalizePath(worktreePath)
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error
    }
    return null
  }
}
