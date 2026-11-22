import { expect, it } from "bun:test"
import { join } from "node:path"
import { runOnDevice, type MemoryDeviceFiles } from "../fs/device-scope"
import { GitMemoryRepo } from "../git"
import { recordPendingRollback, settlePendingRollback } from "../git/pending-rollback"
import { StrandedGitLockError } from "../git/repo-lock-sweep"
import { undoBehindKeptLock } from "./rollback-behind-lock"

function fixture() {
  const entries = new Map<string, Uint8Array>()
  const read = async (path: string) => {
    const bytes = entries.get(path)
    if (!bytes) throw Object.assign(new Error(path), { code: "not_found" })
    return bytes
  }
  const unused = async (): Promise<never> => { throw new Error("unexpected device operation") }
  const files: MemoryDeviceFiles = {
    read,
    write: async (path, bytes) => { entries.set(path, bytes) },
    remove: async (path) => { entries.delete(path) },
    stat: async (path) => ({ kind: "file", size: (await read(path)).length, mtimeMs: 0 }),
    mkdir: unused, list: unused, rename: unused, run: unused,
  }
  const repo = new class extends GitMemoryRepo {
    staged = true
    override async status() { return this.staged ? "A  note.md\n" : "" }
    override async head() { return "before" }
    override async lsTree() { return [] }
    override async unstage(_tracked: readonly string[], untracked: readonly string[]) {
      expect(untracked).toEqual(["note.md"])
      this.staged = false
    }
  }({ dir: join("device", "repo"), agentId: "split" })
  return { entries, files, repo }
}

it("reports dirty markdown on the device with its encoding diagnostic", async () => {
  const { entries, files, repo } = fixture()
  entries.set(join(repo.dir, "note.md"), Uint8Array.of(0xff, 0xfe))
  await expect(runOnDevice(files, () => repo.cleanCheck())).rejects.toThrow("note.md has UTF-16 LE BOM")
})

it("settles the device rollback marker once the index is free", async () => {
  const { entries, files, repo } = fixture()
  await runOnDevice(files, async () => {
    await recordPendingRollback(repo.dir, { head: "before", paths: ["note.md"] })
    await settlePendingRollback(repo)
  })
  expect(repo.staged).toBe(false)
  expect(entries.size).toBe(0)
})

it("preserves a held device index and records the pending staged rollback", async () => {
  const { entries, files, repo } = fixture()
  const indexLock = join(repo.dir, ".git", "index.lock")
  const note = join(repo.dir, "note.md")
  entries.set(indexLock, Uint8Array.of(1))
  entries.set(note, Uint8Array.of(2))
  const kept = new StrandedGitLockError([{ path: "index.lock", reason: "open-holder" }])
  await expect(runOnDevice(files, () => undoBehindKeptLock(repo, ["note.md"], kept))).rejects.toThrow("still staged")
  expect(entries.has(indexLock)).toBe(true)
  expect(entries.has(note)).toBe(false)
  expect(JSON.parse(new TextDecoder().decode(entries.get(join(repo.dir, ".git", "omo-pending-rollback.json")))))
    .toEqual({ head: "before", paths: ["note.md"] })
})
