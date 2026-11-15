import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * Temporary folders and a one-commit git repository for worktree tests; `cleanup` removes everything made. Folders are
 * returned canonical (macOS's tmpdir is under the /var -> /private/var symlink, Windows' under an 8.3 short name, and git
 * reports real long paths); `gitPath` spells a path the way git prints it (forward slashes on Windows).
 */
export function gitRepoKit() {
  const made: string[] = []
  const folder = (prefix: string): string => {
    const path = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)))
    made.push(path)
    return path
  }
  const git = (cwd: string, ...args: string[]): string =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], {
      cwd,
      encoding: "utf8",
      windowsHide: true,
    }).trim()
  const repository = (): string => {
    const path = folder("thread-wt-repo-")
    git(path, "init", "-q", "-b", "main")
    writeFileSync(join(path, "README.md"), "x\n")
    git(path, "add", "README.md")
    git(path, "commit", "-q", "-m", "init")
    mkdirSync(join(path, "sub"))
    return path
  }
  const cleanup = (): void => {
    for (const path of made.splice(0)) rmSync(path, { recursive: true, force: true })
  }
  const gitPath = (path: string): string => (process.platform === "win32" ? path.replaceAll("\\", "/") : path)
  return { folder, git, gitPath, repository, cleanup }
}
