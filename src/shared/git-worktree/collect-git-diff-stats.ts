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

    const statusOutput = execFileSync("git", ["status", "--porcelain"], {
      cwd: directory,
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim()

    const untrackedOutput = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], {
      cwd: directory,
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim()

    const untrackedNumstat = untrackedOutput
      ? untrackedOutput
          .split("\n")
          .filter(Boolean)
          .map((filePath) => `0\t0\t${filePath}`)
          .join("\n")
      : ""

    const combinedNumstat = [diffOutput, untrackedNumstat].filter(Boolean).join("\n").trim()

    if (!combinedNumstat) return []

    const statusMap = parseGitStatusPorcelain(statusOutput)
    return parseGitDiffNumstat(combinedNumstat, statusMap)
  } catch {
    return []
  }
}
