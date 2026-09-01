import { afterEach, describe, expect, test } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildIdentityPaths, type MemoryIdentityPaths } from "@oh-my-opencode/memory-core"

import { createReflectionRunIdFactory } from "./reflection-run-id"

const roots: string[] = []
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }))),
)

async function fixture(): Promise<MemoryIdentityPaths> {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "reflection-run-id-")))
  roots.push(root)
  return buildIdentityPaths(root, "agent-test")
}

async function seedDir(directory: string, names: readonly string[]): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await Promise.all(names.map((name) => mkdir(join(directory, name), { recursive: true, mode: 0o700 })))
}

async function seedReservation(paths: MemoryIdentityPaths, file: string, runId: string): Promise<void> {
  await mkdir(paths.reflection, { recursive: true, mode: 0o700 })
  await writeFile(
    join(paths.reflection, file),
    `${JSON.stringify({ runId, request: { trigger: "manual", conversationIds: ["conversation-a"], snapshots: [] } })}\n`,
    "utf8",
  )
}

describe("disk-scoped reflection run ids", () => {
  test("#given no reflection state on disk #when the first id is minted #then numbering starts at one", async () => {
    // given
    const paths = await fixture()

    // when
    const id = await createReflectionRunIdFactory({ identityPaths: paths })()

    // then
    expect(id).toBe("reflection-run-1")
  })

  test("#given completion records left by an earlier generation #when a fresh process mints #then it continues above the highest record", async () => {
    // given
    const paths = await fixture()
    await mkdir(join(paths.reflection, "completions"), { recursive: true, mode: 0o700 })
    await writeFile(join(paths.reflection, "completions", "reflection-run-13.json"), "{}\n", "utf8")

    // when
    const id = await createReflectionRunIdFactory({ identityPaths: paths })()

    // then
    expect(id).toBe("reflection-run-14")
  })

  test("#given run directories outnumbering completion records #when minting #then the highest run directory wins", async () => {
    // given
    const paths = await fixture()
    await mkdir(join(paths.reflection, "completions"), { recursive: true, mode: 0o700 })
    await writeFile(join(paths.reflection, "completions", "reflection-run-2.json"), "{}\n", "utf8")
    await seedDir(join(paths.reflection, "runs"), ["reflection-run-7"])

    // when
    const id = await createReflectionRunIdFactory({ identityPaths: paths })()

    // then
    expect(id).toBe("reflection-run-8")
  })

  test("#given only an epoch-prefixed worktree surviving cleanup #when minting #then its embedded run number is honoured", async () => {
    // given
    const paths = await fixture()
    await seedDir(paths.worktrees, ["1755000000000-reflection-run-21"])

    // when
    const id = await createReflectionRunIdFactory({ identityPaths: paths })()

    // then
    expect(id).toBe("reflection-run-22")
  })

  test("#given only a leftover reflection session directory #when minting #then its run number is honoured", async () => {
    // given
    const paths = await fixture()
    await seedDir(paths.reflectionSessions, ["reflection-run-5"])

    // when
    const id = await createReflectionRunIdFactory({ identityPaths: paths })()

    // then
    expect(id).toBe("reflection-run-6")
  })

  test("#given a live reservation whose run has no artifacts yet #when minting #then the reserved id is skipped", async () => {
    // given
    const paths = await fixture()
    await seedReservation(paths, "active.lock", "reflection-run-9")
    await seedReservation(paths, "pending.json", "reflection-run-10")

    // when
    const id = await createReflectionRunIdFactory({ identityPaths: paths })()

    // then
    expect(id).toBe("reflection-run-11")
  })

  test("#given unreadable reservation state #when minting #then it contributes nothing instead of failing the mint", async () => {
    // given
    const paths = await fixture()
    await mkdir(paths.reflection, { recursive: true, mode: 0o700 })
    await writeFile(join(paths.reflection, "active.lock"), "{not json", "utf8")

    // when
    const id = await createReflectionRunIdFactory({ identityPaths: paths })()

    // then
    expect(id).toBe("reflection-run-1")
  })

  test("#given names in the scanned directories that are not run shaped #when minting #then they are ignored", async () => {
    // given
    const paths = await fixture()
    await mkdir(join(paths.reflection, "completions"), { recursive: true, mode: 0o700 })
    await writeFile(join(paths.reflection, "completions", "not-a-run.json"), "{}\n", "utf8")
    await writeFile(join(paths.reflection, "completions", "reflection-run-notanumber.json"), "{}\n", "utf8")
    await seedDir(join(paths.reflection, "runs"), ["facts-abc123-4", "reflection-run-4"])

    // when
    const id = await createReflectionRunIdFactory({ identityPaths: paths })()

    // then
    expect(id).toBe("reflection-run-5")
  })

  test("#given repeated mints within one process #when nothing new lands on disk between them #then ids stay strictly increasing", async () => {
    // given
    const paths = await fixture()
    const mint = createReflectionRunIdFactory({ identityPaths: paths })

    // when
    const ids = [await mint(), await mint(), await mint()]

    // then
    expect(ids).toEqual(["reflection-run-1", "reflection-run-2", "reflection-run-3"])
  })

  test("#given an id minted and persisted by one process #when a later process mints #then it continues above it", async () => {
    // given
    const paths = await fixture()
    const first = await createReflectionRunIdFactory({ identityPaths: paths })()
    await seedDir(join(paths.reflection, "runs"), [first])

    // when
    const second = await createReflectionRunIdFactory({ identityPaths: paths })()

    // then
    expect(first).toBe("reflection-run-1")
    expect(second).toBe("reflection-run-2")
  })
})
