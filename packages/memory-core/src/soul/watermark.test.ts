import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { GitMemoryRepo, type GitCommitAuthor } from "../git"
import { consumeSoulNoticeDelta } from "./watermark"
import { realpathSync } from "node:fs"

const AUTHOR: GitCommitAuthor = {
  agentId: "agent-soul-watermark-test",
  authorName: "Soul Watermark Test Agent",
}

const WINDOWS_INTEGRATION_TEST_TIMEOUT = process.platform === "win32" ? 20_000 : 5_000
const roots: string[] = []

setDefaultTimeout(WINDOWS_INTEGRATION_TEST_TIMEOUT)

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })))
})

async function fixture(): Promise<{
  repo: GitMemoryRepo
  noticesDir: string
  locksDir: string
}> {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "omo-soul-watermark-")))
  roots.push(root)
  const repo = new GitMemoryRepo({ dir: join(root, "repo"), agentId: AUTHOR.agentId })
  await repo.init({ authorName: AUTHOR.authorName })
  const noticesDir = join(root, "runtime", "notices")
  const locksDir = join(root, "runtime", "locks")
  await mkdir(noticesDir, { recursive: true })
  await mkdir(locksDir, { recursive: true })
  return { repo, noticesDir, locksDir }
}

async function commit(
  repo: GitMemoryRepo,
  path: string,
  content: string,
  message: string,
): Promise<string> {
  const fullPath = join(repo.dir, path)
  await mkdir(join(repo.dir, path.split("/").slice(0, -1).join("/")), { recursive: true })
  await writeFile(fullPath, content, "utf8")
  await repo.commitWrite([path], message, AUTHOR)
  const head = await repo.head()
  if (head === null) throw new Error("commit produced no HEAD")
  return head
}

async function readWatermark(noticesDir: string): Promise<unknown> {
  return JSON.parse(await readFile(join(noticesDir, "soul-head.json"), "utf8"))
}

const IN_BAND = "Omo-Writer: memory-tool\nOmo-Session: session-1\nOmo-Turn: 3"

describe("consumeSoulNoticeDelta", () => {
  it("#given no watermark file #when consumed #then the watermark is established silently at HEAD with no notice", async () => {
    // given
    const { repo, noticesDir, locksDir } = await fixture()
    await commit(repo, "system/persona.md", "seed persona\n", "seed persona")
    const head = await repo.head()

    // when
    const notice = await consumeSoulNoticeDelta(repo, { noticesDir, locksDir })

    // then
    expect(notice).toBeUndefined()
    expect(await readWatermark(noticesDir)).toEqual({ version: 1, lastNotifiedHead: head })
  })

  it("#given a watermark behind HEAD with an out-of-band persona commit #when consumed #then exactly one notice is emitted and the watermark advances", async () => {
    // given
    const { repo, noticesDir, locksDir } = await fixture()
    await commit(repo, "system/persona.md", "seed persona\n", "seed persona")
    const first = await consumeSoulNoticeDelta(repo, { noticesDir, locksDir })
    expect(first).toBeUndefined()
    const soulSha = await commit(
      repo,
      "system/persona.md",
      "reflected persona\n",
      "chore(reflection): merge run abc\n\nOmo-Writer: reflection",
    )

    // when
    const notice = await consumeSoulNoticeDelta(repo, { noticesDir, locksDir })
    const replay = await consumeSoulNoticeDelta(repo, { noticesDir, locksDir })

    // then
    expect(notice).toEqual({ sha: soulSha, subject: "chore(reflection): merge run abc" })
    expect(replay).toBeUndefined()
    expect(await readWatermark(noticesDir)).toEqual({ version: 1, lastNotifiedHead: soulSha })
  })

  it("#given only in-band memory-tool soul commits since the watermark #when consumed #then no notice is emitted and the watermark stays put", async () => {
    // given
    const { repo, noticesDir, locksDir } = await fixture()
    await commit(repo, "system/persona.md", "seed persona\n", "seed persona")
    await consumeSoulNoticeDelta(repo, { noticesDir, locksDir })
    const established = await readWatermark(noticesDir)
    await commit(repo, "system/persona.md", "in-band edit\n", `edit my soul\n\n${IN_BAND}`)

    // when
    const notice = await consumeSoulNoticeDelta(repo, { noticesDir, locksDir })

    // then
    expect(notice).toBeUndefined()
    expect(await readWatermark(noticesDir)).toEqual(established)
  })

  it("#given an out-of-band commit that touches only non-soul paths #when consumed #then no notice is emitted", async () => {
    // given
    const { repo, noticesDir, locksDir } = await fixture()
    await commit(repo, "system/persona.md", "seed persona\n", "seed persona")
    await consumeSoulNoticeDelta(repo, { noticesDir, locksDir })
    await commit(repo, "notes/facts/2026-08.md", "- fact\n", "chore(facts): apply batch\n\nOmo-Writer: facts-extractor")

    // when
    const notice = await consumeSoulNoticeDelta(repo, { noticesDir, locksDir })

    // then
    expect(notice).toBeUndefined()
  })

  it("#given an out-of-band identity.md commit mixed with an in-band persona commit #when consumed #then the notice names the out-of-band commit", async () => {
    // given
    const { repo, noticesDir, locksDir } = await fixture()
    await commit(repo, "system/persona.md", "seed persona\n", "seed persona")
    await consumeSoulNoticeDelta(repo, { noticesDir, locksDir })
    await commit(repo, "system/persona.md", "in-band edit\n", `edit my soul\n\n${IN_BAND}`)
    const dreamSha = await commit(
      repo,
      "system/identity.md",
      "- Name: Ada\n",
      "chore(dream): consolidate\n\nOmo-Writer: dream",
    )

    // when
    const notice = await consumeSoulNoticeDelta(repo, { noticesDir, locksDir })

    // then
    expect(notice).toEqual({ sha: dreamSha, subject: "chore(dream): consolidate" })
  })

  it("#given a corrupt watermark file #when consumed #then it re-establishes silently at HEAD", async () => {
    // given
    const { repo, noticesDir, locksDir } = await fixture()
    const head = await commit(repo, "system/persona.md", "seed persona\n", "seed persona")
    await writeFile(join(noticesDir, "soul-head.json"), "not json at all", "utf8")

    // when
    const notice = await consumeSoulNoticeDelta(repo, { noticesDir, locksDir })

    // then
    expect(notice).toBeUndefined()
    expect(await readWatermark(noticesDir)).toEqual({ version: 1, lastNotifiedHead: head })
  })

  it("#given a watermark naming a sha that history no longer contains #when consumed #then it re-establishes silently at HEAD", async () => {
    // given
    const { repo, noticesDir, locksDir } = await fixture()
    const head = await commit(repo, "system/persona.md", "seed persona\n", "seed persona")
    await writeFile(
      join(noticesDir, "soul-head.json"),
      `${JSON.stringify({ version: 1, lastNotifiedHead: "0".repeat(40) })}\n`,
      "utf8",
    )

    // when
    const notice = await consumeSoulNoticeDelta(repo, { noticesDir, locksDir })

    // then
    expect(notice).toBeUndefined()
    expect(await readWatermark(noticesDir)).toEqual({ version: 1, lastNotifiedHead: head })
  })
})
