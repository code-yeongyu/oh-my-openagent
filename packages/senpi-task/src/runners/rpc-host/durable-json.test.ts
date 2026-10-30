import { afterEach, describe, expect, spyOn, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { writeTextDurably } from "./durable-json"

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe("writeTextDurably", () => {
  test("#given a file replaced by rename #when the write returns #then the parent directory was fsynced after the rename (not on win32)", () => {
    // given
    const dir = fs.mkdtempSync(join(tmpdir(), "durable-json-"))
    dirs.push(dir)
    const path = join(dir, "index.json")
    const events: string[] = []
    const directoryFds = new Set<number>()
    const { openSync: realOpen, renameSync: realRename, fsyncSync: realFsync } = fs
    const spies = [
      spyOn(fs, "openSync").mockImplementation(((target: fs.PathLike, flags: fs.OpenMode, mode?: fs.Mode) => {
        const fd = realOpen(target, flags, mode)
        if (String(target) === dir) directoryFds.add(fd)
        return fd
      }) as typeof fs.openSync),
      spyOn(fs, "renameSync").mockImplementation((from: fs.PathLike, to: fs.PathLike) => {
        events.push("rename")
        realRename(from, to)
      }),
      spyOn(fs, "fsyncSync").mockImplementation((fd: number) => {
        events.push(directoryFds.has(fd) ? "fsync-directory" : "fsync-file")
        realFsync(fd)
      }),
    ]

    // when
    try {
      writeTextDurably(path, "{}\n")
    } finally {
      for (const spy of spies) spy.mockRestore()
    }

    // then
    expect(fs.readFileSync(path, "utf8")).toBe("{}\n")
    const expected = process.platform === "win32" ? ["fsync-file", "rename"] : ["fsync-file", "rename", "fsync-directory"]
    expect(events).toEqual(expected)
  })
})
