import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { join, resolve, sep } from "node:path"
import { chooseBaseDir, type BaseDirIO } from "./base-dir"

// chooseBaseDir resolves its inputs before walking, so the fakes compare
// resolved platform forms instead of literal POSIX spellings.
const home = resolve("/home/test")
const repo = resolve("/volume/repo")
const volume = resolve("/volume")
const id = "task-one"
const segment = `t${createHash("sha1").update(repo + id).digest("hex").slice(0, 10)}`
const onVolume = (path: string) => {
  const resolved = resolve(path)
  return resolved === volume || resolved.startsWith(volume + sep)
}
const sameDevice: BaseDirIO = {
  stat: async () => ({ dev: 1 }),
  writable: async () => { throw new Error("same-device selection must not probe volume") },
}
test("chooses the home directory on the same device", async () => {
  expect(await chooseBaseDir(repo, home, id, sameDevice)).toEqual({
    baseDir: join(home, ".omo/wt", segment), crossDevice: false,
  })
})
test("chooses the mount root on a different writable device", async () => {
  const io: BaseDirIO = {
    stat: async (path) => ({ dev: onVolume(path) ? 2 : 1 }),
    writable: async (path) => resolve(path) === join(volume, ".omo-wt"),
  }
  expect(await chooseBaseDir(repo, home, id, io)).toEqual({
    baseDir: join(volume, ".omo-wt", segment), crossDevice: false,
  })
})
test("flags cross-device home fallback when volume is not writable", async () => {
  expect(await chooseBaseDir(repo, home, id, {
    stat: async (path) => ({ dev: onVolume(path) ? 2 : 1 }),
    writable: async () => false,
  })).toEqual({ baseDir: join(home, ".omo/wt", segment), crossDevice: true })
})
test("different task ids get different paths without interpolating the id", async () => {
  const first = await chooseBaseDir(repo, home, "../escape", sameDevice)
  const second = await chooseBaseDir(repo, home, "other", sameDevice)
  expect(first.baseDir).not.toEqual(second.baseDir)
  expect(first.baseDir.startsWith(join(home, ".omo", "wt"))).toBe(true)
  expect(first.baseDir).toMatch(/t[0-9a-f]{10}$/)
  expect(first.baseDir).not.toContain("escape")
})

test("never places the base directory inside a subvolume-style repository root", async () => {
  // The repository root reports its own device (btrfs subvolume, zfs dataset,
  // bind mount): the same-device walk must not stop at the repository itself
  // and sandbox the clone inside the tree being cloned.
  const io: BaseDirIO = {
    stat: async (path) => (resolve(path) === repo ? { dev: 7 } : onVolume(path) ? { dev: 9 } : { dev: 1 }),
    writable: async () => true,
  }
  const selection = await chooseBaseDir(repo, home, id, io)
  expect(selection.baseDir).not.toContain(repo)
  expect(selection).toEqual({ baseDir: join(volume, ".omo-wt", segment), crossDevice: false })
})

test("falls back home cross-device when a subvolume-style root has no writable ancestor outside it", async () => {
  const io: BaseDirIO = {
    stat: async (path) => (resolve(path) === repo ? { dev: 7 } : onVolume(path) ? { dev: 9 } : { dev: 1 }),
    writable: async (path) => resolve(path).startsWith(repo + sep),
  }
  const selection = await chooseBaseDir(repo, home, id, io)
  expect(selection.baseDir).not.toContain(repo)
  expect(selection).toEqual({ baseDir: join(home, ".omo/wt", segment), crossDevice: true })
})
