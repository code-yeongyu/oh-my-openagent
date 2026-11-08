import { existsSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { createNodeGitExec } from "../../../git/exec"
import { disableFixtureAutoMaintenance } from "../../../git/test-repo-config.test-support"

export async function ensureQaRepo(repoDir: string): Promise<void> {
  const exec = createNodeGitExec()
  const git = async (...argv: string[]) => {
    const r = await exec.run(argv, { cwd: repoDir, timeoutMs: 30_000 })
    if (r.code !== 0) throw new Error(`git ${argv.join(" ")}: ${r.stderr}`)
  }
  await mkdir(repoDir, { recursive: true })
  // Only repoDir's own .git counts: `git rev-parse` from repoDir also answers for an enclosing repository (#12265).
  if (existsSync(join(repoDir, ".git"))) {
    disableFixtureAutoMaintenance(repoDir)
    return
  }
  await git("init", "-q", "-b", "main")
  disableFixtureAutoMaintenance(repoDir)
  await git("config", "user.name", "QA")
  await git("config", "user.email", "qa@example.invalid")
  await git("config", "commit.gpgsign", "false")
  await writeFile(join(repoDir, ".gitkeep"), "")
  await git("add", ".gitkeep")
  await git("commit", "-q", "-m", "init")
}
