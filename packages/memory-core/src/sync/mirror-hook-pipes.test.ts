import { afterEach, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { chmodSync, existsSync, realpathSync } from "node:fs"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { createNodeGitExec } from "../git/exec"
import { settlesWithin } from "../git/settles-within.test-support"
import { probeUntil } from "../locks/process-liveness.test-support"
import { CONFIG_KEY, getPostCommitHookScript, mirrorLogPath } from "./mirror"
import { removeTree } from "../../../../test-support/remove-tree"

// omo #10199 delta review LOW: the mirror post-commit hook backgrounds its push. If that background
// push keeps git's stdout/stderr open, every mirrored commit waits out the exit drain. The commit
// here runs with a drain far longer than the test's breaker while the push is held open, so it
// settles only if the hook leaves git's pipes alone.

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => removeTree(root, { maxRetries: 10, retryDelay: 200 })))
})

async function scratch(prefix: string): Promise<string> {
  const dir = realpathSync.native(await mkdtemp(join(tmpdir(), prefix)))
  roots.push(dir)
  return dir
}

async function repoMirroringToABlockedRemote(shell: string) {
  const repo = await scratch("memory-mirror-pipes-")
  const bare = await scratch("memory-mirror-pipes-bare-")
  const release = join(bare, "release")
  const pushing = join(bare, "pushing")
  execFileSync("git", ["init", "--bare", "--quiet", "--initial-branch=main", bare])
  await writeFile(join(bare, "hooks", "pre-receive"), `#!/bin/sh\n: > "${pushing}"\nwhile [ ! -f "${release}" ]; do sleep 0.1; done\nexit 0\n`, "utf8")
  chmodSync(join(bare, "hooks", "pre-receive"), 0o755)
  execFileSync("git", ["init", "--quiet", "--initial-branch=main", repo])
  for (const [key, value] of [["user.email", "m@example.invalid"], ["user.name", "m"], [CONFIG_KEY, `file://${bare}`]] as const) {
    execFileSync("git", ["-C", repo, "config", key, value])
  }
  const hook = join(repo, ".git", "hooks", "post-commit")
  await mkdir(dirname(hook), { recursive: true })
  await writeFile(hook, getPostCommitHookScript().replace(/^#!\/bin\/sh\n/, `#!${shell}\n`), "utf8")
  chmodSync(hook, 0o755)
  return { repo, release, pushing }
}

// dash (Linux's /bin/sh) keeps saved copies of a function call's redirected fds open in the
// background subshell; bash (macOS's /bin/sh) does not. Run the hook under each shell present.
const SHELLS = ["/bin/sh", "/bin/dash"].filter((shell) => existsSync(shell))

describe("a mirrored memory commit (omo #10199 delta review)", () => {
  test.skipIf(process.platform === "win32").each(SHELLS)("#given the mirror push is still running in the background under %s #when the commit finishes #then it settles without waiting on the push or the exit drain", async (shell) => {
    // #given
    const { repo, release, pushing } = await repoMirroringToABlockedRemote(shell)
    const exec = createNodeGitExec()

    // #when
    const commit = exec.run(["commit", "--allow-empty", "-q", "-m", "mirrored"], { cwd: repo, timeoutMs: 600_000, exitDrainMs: 600_000 })
    const settled = await settlesWithin(commit, 30_000)
    const pushStarted = await probeUntil(() => existsSync(pushing), 20_000)
    await writeFile(release, "", "utf8")

    // #then
    expect(pushStarted).toBe(true)
    expect(settled.kind).toBe("settled")
    if (settled.kind === "settled") expect(settled.value.code).toBe(0)
    expect(await probeUntil(async () => (await readFile(mirrorLogPath(repo), "utf8").catch(() => "")).includes("exit=0"), 30_000)).toBe(true)
  }, 120_000)
})
