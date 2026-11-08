import { chmodSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { GitMemoryRepo } from "../git"
import { createNodeGitExec } from "../git/exec"
import { disableFixtureAutoMaintenance } from "../git/test-repo-config.test-support"
import { getPostCommitHookScript, MirrorSync } from "./mirror"

export async function createMirrorRepo(dir: string): Promise<{ dir: string; repo: GitMemoryRepo; mirror: MirrorSync }> {
  const repo = new GitMemoryRepo({ dir, agentId: "agent-mirror" })
  await repo.init({ seedFiles: [{ relativePath: "system/persona.md", content: "seed\n" }] })
  disableFixtureAutoMaintenance(dir)
  const path = join(dir, ".git", "hooks", "post-commit")
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, getPostCommitHookScript(), "utf8")
  chmodSync(path, 0o755)
  return { dir, repo, mirror: new MirrorSync({ repo }) }
}

export async function initBareMirror(dir: string): Promise<void> {
  const result = await createNodeGitExec().run(["init", "--bare", "--quiet", "--initial-branch=main"], { cwd: dir, timeoutMs: 30_000 })
  if (result.code !== 0) throw new Error(result.stderr)
  disableFixtureAutoMaintenance(dir, true)
}
