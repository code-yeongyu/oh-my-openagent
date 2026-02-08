import { execFileSync } from "node:child_process"
import { parseGitStatusPorcelain } from "./parse-status-porcelain"
import { parseGitDiffNumstat } from "./parse-diff-numstat"
import type { GitFileStat } from "./types"

export function collectGitDiffStats(directory: string): GitFileStat[] {
  try {
    const diffOutput = execFileSync("git", ["diff", "--numstat", "HEAD"], {
      cwd: directory,
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim()

    if (!diffOutput) return []

    const statusOutput = execFileSync("git", ["status", "--porcelain"], {
      cwd: directory,
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim()

    const statusMap = parseGitStatusPorcelain(statusOutput)
    return parseGitDiffNumstat(diffOutput, statusMap)
  } catch {
    return []
  }
}
