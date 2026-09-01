import { GitCommandError, InvalidGitPathError } from "./errors"
import type { GitExecResult } from "./exec"
import type { GitCommitAuthor } from "./repo-types"

export function authorFlags(author: GitCommitAuthor): string[] {
  const name = author.authorName.trim() || author.agentId
  const email = author.authorEmail ?? `${author.agentId}@omo.local`
  return ["-c", `user.name=${name}`, "-c", `user.email=${email}`]
}

export function normalizePathspecs(paths: readonly string[]): string[] {
  return [...new Set(paths.map((path) => path.replace(/\\/g, "/")).filter((path) => path.trim()))]
}

export function normalizeSeedPath(path: string): string {
  const normalized = path.replace(/\\/g, "/")
  const segments = normalized.split("/").filter(Boolean)
  if (!normalized || normalized.startsWith("/") || segments.some((segment) => segment === "." || segment === "..")) {
    throw new InvalidGitPathError(`Invalid memory seed path: ${path}`)
  }
  return segments.join("/")
}

export function commandError(argv: readonly string[], result: GitExecResult): GitCommandError {
  return new GitCommandError(argv, result.code, result.stdout, result.stderr)
}
