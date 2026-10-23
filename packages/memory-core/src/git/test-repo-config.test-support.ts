import { execFileSync } from "node:child_process"

/** Raw fixture commits and receive-pack must not leave detached writers outside test teardown's ownership. */
export function disableFixtureAutoMaintenance(dir: string, bare = false): void {
  for (const [key, value] of [
    ["maintenance.auto", "false"],
    ["gc.auto", "0"],
    ...(bare ? [["receive.autogc", "false"]] : []),
  ]) {
    execFileSync("git", ["config", "--local", key, value], { cwd: dir, stdio: "pipe" })
  }
}
