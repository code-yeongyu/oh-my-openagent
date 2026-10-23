import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { createNodeGitExec } from "../../../git/exec"
import { disableFixtureAutoMaintenance } from "../../../git/test-repo-config.test-support"

export async function initGitSyncTestRepo(root: string): Promise<void> {
  const exec = createNodeGitExec()
  for (const argv of [
    ["init", "-q", "-b", "main"],
    ["config", "user.name", "Agent"],
    ["config", "user.email", "agent@example.invalid"],
    ["config", "commit.gpgsign", "false"],
  ]) {
    const result = await exec.run(argv, { cwd: root, timeoutMs: 20_000 })
    if (result.code !== 0) throw new Error(result.stderr)
  }
  disableFixtureAutoMaintenance(root)
  await writeFile(join(root, "base.md"), "base\n")
  for (const argv of [["add", "base.md"], ["commit", "-q", "-m", "init"]]) {
    const result = await exec.run(argv, { cwd: root, timeoutMs: 20_000 })
    if (result.code !== 0) throw new Error(result.stderr)
  }
}
