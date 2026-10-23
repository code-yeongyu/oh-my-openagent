import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { AGREEMENTS_PATH } from "../agreements/types"
import { GitMemoryRepo } from "../git"
import { removeTree } from "../../../../test-support/remove-tree"
import { validateCompletion } from "./completion-validation"
import { createReflectionWorktree, type ReflectionWorktree } from "./worktree"

const AUTHOR = { agentId: "agent-one", authorName: "Reflection Agent" }
const LEDGER = "---\ndescription: Agreements\n---\n\n- [global] Never filter the monitor <!-- id: 3f9a1c0b2e; by: human; n: 1; status: active -->\n"
const roots: string[] = []

setDefaultTimeout(process.platform === "win32" ? 20_000 : 5_000)

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => removeTree(root, { maxRetries: 10, retryDelay: 200 })))
})

async function fixture() {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "reflection-agreements-")))
  roots.push(root)
  const repo = new GitMemoryRepo({ dir: join(root, "memory"), agentId: AUTHOR.agentId })
  await repo.init({ seedFiles: [{ relativePath: AGREEMENTS_PATH, content: LEDGER }] })
  return createReflectionWorktree(repo, "run-1", join(root, "worktrees"))
}

async function commit(worktree: ReflectionWorktree, path: string, content: string) {
  const target = join(worktree.dir, path)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, content)
  await new GitMemoryRepo({ dir: worktree.dir, agentId: AUTHOR.agentId }).commitWrite([path], `reflect ${path}`, AUTHOR)
}

describe("reflection completion: the agreement ledger is off limits (security contract)", () => {
  it("#given a reflection that edits system/agreements.md #when validated #then it fails naming the ledger", async () => {
    // given
    const worktree = await fixture()
    await commit(worktree, AGREEMENTS_PATH, LEDGER.replace("Never filter the monitor", "Filter the monitor freely"))

    // when
    const result = await validateCompletion(worktree, worktree.baseSha, worktree.exec)

    // then
    expect(result.status).toBe("failed")
    expect(result.status === "failed" ? result.detail : "").toContain(AGREEMENTS_PATH)
  })

  it("#given a reflection that git-mv's the ledger elsewhere (default rename detection) #when validated #then it fails naming the ledger", async () => {
    // given
    const worktree = await fixture()
    await mkdir(join(worktree.dir, "reference"), { recursive: true })
    const moved = await worktree.exec.run(["mv", AGREEMENTS_PATH, "reference/old-agreements.md"], { cwd: worktree.dir, timeoutMs: 30_000 })
    expect(moved.code).toBe(0)
    await new GitMemoryRepo({ dir: worktree.dir, agentId: AUTHOR.agentId })
      .commitPrepared([AGREEMENTS_PATH, "reference/old-agreements.md"], "move the ledger", AUTHOR)

    // when
    const result = await validateCompletion(worktree, worktree.baseSha, worktree.exec)

    // then
    expect(result.status).toBe("failed")
    expect(result.status === "failed" ? result.detail : "").toContain(AGREEMENTS_PATH)
  })

  it("#given a reflection that edits another system block #when validated #then it stays valid", async () => {
    // given
    const worktree = await fixture()
    await commit(worktree, "system/notes.md", "---\ndescription: Notes\n---\n\nbody\n")

    // when
    const result = await validateCompletion(worktree, worktree.baseSha, worktree.exec)

    // then
    expect(result.status).toBe("valid")
  })
})
