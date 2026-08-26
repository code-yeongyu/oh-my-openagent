import { describe, test, expect } from "bun:test"
import { readFile } from "node:fs/promises"
import path from "node:path"

describe("worktree-sweep command registration", () => {
  test("registers worktree-sweep on the omo-agent-toolkit program with the documented flags", async () => {
    // given
    const source = await readFile(
      path.resolve(import.meta.dir, "..", "runtime-commands.ts"),
      "utf-8",
    )

    // when
    const commandBlock = source.match(/program\s*\n\s*\.command\("worktree-sweep"\)([\s\S]*?)\.action\(/)

    // then
    expect(commandBlock).not.toBeNull()
    expect(commandBlock?.[1]).toContain('"--apply"')
    expect(commandBlock?.[1]).toContain('"--older-than <days>"')
    expect(commandBlock?.[1]).toContain('"--repo <path>"')
    expect(commandBlock?.[1]).toContain('"--json"')
  })

  test("sweep implementation never forces a removal", async () => {
    // given
    const gitSource = await readFile(path.resolve(import.meta.dir, "git.ts"), "utf-8")

    // when / then
    expect(gitSource).not.toContain("'--force'")
    expect(gitSource).not.toContain('"--force"')
    expect(gitSource).toContain('runGit(repo, ["worktree", "remove", worktreePath])')
  })

  test("apply only removes after classification decides SWEEP", async () => {
    // given
    const sweepSource = await readFile(path.resolve(import.meta.dir, "sweep.ts"), "utf-8")

    // when / then
    expect(sweepSource).toContain('classification.decision !== "SWEEP"')
    expect(sweepSource).toContain("await pruneWorktrees(root)")
  })
})
