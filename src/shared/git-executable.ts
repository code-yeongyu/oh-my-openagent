import { existsSync } from "node:fs"
import { bunWhich } from "./bun-which-shim"

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

  return bunWhich("git") ?? "git"
}
