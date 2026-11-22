import { expect, test } from "bun:test"
import { chmod, truncate, unlink } from "node:fs/promises"
import { join } from "node:path"

import { markMemoryBlock } from "@oh-my-opencode/memory-core"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createMemoryBinding } from "./binding"
import { fakeCommandContext, fakeDeps, invoke, seededRepo, tempIdentity } from "./commands/commands.test-support"
import { registerMemoryCommands } from "./commands/register"
import { createMemoryIdentityContext } from "./context"
import { MemoryFakeExtensionAPI } from "./memory.test-support"
import { createMemoryPromptHandler } from "./prompt"
import { beforeAgentStart, dispatchEvent } from "./prompt.test-support"

async function fixture() {
  const { identity } = await tempIdentity()
  const repo = await seededRepo(identity, [
    { relativePath: "system/persona.md", content: "---\ndescription: Persona\n---\nFixture memory\n" },
  ])
  const head = await repo.head()
  if (head === null) throw new Error("seeded fixture has no HEAD")
  const gitDir = join(repo.dir, ".git")
  return {
    identity,
    repo,
    head,
    gitDir,
    headObject: join(gitDir, "objects", head.slice(0, 2), head.slice(2)),
  }
}

async function corruptObject(path: string): Promise<void> {
  await chmod(path, 0o600)
  await truncate(path, 0)
}

test.each(["empty HEAD object", "missing HEAD"] as const)(
  "#9768: %s drops the projection and warns once per session",
  async (failure) => {
    const { identity, repo, gitDir, headObject } = await fixture()
    if (failure === "empty HEAD object") await corruptObject(headObject)
    else await unlink(join(gitDir, "HEAD"))
    const context = createMemoryIdentityContext({
      ...identity,
      binding: createMemoryBinding({ identity: identity.identity, repoPath: repo.dir, boundAt: 0 }),
    })
    const pi = new FakeExtensionAPI()
    pi.on("before_agent_start", createMemoryPromptHandler({ resolveContext: () => context }))
    const session = (id: string) => {
      const ctx = fakeCommandContext({ sessionId: id })
      return {
        ...ctx,
        ui: Object.assign(ctx.ui, { setStatus() {} }),
        sessionManager: { ...ctx.sessionManager, getSessionId: () => id, getBranch: () => [] },
      }
    }
    const first = session("first")
    const basePrompt = "Base system prompt"
    const payload = beforeAgentStart(`${basePrompt}\n\n${markMemoryBlock(identity.identity, "stale projection")}`)

    for (let turn = 0; turn < 3; turn += 1) {
      const result = await dispatchEvent(pi, payload, first)
      expect(result).toEqual({ systemPrompt: basePrompt })
    }
    expect(first.ui.notifications).toHaveLength(1)
    expect(first.ui.notifications[0]?.message).toContain(repo.dir)
    expect(first.ui.notifications[0]?.message).toContain("/memory doctor")
    expect(first.ui.notifications[0]?.message).not.toMatch(/git ls-tree|Extension .* error|^\s+at /m)

    const second = session("second")
    const preview = await dispatchEvent(
      pi,
      { type: "before_agent_start", preview: true, systemPrompt: basePrompt },
      second,
    )
    expect(preview).toEqual({ systemPrompt: basePrompt })
    expect(second.ui.notifications).toHaveLength(0)
    expect(await dispatchEvent(pi, payload, second)).toEqual({ systemPrompt: basePrompt })
    expect(second.ui.notifications).toEqual(first.ui.notifications)
  },
)

test("#9768: both doctor commands report the bad HEAD object and a working-tree-preserving repair", async () => {
  const { identity, repo, head, headObject } = await fixture()
  await corruptObject(headObject)
  const pi = new MemoryFakeExtensionAPI()
  registerMemoryCommands(pi, fakeDeps(identity))
  const ctx = fakeCommandContext()

  const report = await invoke(pi, "doctor", "", ctx)

  expect(report).toContain("[fail] repository-integrity:")
  expect(report).toContain(repo.dir)
  expect(report).toContain(head)
  expect(report).toContain("Back up")
  expect(report).toContain("git reset --mixed <last-good-commit>")
  const aliasReport = await invoke(pi, "memory", "doctor", ctx)
  expect(aliasReport).toContain("[fail] repository-integrity:")
  expect(aliasReport).toContain(head)
})

test("#9768: doctor passes repository integrity for a healthy committed repository", async () => {
  const { identity } = await fixture()
  const pi = new MemoryFakeExtensionAPI()
  registerMemoryCommands(pi, fakeDeps(identity))

  const report = await invoke(pi, "doctor", "", fakeCommandContext())

  expect(report).toContain("[ok] repository-integrity:")
})

test("#9768: doctor detects a corrupt blob even when HEAD and the tree are readable", async () => {
  const { identity, repo, gitDir } = await fixture()
  const blob = (await repo.lsTreeBlobs())[0]
  if (blob === undefined) throw new Error("seeded fixture has no blob")
  await corruptObject(join(gitDir, "objects", blob.oid.slice(0, 2), blob.oid.slice(2)))
  const pi = new MemoryFakeExtensionAPI()
  registerMemoryCommands(pi, fakeDeps(identity))

  const report = await invoke(pi, "doctor", "", fakeCommandContext())

  expect(report).toContain("[fail] repository-integrity: git fsck:")
  expect(report).toContain(blob.oid)
})
