import { execFileSync } from "node:child_process"
import { join } from "node:path"

/** Raw fixture commits and receive-pack must not leave detached writers outside test teardown's ownership. */
export function disableFixtureAutoMaintenance(dir: string, bare = false): void {
  // An explicit git dir refuses a directory that is not a repository instead of writing an enclosing one (#12265).
  const gitDir = bare ? dir : join(dir, ".git")
  for (const [key, value] of [
    ["maintenance.auto", "false"],
    ["gc.auto", "0"],
    ...(bare ? [["receive.autogc", "false"]] : []),
  ]) {
    execFileSync("git", ["--git-dir", gitDir, "config", "--local", key, value], { cwd: dir, stdio: "pipe" })
  }
}
