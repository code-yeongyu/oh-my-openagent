import * as childProcess from "node:child_process"
import * as fs from "node:fs"
import { join } from "node:path"
import { parseGitStatusPorcelainZ } from "./parse-status-porcelain-z"
import { parseGitDiffNumstatZ } from "./parse-diff-numstat-z"
import type { GitFileStat } from "./types"

export function collectGitDiffStats(directory: string): GitFileStat[] {
  try {
    const diffOutput = childProcess.execFileSync("git", ["diff", "--numstat", "-z", "-M", "HEAD"], {
      cwd: directory,
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    })

    const statusOutput = childProcess.execFileSync("git", ["status", "--porcelain", "-z", "--find-renames", "--untracked-files=all"], {
      cwd: directory,
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    })

    const untrackedOutput = childProcess.execFileSync("git", ["ls-files", "-z", "--others", "--exclude-standard"], {
      cwd: directory,
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    })

    const untrackedNumstat = untrackedOutput
      ? untrackedOutput
          .split("\0")
          .filter(Boolean)
          .map((filePath) => {
            try {
              const content = fs.readFileSync(join(directory, filePath), "utf-8")
              const lineCount = content.split("\n").length - (content.endsWith("\n") ? 1 : 0)
              return `${lineCount}\t0\t${filePath}\0`
            } catch (error) {
              if (!(error instanceof Error)) {
                throw error
              }
              return `0\t0\t${filePath}\0`
            }
          })
          .join("")
      : ""

    const combinedNumstat = diffOutput + untrackedNumstat

    if (!combinedNumstat) return []

    const statusMap = parseGitStatusPorcelainZ(statusOutput)
    return parseGitDiffNumstatZ(combinedNumstat, statusMap)
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error
    }
    return []
  }
}
