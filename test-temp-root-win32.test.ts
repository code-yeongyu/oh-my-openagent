import { afterEach, describe, expect, test } from "bun:test"
import { type ChildProcess, spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { removeTreeSync } from "./test-support/remove-tree"
import { removeRunRootAside } from "./test-temp-root"

// The win32 branch is the one a Windows runner takes; this host reaches it by shadowing the platform for the
// call, which bun reads at call time. One file's tests run in order and the descriptor is restored before the
// next test starts, so no other case ever observes the shadow.
function withPlatform<T>(platform: NodeJS.Platform, run: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform")
  Object.defineProperty(process, "platform", { value: platform, configurable: true, enumerable: true })
  try {
    return run()
  } finally {
    if (descriptor !== undefined) Object.defineProperty(process, "platform", descriptor)
  }
}

// Stands in for the detached remover: what is under test is the path handed to it, never its own deletion.
function recordingRemover(handed: string[]): (path: string) => ChildProcess {
  return (path) => {
    handed.push(path)
    return spawn(process.execPath, ["-e", "0"], { stdio: "ignore" })
  }
}

describe("removeRunRootAside on win32 (#12209)", () => {
  const fixtures: string[] = []
  afterEach(() => {
    for (const fixture of fixtures.splice(0)) {
      if (existsSync(fixture)) removeTreeSync(fixture)
    }
  })

  function runRootFixture(entries: number): { readonly tempDir: string; readonly root: string } {
    const tempDir = mkdtempSync(join(tmpdir(), "omo-win-aside-"))
    fixtures.push(tempDir)
    const root = join(tempDir, "omo-test-run-big")
    mkdirSync(root)
    for (let entry = 0; entry < entries; entry++) writeFileSync(join(root, `f${entry}`), "x")
    writeFileSync(join(root, ".owner-pid"), String(process.pid))
    return { tempDir, root }
  }

  test("#given the win32 platform #when the run root is removed #then it is renamed aside for the remover and the caller deletes nothing itself", () => {
    const { root } = runRootFixture(20)
    const handed: string[] = []

    withPlatform("win32", () => removeRunRootAside(root, recordingRemover(handed)))

    expect(handed).toEqual([`${root}.removing`])
    expect(existsSync(root)).toBe(false)
    expect(readdirSync(`${root}.removing`)).toHaveLength(21)
  })

  // A held handle refuses the rename (EPERM/EBUSY on win32); a missing root refuses it with ENOENT on every
  // platform. Both leave the tree where it is, which is the only thing the refused-rename branch decides.
  test("#given the win32 platform and a root a refused rename leaves in place #when removed #then the remover is handed that root instead of the caller deleting it", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "omo-win-refused-"))
    fixtures.push(tempDir)
    const root = join(tempDir, "omo-test-run-held")
    const handed: string[] = []

    withPlatform("win32", () => removeRunRootAside(root, recordingRemover(handed)))

    expect(handed).toEqual([root])
  })

  test("#given the win32 platform #when the default remover is handed the aside root #then that remover deletes the whole tree", async () => {
    const { tempDir, root } = runRootFixture(200)

    const remover = withPlatform("win32", () => removeRunRootAside(root))
    if (remover === undefined) throw new Error("expected a detached remover")
    const code = remover.exitCode ?? (await new Promise<number>((resolve, reject) => {
      const deadline = setTimeout(
        () => reject(new Error(`waited 20s for the detached remover of ${dirname(root)} to exit, never did`)),
        20_000,
      )
      remover.once("exit", (value: number | null) => {
        clearTimeout(deadline)
        resolve(value ?? -1)
      })
    }))

    expect(code).toBe(0)
    expect(existsSync(`${root}.removing`)).toBe(false)
    expect(readdirSync(tempDir)).toEqual([])
  })
})
