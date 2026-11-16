import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { findOnPath } from "./find-on-path"

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const pathDir = (...files: string[]) => {
  const dir = mkdtempSync(join(tmpdir(), "find-on-path-"))
  dirs.push(dir)
  for (const file of files) writeFileSync(join(dir, file), "")
  return dir
}

// #14003 review L2: npm installs an extensionless sh shim next to the .cmd a Windows process can run. CreateProcess runs
// only a name with a PATHEXT extension, so on win32 the .cmd must be chosen over the bare shim in the same directory.
describe("findOnPath on win32", () => {
  test("a directory with both bun and bun.cmd resolves to bun.cmd", () => {
    const dir = pathDir("bun", "bun.cmd")
    expect(findOnPath("bun", { PATH: dir, PATHEXT: ".COM;.EXE;.BAT;.CMD" }, "win32")).toBe(join(dir, "bun.cmd"))
  })

  test("a command named with its extension still resolves as written", () => {
    const dir = pathDir("node.exe")
    expect(findOnPath("node.exe", { PATH: dir, PATHEXT: ".COM;.EXE;.BAT;.CMD" }, "win32")).toBe(join(dir, "node.exe"))
  })
})
