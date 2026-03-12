import { execFileSync } from "node:child_process"

export type WorktreeEntry = {
  path: string
  branch: string | undefined
  bare: boolean
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
  } catch {
    return []
  }
}

export function detectWorktreePath(directory: string): string | null {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: directory,
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim()
  } catch {
    return null
  }
}
