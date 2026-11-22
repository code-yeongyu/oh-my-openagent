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
    // Windows has no POSIX mode bits (lstat reports 0o666), so the 0600 check applies on POSIX only
    expect([
      lstatSync(path).isFile(),
      process.platform === "win32" || (lstatSync(path).mode & 0o777) === 0o600,
      optOut.read(),
    ]).toEqual([true, true, true])
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

  // #13602 security review M2: a ~/.omo the user links to a directory they own (dotfiles, a relocated home) is theirs;
  // the record goes into that directory, still without following a link at the record's own path.
  test("a ~/.omo linked to a directory this user owns gets the record in that directory", () => {
    const root = home()
    const dotfiles = join(root, "dotfiles-omo")
    mkdirSync(dotfiles)
    symlinkSync(dotfiles, join(root, ".omo"))
    const optOut = remoteOptOut(join(root, ".omo", "remote-sessions.json"))
    optOut.record()
    expect([lstatSync(join(dotfiles, "remote-sessions.json")).isFile(), optOut.read()]).toEqual([true, true])
  })

  test("a ~/.omo linked to something that is not a directory makes the write refuse", () => {
    const root = home()
    const file = join(root, "not-a-dir")
    writeFileSync(file, "x\n")
    symlinkSync(file, join(root, ".omo"))
    expect(() => remoteOptOut(join(root, ".omo", "remote-sessions.json")).record()).toThrow()
    expect(readFileSync(file, "utf8")).toBe("x\n")
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
