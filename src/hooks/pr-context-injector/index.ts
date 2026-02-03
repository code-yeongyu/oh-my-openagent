import { execSync } from "node:child_process"
import { createTextPart } from "../../shared/part-factory"

export interface PrContextInjectorContext {
  directory: string
}

export function createPrContextInjectorHook(ctx: PrContextInjectorContext) {
  const injectedSessions = new Set<string>()
  let cachedDiff: string | null = null
  let cachedBranch: string | null = null

  const getCurrentBranch = (): string | null => {
    try {
      return execSync("git branch --show-current", {
        cwd: ctx.directory,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim()
    } catch {
      return null
    }
  }

  const isFeatureBranch = (branch: string | null): boolean => {
    if (!branch) return false
    const mainBranches = ["main", "master", "dev", "develop"]
    return !mainBranches.includes(branch)
  }

  const getBaseBranch = (): string => {
    try {
      execSync("git rev-parse --verify main", { cwd: ctx.directory, stdio: ["pipe", "pipe", "pipe"] })
      return "main"
    } catch {
      try {
        execSync("git rev-parse --verify master", { cwd: ctx.directory, stdio: ["pipe", "pipe", "pipe"] })
        return "master"
      } catch {
        return "HEAD~10"
      }
    }
  }

  const getDiffSummary = (): string | null => {
    if (cachedDiff !== null) return cachedDiff

    try {
      const base = getBaseBranch()
      const diffStat = execSync(`git diff ${base}...HEAD --stat`, {
        cwd: ctx.directory,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim()

      if (!diffStat) return null

      cachedDiff = diffStat
      return cachedDiff
    } catch {
      return null
    }
  }

  const formatPrContext = (branch: string, diff: string): string => {
    return [
      "[PR CONTEXT]",
      `Branch: ${branch}`,
      "Diff Summary:",
      "```",
      diff,
      "```",
    ].join("\n")
  }

  return {
    "chat.message": async (
      input: { sessionID: string; messageID?: string },
      output: { parts?: Array<{ type: string; text?: string }> }
    ): Promise<void> => {
      if (injectedSessions.has(input.sessionID)) {
        return
      }

      const branch = getCurrentBranch()
      if (!isFeatureBranch(branch)) {
        return
      }

      cachedBranch = branch
      const diff = getDiffSummary()
      if (!diff) {
        return
      }

      injectedSessions.add(input.sessionID)

      const contextText = formatPrContext(branch!, diff)

      if (!output.parts) {
        output.parts = []
      }

      output.parts.push(
        createTextPart({
          sessionID: input.sessionID,
          messageID: input.messageID,
          text: contextText,
        })
      )
    },
  }
}
