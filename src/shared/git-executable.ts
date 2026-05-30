import { existsSync } from "node:fs"

const GIT_EXECUTABLE_CANDIDATES = [
  "/usr/bin/git",
  "/opt/homebrew/bin/git",
  "/usr/local/bin/git",
] as const

export function resolveGitExecutable(): string {
  for (const candidate of GIT_EXECUTABLE_CANDIDATES) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  if (typeof Bun !== "undefined") {
    return Bun.which("git") ?? "git"
  }

  return "git"
}
