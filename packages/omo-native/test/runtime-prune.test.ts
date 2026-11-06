import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pruneProvisionedRuntimes, removeReplacedLauncher } from "../runtime-prune"
import { removeTree } from "../../../test-support/remove-tree"

let root: string

function provision(...versions: string[]): void {
  for (const version of versions) {
    mkdirSync(join(root, version), { recursive: true })
    writeFileSync(join(root, version, "omo"), version)
  }
}

const present = (version: string) => existsSync(join(root, version))

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "omo-runtime-prune-"))
})

afterEach(() => removeTree(root))

describe("pruneProvisionedRuntimes", () => {
  test("#given older, newer and in-use runtimes #when a fresh runtime prunes #then only idle runtimes older than the rollback one are removed", () => {
    // given
    provision("5.1.40", "5.1.56", "5.1.60", "5.1.61", "5.1.62", "5.2.0", "handoff-fixture")
    const running = [`${join(root, "5.1.40", "omo")} --mode rpc`, "/usr/bin/zsh"]
    // when
    const result = pruneProvisionedRuntimes({ root, current: "5.1.62", platform: "linux", listRunning: () => running })
    // then
    expect(result.removed.toSorted()).toEqual(["5.1.56", "5.1.60"])
    expect(result.kept.toSorted()).toEqual(["5.1.40", "5.1.61"])
    expect(result.failed).toEqual([])
    for (const kept of ["5.1.40", "5.1.61", "5.1.62", "5.2.0", "handoff-fixture"]) expect(present(kept)).toBe(true)
    for (const removed of ["5.1.56", "5.1.60"]) expect(present(removed)).toBe(false)
  })

  test("#given the running processes cannot be listed #when a fresh runtime prunes #then nothing is removed", () => {
    // given
    provision("5.1.40", "5.1.60", "5.1.61", "5.1.62")
    // when
    const result = pruneProvisionedRuntimes({ root, current: "5.1.62", platform: "linux", listRunning: () => undefined })
    // then
    expect(result.removed).toEqual([])
    expect(result.kept.toSorted()).toEqual(["5.1.40", "5.1.60", "5.1.61"])
    for (const version of ["5.1.40", "5.1.60", "5.1.61"]) expect(present(version)).toBe(true)
  })

  test("#given only the rollback runtime is older #when a fresh runtime prunes #then it never lists processes", () => {
    // given
    provision("5.1.61", "5.1.62")
    let listed = 0
    // when
    const result = pruneProvisionedRuntimes({ root, current: "5.1.62", platform: "linux", listRunning: () => { listed += 1; return [] } })
    // then
    expect(result).toEqual({ removed: [], kept: ["5.1.61"], failed: [] })
    expect(listed).toBe(0)
  })

  test("#given beta runtimes #when the stable release prunes #then prerelease versions order below their release", () => {
    // given
    provision("5.0.0-0.beta.89", "5.0.0-0.beta.90", "5.0.0")
    // when
    const result = pruneProvisionedRuntimes({ root, current: "5.0.0", platform: "linux", listRunning: () => [] })
    // then
    expect(result.removed).toEqual(["5.0.0-0.beta.89"])
    expect(result.kept).toEqual(["5.0.0-0.beta.90"])
  })

  test("#given Windows #when a fresh runtime prunes #then it lists no processes and leaves an open runtime to the rename lock", () => {
    // given
    provision("5.1.40", "5.1.61", "5.1.62")
    let listed = 0
    // when
    const result = pruneProvisionedRuntimes({ root, current: "5.1.62", platform: "win32", listRunning: () => { listed += 1; return undefined } })
    // then: nothing here holds 5.1.40 open, so the rename succeeds and it goes
    expect(listed).toBe(0)
    expect(result.removed).toEqual(["5.1.40"])
  })

  test("#given a prune interrupted after its rename #when the next fresh runtime prunes #then the leftover tree is removed", () => {
    // given
    provision(".prune-5.1.40-4242", "5.1.62")
    // when
    pruneProvisionedRuntimes({ root, current: "5.1.62", platform: "linux", listRunning: () => [] })
    // then
    expect(present(".prune-5.1.40-4242")).toBe(false)
    expect(present("5.1.62")).toBe(true)
  })

  test("#given no runtime root #when a fresh runtime prunes #then it reports nothing", () => {
    expect(pruneProvisionedRuntimes({ root: join(root, "missing"), current: "5.1.62", platform: "linux" })).toEqual({ removed: [], kept: [], failed: [] })
  })
})

describe("removeReplacedLauncher", () => {
  test("#given the launcher a Windows replace command moved aside #when the new version first runs #then the .old file is removed", () => {
    // given
    const launcher = join(root, "omo.exe")
    writeFileSync(`${launcher}.old`, "old")
    // when
    removeReplacedLauncher(launcher, "win32")
    // then
    expect(existsSync(`${launcher}.old`)).toBe(false)
  })

  test("#given a POSIX launcher #when the new version first runs #then a file named .old is left alone", () => {
    // given
    const launcher = join(root, "omo")
    writeFileSync(`${launcher}.old`, "user file")
    // when
    removeReplacedLauncher(launcher, "linux")
    // then
    expect(existsSync(`${launcher}.old`)).toBe(true)
  })
})
