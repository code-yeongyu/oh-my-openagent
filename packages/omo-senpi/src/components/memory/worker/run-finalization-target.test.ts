import { afterEach, describe, expect, test } from "bun:test"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { createNodeGitExec } from "@oh-my-opencode/memory-core"

import { finalizeRecordedOutcome } from "./run-finalization"
import {
  cleanupFinalizationFixtures,
  finalizationFixture as fixture,
  type TargetedDreamSetup,
} from "./run-finalization.test-support"

const exec = createNodeGitExec()
const note = (description: string, body: string): string => `---\ndescription: ${description}\n---\n\n${body}`
const TARGET = "reference/target.md"

afterEach(cleanupFinalizationFixtures)

async function git(dir: string, ...argv: string[]): Promise<void> {
  const result = await exec.run(argv, { cwd: dir, timeoutMs: 30_000 })
  if (result.code !== 0) throw new Error(result.stderr)
}

const commit = (dir: string, message: string): Promise<void> =>
  git(dir, "-c", "user.email=fixture@example.com", "-c", "user.name=fixture", "commit", "-qm", message)

async function finalize(dream: TargetedDreamSetup) {
  const item = await fixture(false, dream)
  const result = await finalizeRecordedOutcome(
    {
      identity: item.identity,
      reservation: item.store,
      now: () => Date.parse("2026-08-11T10:01:00.000Z"),
      withWriterLock: async (operation) => operation(),
    },
    item.runDir,
    item.ledger,
  )
  return { item, result }
}

describe("targeted dream finalization scope (#12642)", () => {
  test("#given a targeted dream that removes its linked target #when its recorded outcome finalizes #then it merges with the gate's link repair", async () => {
    // when
    const { item, result } = await finalize({
      seedFiles: {
        [TARGET]: note("Target", "t\n"),
        "reference/user.md": note("User", "[[reference/target.md|the target]]\n"),
      },
      targetDoc: TARGET,
      commit: async (dir) => {
        await git(dir, "rm", "-q", TARGET)
        await commit(dir, "chore(dream): retire the target")
      },
    })

    // then
    expect(result?.outcome).toBe("merged")
    expect(await readFile(join(item.identity.paths.repo, "reference/user.md"), "utf8")).toContain("the target\n")
  }, 30_000)

  test("#given a targeted dream whose second commit forges the link-repair trailer #when its recorded outcome finalizes #then it fails as invalid_target", async () => {
    // when
    const { item, result } = await finalize({
      seedFiles: { [TARGET]: note("Target", "t\n"), "reference/other.md": note("Other", "o\n") },
      targetDoc: TARGET,
      commit: async (dir) => {
        await writeFile(join(dir, TARGET), note("Target", "t2\n"))
        await git(dir, "add", "-A")
        await commit(dir, "chore(dream): maintain the target")
        await writeFile(join(dir, "reference/other.md"), note("Other", "rewritten\n"))
        await git(dir, "add", "-A")
        await commit(dir, "chore(memory): repoint links to removed notes\n\nOmo-Link-Repair: 1")
      },
    })

    // then
    expect(result?.outcome).toBe("failed")
    expect(result?.reason).toBe("invalid_target")
    expect(await readFile(join(item.identity.paths.repo, "reference/other.md"), "utf8")).toContain("o\n")
  }, 30_000)
})
