import { afterEach, describe, expect, it, spyOn } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { removeTree } from "../../../../test-support/remove-tree"
import { consumeAgreementsNoticeDelta } from "../agreements/notice-watermark"
import * as fs from "../fs/resilient"
import { GitMemoryRepo } from "../git"
import * as durability from "../journal/fsync"
import { consumeSoulNoticeDelta } from "../soul/watermark"

const roots: string[] = []
const AUTHOR = { agentId: "watermark-failure", authorName: "Watermark Failure Test" }

afterEach(async () => {
  for (const root of roots.splice(0)) await removeTree(root)
})

async function fixture(kind: "agreements" | "soul") {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "watermark-failure-")))
  roots.push(root)
  const repo = new GitMemoryRepo({ dir: join(root, "repo"), agentId: AUTHOR.agentId })
  await repo.init()
  await mkdir(join(repo.dir, "system"), { recursive: true })
  const warnings: unknown[][] = []
  const options = { noticesDir: join(root, "notices"), locksDir: join(root, "locks") }
  const withWarn = { ...options, onWarn: (...args: unknown[]) => { warnings.push(args) } }
  const consume = async () => kind === "agreements"
    ? (await consumeAgreementsNoticeDelta(repo, withWarn)).map((item) => item.id)
    : (await consumeSoulNoticeDelta(repo, withWarn))?.sha
  const path = kind === "agreements" ? "system/agreements.md" : "system/persona.md"
  const body = kind === "agreements"
    ? "- [global] Keep notices <!-- id: 3f9a1c0b2e; by: agent; n: 3; status: needs-human -->"
    : "changed persona"
  if (kind === "soul") await consume()
  await writeFile(join(repo.dir, path), `---\ndescription: Notice fixture\n---\n\n${body}\n`)
  await repo.commitWrite([path], "fresh notice", AUTHOR)
  const head = await repo.head()
  if (head === null) throw new Error("fixture commit produced no HEAD")
  const expected = kind === "agreements" ? ["3f9a1c0b2e"] : head
  return { ...options, warnings, consume, expected, empty: kind === "agreements" ? [] : undefined }
}

for (const kind of ["agreements", "soul"] as const) {
  describe(`${kind} watermark publication failures`, () => {
    it.each(["write", "rename"] as const)(
      "#given a %s failure #when publication aborts #then no temporary file remains",
      async (operation) => {
        // given: fail only this watermark's publication, after a real partial write.
        const f = await fixture(kind)
        const failure = Object.assign(new Error("injected publication failure"), { code: "EIO" })
        const write = fs.writeFile
        const rename = fs.rename
        const intercepted = operation === "write"
          ? spyOn(fs, "writeFile").mockImplementation(async (path, data, options) => {
            if (typeof path !== "string" || dirname(path) !== f.noticesDir) return write(path, data, options)
            await write(path, "{", options)
            throw failure
          })
          : spyOn(fs, "rename").mockImplementation(async (from, to) => {
            if (dirname(String(to)) !== f.noticesDir) return rename(from, to)
            throw failure
          })
        let caught: unknown
        try {
          // when
          try { await f.consume() } catch (error) { caught = error }
        } finally {
          intercepted.mockRestore()
        }
        // then: the pre-publish error propagates and a later turn can still announce.
        expect(caught).toBe(failure)
        expect((await readdir(f.noticesDir)).filter((name) => name.includes(".tmp-"))).toEqual([])
        expect(await f.consume()).toEqual(f.expected)
      },
    )

    it("#given rename and cleanup both fail #when publication aborts #then the original rename error surfaces", async () => {
      // given
      const f = await fixture(kind)
      const failure = Object.assign(new Error("injected rename failure"), { code: "EIO" })
      const cleanup = Object.assign(new Error("injected cleanup failure"), { code: "EACCES" })
      const rename = fs.rename
      const remove = fs.rm
      const renameSpy = spyOn(fs, "rename").mockImplementation(async (from, to) => {
        if (dirname(String(to)) !== f.noticesDir) return rename(from, to)
        throw failure
      })
      const rmSpy = spyOn(fs, "rm").mockImplementation(async (path, options) => {
        if (!String(path).includes(".tmp-")) return remove(path, options)
        throw cleanup
      })
      let caught: unknown
      try {
        // when
        try { await f.consume() } catch (error) { caught = error }
      } finally {
        renameSpy.mockRestore()
        rmSpy.mockRestore()
      }
      // then
      expect(caught).toBe(failure)
    })

    it("#given directory-sync EIO after rename #when consumed #then the warning reaches onWarn, not console.warn", async () => {
      // given
      const f = await fixture(kind)
      const sync = durability.syncJournalDirectory
      const intercepted = spyOn(durability, "syncJournalDirectory").mockImplementation(async (dir) => {
        if (dir !== f.noticesDir) return sync(dir)
        throw Object.assign(new Error("injected directory sync failure"), { code: "EIO" })
      })
      const warn = spyOn(console, "warn").mockImplementation(() => undefined)
      try {
        // when
        await f.consume()
      } finally {
        intercepted.mockRestore()
      }
      const consoleCalls = warn.mock.calls.length
      warn.mockRestore()
      // then
      expect(consoleCalls).toBe(0)
      expect(f.warnings).toHaveLength(1)
      expect(String(f.warnings[0]?.[0])).toContain("directory sync failed")
    })

    it("#given directory-sync EIO after rename #when consumed #then the fresh notice survives without replay", async () => {
      // given: keep the real flushed write and rename, fail only directory durability.
      const f = await fixture(kind)
      const sync = durability.syncJournalDirectory
      let syncCalls = 0
      const intercepted = spyOn(durability, "syncJournalDirectory").mockImplementation(async (dir) => {
        if (dir !== f.noticesDir) return sync(dir)
        syncCalls += 1
        throw Object.assign(new Error("injected directory sync failure"), { code: "EIO" })
      })
      let fresh: unknown
      let caught: unknown
      try {
        // when
        try { fresh = await f.consume() } catch (error) { caught = error }
      } finally {
        intercepted.mockRestore()
      }
      const next = await f.consume()
      // then
      expect(caught).toBeUndefined()
      expect(fresh).toEqual(f.expected)
      expect(next).toEqual(f.empty)
      expect(syncCalls).toBe(1)
    })
  })
}
