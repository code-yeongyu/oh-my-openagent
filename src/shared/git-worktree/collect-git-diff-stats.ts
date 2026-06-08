import * as childProcess from "node:child_process"
import * as fs from "node:fs"
import { join } from "node:path"
import { parseGitStatusPorcelain } from "./parse-status-porcelain"
import { parseGitDiffNumstat } from "./parse-diff-numstat"
import type { GitFileStat } from "./types"

export function collectGitDiffStats(directory: string): GitFileStat[] {
  try {
    const diffOutput = childProcess.execFileSync("git", ["diff", "--numstat", "HEAD"], {
      cwd: directory,
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trimEnd()

    const statusOutput = childProcess.execFileSync("git", ["status", "--porcelain"], {
      cwd: directory,
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trimEnd()

    const untrackedOutput = childProcess.execFileSync("git", ["ls-files", "--others", "--exclude-standard"], {
      cwd: directory,
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trimEnd()

    const untrackedNumstat = untrackedOutput
      ? untrackedOutput
          .split("\n")
          .filter(Boolean)
          .map((filePath) => {
            try {
              const content = fs.readFileSync(join(directory, filePath), "utf-8")
              const lineCount = content.split("\n").length - (content.endsWith("\n") ? 1 : 0)
              return `${lineCount}\t0\t${filePath}`
            } catch (error) {
              if (!(error instanceof Error)) {
                throw error
              }
              return `0\t0\t${filePath}`
            }
          })
          .join("\n")
      : ""

    const combinedNumstat = [diffOutput, untrackedNumstat].filter(Boolean).join("\n").trim()

    if (!combinedNumstat) return []

    const statusMap = parseGitStatusPorcelain(statusOutput)
    return parseGitDiffNumstat(combinedNumstat, statusMap)
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error
    }
    return []
  }
}
