export class GitError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = new.target.name
  }
}

export class GitCommandError extends GitError {
  constructor(
    readonly argv: readonly string[],
    readonly code: number,
    readonly stdout: string,
    readonly stderr: string,
  ) {
    const detail = stderr.trim() || stdout.trim() || `exit code ${code}`
    super(`git ${argv.join(" ")} failed: ${detail}`)
  }
}

export class GitTimeoutError extends GitError {
  constructor(readonly argv: readonly string[], readonly timeoutMs: number) {
    super(`git ${argv.join(" ")} timed out after ${timeoutMs}ms`)
  }
}

export class GitNotFoundError extends GitError {
  constructor(options?: ErrorOptions) {
    super("Git is required for memory storage but was not found on PATH.", options)
  }
}

export class DirtyRepoError extends GitError {
  constructor(readonly porcelain: string, readonly encodingDiagnostics: readonly string[]) {
    const encoding = encodingDiagnostics.length > 0
      ? ` Dirty markdown encoding issue(s): ${encodingDiagnostics.join("; ")}.`
      : ""
    super(
      `Memory repo has uncommitted changes. Commit, discard, or sync them before using memory tools.\n${porcelain.trimEnd()}${encoding}`,
    )
  }
}

export class NoEffectiveChangesError extends GitError {
  constructor(readonly paths: readonly string[]) {
    super(`Memory write produced no effective changes for: ${paths.join(", ")}`)
  }
}

export class InvalidGitPathError extends GitError {}
