import { executeCommand } from "./command-executor"

export interface PRHistoryConfig {
  maxDiffLength?: number
}

export class PRHistoryInjector {
  constructor(private config: PRHistoryConfig = { maxDiffLength: 1000 }) {}

  async isPRBranch(): Promise<boolean> {
    try {
      const currentBranch = await this.getCurrentBranch()
      if (["main", "master", "dev"].includes(currentBranch)) {
        return false
      }
      const baseBranch = await this.getBaseBranch()
      return !!baseBranch
    } catch {
      return false
    }
  }

  private async getCurrentBranch(): Promise<string> {
    return (await executeCommand("git rev-parse --abbrev-ref HEAD")).trim()
  }

  async getBaseBranch(): Promise<string | null> {
    try {
      return (await executeCommand("git rev-parse --abbrev-ref @{u}")).trim()
    } catch {
      try {
        await executeCommand("git rev-parse --verify origin/main")
        return "origin/main"
      } catch {
        try {
          await executeCommand("git rev-parse --verify origin/master")
          return "origin/master"
        } catch {
          return null
        }
      }
    }
  }

  async getDiff(baseBranch: string): Promise<string> {
    try {
      return (await executeCommand(`git diff ${baseBranch}...HEAD`)).trim()
    } catch {
      return ""
    }
  }

  async injectPRHistory(context: string): Promise<string> {
    try {
      const currentBranch = await this.getCurrentBranch()
      if (["main", "master", "dev"].includes(currentBranch)) {
        return context
      }

      const baseBranch = await this.getBaseBranch()
      if (!baseBranch) {
        return context
      }

      let diff = await this.getDiff(baseBranch)
      if (!diff) {
        return context
      }

      const maxLength = this.config.maxDiffLength ?? 1000
      if (diff.length > maxLength) {
        diff = diff.slice(0, maxLength) + "\n... (truncated)"
      }

      const prHistory = `\n\n### PR HISTORY (Diff from ${baseBranch})\n\`\`\`diff\n${diff}\n\`\`\``
      return context + prHistory
    } catch {
      return context
    }
  }
}
