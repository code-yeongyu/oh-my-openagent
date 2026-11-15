import { afterEach, describe, expect, test } from "bun:test"
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { remoteOptOut } from "../remote-opt-out"

// Security contract (omo#13602 review): the opt-out record is written without following links, so a symlink planted at
// the path or as ~/.omo can never redirect the write onto another file; anything at the path that is not a regular
// file reads as opted out.

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const home = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "optout-"))
  dirs.push(dir)
  return dir
}

describe("the remote sessions opt-out record", () => {
  test("record writes a 0600 regular file that reads as opted out; clear removes it", () => {
    const path = join(home(), ".omo", "remote-sessions.json")
    const optOut = remoteOptOut(path)
    expect(optOut.read()).toBe(false)
    optOut.record()
    expect([lstatSync(path).isFile(), lstatSync(path).mode & 0o777, optOut.read()]).toEqual([true, 0o600, true])
    expect(JSON.parse(readFileSync(path, "utf8")).remote_sessions).toBe("off")
    optOut.clear()
    expect(optOut.read()).toBe(false)
  })

  test("a symlink planted at the path is replaced, and the file it points at is left untouched", () => {
    const root = home()
    const victim = join(root, "victim")
    writeFileSync(victim, "do not touch\n")
    mkdirSync(join(root, ".omo"))
    const path = join(root, ".omo", "remote-sessions.json")
    symlinkSync(victim, path)
    expect(remoteOptOut(path).read()).toBe(true)
    remoteOptOut(path).record()
    expect(readFileSync(victim, "utf8")).toBe("do not touch\n")
    expect([lstatSync(path).isSymbolicLink(), lstatSync(path).isFile()]).toEqual([false, true])
  })

  test("a ~/.omo that is a symlink makes the write refuse instead of writing through it", () => {
    const root = home()
    const elsewhere = join(root, "elsewhere")
    mkdirSync(elsewhere)
    symlinkSync(elsewhere, join(root, ".omo"))
    expect(() => remoteOptOut(join(root, ".omo", "remote-sessions.json")).record()).toThrow()
    expect(() => lstatSync(join(elsewhere, "remote-sessions.json"))).toThrow()
  })

  test("clear on a planted symlink removes the link, never its target", () => {
    const root = home()
    const victim = join(root, "victim")
    writeFileSync(victim, "keep\n")
    mkdirSync(join(root, ".omo"))
    const path = join(root, ".omo", "remote-sessions.json")
    symlinkSync(victim, path)
    remoteOptOut(path).clear()
    expect([readFileSync(victim, "utf8"), remoteOptOut(path).read()]).toEqual(["keep\n", false])
  })
})
