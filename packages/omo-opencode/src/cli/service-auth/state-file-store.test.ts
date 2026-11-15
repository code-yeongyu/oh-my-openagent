import { describe, expect, onTestFinished, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { chmod, lstat, mkdir, readdir, readFile, stat, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import {
  createStateFileStore,
  dirRefusal,
  fileRefusal,
  stateFileDirectory,
  StateFileRefused,
  writeStateFile,
} from "./state-file-store"
import { temporaryHome } from "./test-support"

const uid = process.getuid?.() ?? 0
const codec = {
  parse: (text: string) => JSON.parse(text) as { readonly token: string },
  serialize: (value: { readonly token: string }) => JSON.stringify(value),
}
const secret = { token: "synthetic-state-file-secret" }

async function fileStore(home: string) {
  const lines: string[] = []
  const store = createStateFileStore({
    api: "https://api.omo.dev",
    name: "omo-cli-test.json",
    home,
    codec,
    failure: (message) => new Error(message),
    log: (line) => lines.push(line),
  })
  return { store, lines, dir: stateFileDirectory(home), file: join(stateFileDirectory(home), "omo-cli-test.json") }
}

describe.skipIf(process.platform === "win32")("the Linux sign-in state file (#7185b)", () => {
  test("#given a wide umask #when a sign-in is written #then the dir is 0700 and the file 0600", async () => {
    const home = await temporaryHome()
    const { store, dir, file } = await fileStore(home)
    const umask = process.umask(0)
    onTestFinished(() => {
      process.umask(umask)
    })
    await store.write(secret)
    expect((await stat(dir)).mode & 0o777).toBe(0o700)
    expect((await stat(file)).mode & 0o777).toBe(0o600)
    expect(await store.read()).toEqual(secret)
  })

  test("#when a write replaces the file #then no temp file is left beside it", async () => {
    const home = await temporaryHome()
    const { store, dir } = await fileStore(home)
    await store.write(secret)
    await store.write({ token: "second" })
    expect(await readdir(dir)).toEqual(["omo-cli-test.json"])
    expect(await store.read()).toEqual({ token: "second" })
  })

  test("#given a group- or world-open file #then it is refused, read as signed out, with one line and no content", async () => {
    for (const mode of [0o640, 0o604, 0o620, 0o602]) {
      const home = await temporaryHome()
      const { store, file, lines } = await fileStore(home)
      await store.write(secret)
      await chmod(file, mode)
      expect(await store.read()).toBeNull()
      expect(lines).toHaveLength(1)
      expect(lines[0]).toContain("open")
      expect(lines.join("\n")).not.toContain(secret.token)
    }
  })

  test("#given a symlink in the file's place #then its target is never read", async () => {
    const home = await temporaryHome()
    const { store, dir, file, lines } = await fileStore(home)
    await mkdir(dir, { recursive: true, mode: 0o700 })
    const target = join(home, "elsewhere.json")
    await writeFile(target, JSON.stringify(secret), { mode: 0o600 })
    await symlink(target, file)
    expect(await store.read()).toBeNull()
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain("symlink")
    await store.clear()
    expect(await lstat(file).catch(() => null)).toBeNull()
    expect(await readFile(target, "utf8")).toBe(JSON.stringify(secret))
  })

  test.skipIf(spawnSync("mkfifo", ["--version"]).status !== 0)(
    "#given a FIFO in the file's place #then it is refused without blocking",
    async () => {
      const home = await temporaryHome()
      const { store, dir, file, lines } = await fileStore(home)
      await mkdir(dir, { recursive: true, mode: 0o700 })
      expect(spawnSync("mkfifo", ["-m", "600", file]).status).toBe(0)
      expect(await store.read()).toBeNull()
      expect(lines[0]).toContain("not-a-file")
    },
  )

  test("#given an open directory #then a read is refused and a write writes nothing", async () => {
    const home = await temporaryHome()
    const { store, dir, file, lines } = await fileStore(home)
    await store.write(secret)
    await chmod(dir, 0o755)
    expect(await store.read()).toBeNull()
    expect(lines[0]).toContain("dir-open")
    await chmod(file, 0o600)
    await expect(writeStateFile(dir, "other.json", "x", uid)).rejects.toBeInstanceOf(StateFileRefused)
    expect(await readdir(dir)).toEqual(["omo-cli-test.json"])
    await expect(store.write({ token: "replaced" })).rejects.toThrow("dir-open")
  })

  test("#given a directory in the file's place or a file in the dir's place #then both are refused", async () => {
    const home = await temporaryHome()
    const { store, file, lines } = await fileStore(home)
    await mkdir(file, { recursive: true, mode: 0o700 })
    expect(await store.read()).toBeNull()
    expect(lines[0]).toContain("not-a-file")
    const other = await temporaryHome()
    await mkdir(join(other, ".omo"), { recursive: true })
    await writeFile(stateFileDirectory(other), "not a dir", { mode: 0o600 })
    const second = await fileStore(other)
    expect(await second.store.read()).toBeNull()
    expect(second.lines[0]).toContain("dir-not-a-directory")
  })

  test("#then another user's file or dir is refused, judged on the stat alone", async () => {
    const home = await temporaryHome()
    const { store, dir, file } = await fileStore(home)
    await store.write(secret)
    expect(fileRefusal(await stat(file), uid)).toBeUndefined()
    expect(fileRefusal(await stat(file), uid + 1)).toBe("other-owner")
    expect(dirRefusal(await stat(dir), uid)).toBeUndefined()
    expect(dirRefusal(await stat(dir), uid + 1)).toBe("dir-other-owner")
    expect(dirRefusal(await stat(file), uid)).toBe("dir-not-a-directory")
    expect(fileRefusal(await stat(dir), uid)).toBe("not-a-file")
  })

  test("#when cleared #then the file is gone and a read is signed out", async () => {
    const home = await temporaryHome()
    const { store, file } = await fileStore(home)
    await store.write(secret)
    expect(await store.present()).toBe(true)
    await store.clear()
    expect(await lstat(file).catch(() => null)).toBeNull()
    expect(await store.present()).toBe(false)
    expect(await store.read()).toBeNull()
  })
})
