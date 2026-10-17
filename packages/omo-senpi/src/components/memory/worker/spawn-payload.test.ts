import { afterEach, expect, test } from "bun:test"
import { existsSync, realpathSync } from "node:fs"
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { GitMemoryRepo, createReflectionWorktree, discardReflectionWorktree } from "@oh-my-opencode/memory-core"
import { prepareReflectionSpawn } from "./spawn-payload"
import { rmEfaultTolerant } from "../teardown.test-support"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rmEfaultTolerant(root, { recursive: true, force: true })))
})

async function payload(dream: boolean) {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-audit-payload-")))
  roots.push(root)
  const repo = new GitMemoryRepo({ dir: join(root, "repo"), agentId: "audit-fixture" })
  await repo.init({ seedFiles: [{ relativePath: "system/persona.md", content: "---\ndescription: Persona\n---\nFixture persona.\n" }] })
  const worktree = await createReflectionWorktree(repo, "audit-fixture", join(root, "worktrees"))
  await mkdir(join(worktree.dir, "reference"))
  await writeFile(join(worktree.dir, "reference/only-worktree.md"), "---\ndescription: Legacy target\n---\n[[notes/token=abc123456.md]]\n")
  try {
    const prepared = await prepareReflectionSpawn({
      run: { runId: dream ? "dream-audit" : "reflection-audit", request: dream
        ? { trigger: "dream", origin: "manual", conversationIds: [], snapshots: [] }
        : { trigger: "manual", conversationIds: [], snapshots: [] } },
      worktree, reflectionSessionsDir: join(root, "sessions"), category: "quick", model: "fixture/model",
      env: {}, mergePolicy: "auto", skillsUsageSource: join(root, "skills.json"),
      memoryUsageSource: join(root, "usage.json"), dreamStateSource: join(root, "dream.json"),
      peoplePolicy: { enabled: false, max_entries: 40, max_entry_chars: 200 },
      systemTokenBudget: 30000, systemTokenTarget: 24000,
    })
    return { prepared, parentRepo: repo.dir }
  } finally {
    await discardReflectionWorktree(repo, worktree.dir, worktree.branch)
  }
}

test("#given a worktree-only legacy target #when dream starts #then its audit is redacted", async () => {
  const { prepared, parentRepo } = await payload(true)
  const path = prepared.env.AUDIT_PATH
  if (!path) throw new Error("dream audit input missing")
  const text = await readFile(path, "utf8")
  const audit = JSON.parse(text)
  expect(audit.counts.link_dangling).toBe(1)
  expect(audit.issues[0].path).toBe("reference/only-worktree.md")
  expect(audit.issues[0].detail).toContain("***")
  expect(text).not.toContain("abc123456")
  expect(existsSync(join(parentRepo, "reference/only-worktree.md"))).toBe(false)
})

test("#given a reflection run #when it starts #then audit input is absent", async () => {
  const { prepared } = await payload(false)
  expect(prepared.env.AUDIT_PATH).toBeUndefined()
  expect(existsSync(join(prepared.paths.sessionDir, "audit.json"))).toBe(false)
})
