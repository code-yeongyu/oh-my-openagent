/**
 * Commit Size Checker
 *
 * Enforces atomic commits by warning when a commit includes too many files.
 * Default threshold is 3 files per commit.
 */

/**
 * Commit check input
 */
export interface CommitCheckInput {
  files: string[]
  skipCheck?: boolean
}

/**
 * Commit check result
 */
export interface CommitCheckResult {
  shouldWarn: boolean
  skipped: boolean
  message?: string
  fileCount: number
}

/**
 * Default file count threshold
 */
const DEFAULT_THRESHOLD = 3

/**
 * Commit Size Checker interface
 */
export interface CommitSizeChecker {
  /** Check if commit exceeds file threshold */
  check(input: CommitCheckInput): CommitCheckResult
  /** Set custom threshold */
  setThreshold(threshold: number): void
  /** Get current threshold */
  getThreshold(): number
  /** Check if command is a git commit */
  isCommitCommand(command: string): boolean
}

/**
 * Commit Size Checker implementation
 */
class CommitSizeCheckerImpl implements CommitSizeChecker {
  private threshold: number = DEFAULT_THRESHOLD

  check(input: CommitCheckInput): CommitCheckResult {
    const fileCount = input.files.length

    // Skip if requested
    if (input.skipCheck) {
      return {
        shouldWarn: false,
        skipped: true,
        fileCount,
      }
    }

    // Check against threshold
    if (fileCount > this.threshold) {
      return {
        shouldWarn: true,
        skipped: false,
        fileCount,
        message: this.generateWarningMessage(fileCount),
      }
    }

    return {
      shouldWarn: false,
      skipped: false,
      fileCount,
    }
  }

  private generateWarningMessage(fileCount: number): string {
    return `⚠️ 提交包含 ${fileCount} 个文件，超过建议阈值 (${this.threshold})。

建议将此次提交分拆为多个原子化提交，每个提交聚焦于单一功能或修改。

原子化提交的好处：
- 更容易进行代码审查
- 更容易回滚特定变更
- 更清晰的 git 历史

如需跳过此检查，可添加 --no-verify 标志。`
  }

  setThreshold(threshold: number): void {
    this.threshold = threshold
  }

  getThreshold(): number {
    return this.threshold
  }

  isCommitCommand(command: string): boolean {
    // Match git commit with various flags
    const commitPattern = /^git\s+commit\b/i
    return commitPattern.test(command.trim())
  }
}

/**
 * Create a new Commit Size Checker instance
 */
export function createCommitSizeChecker(): CommitSizeChecker {
  return new CommitSizeCheckerImpl()
}
