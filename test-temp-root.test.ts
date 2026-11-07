import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { type ChildProcess, spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { removeTreeSync } from "./test-support/remove-tree"
import { removeAbandonedRunRoots, removeRunRootAside } from "./test-temp-root"

describe("test temp root teardown", () => {
  test("#given a removed run root #when another child starts #then temp variables point to the original live directories", () => {
    const script = `
      import { existsSync } from "node:fs";
      const names = ["TMPDIR", "TEMP", "TMP"];
      const previous = names.map(name => process.env[name]);
      const { runTestTempRootTeardown } = await import(${JSON.stringify(join(import.meta.dir, "test-temp-root.ts"))});
      const root = process.env.TEMP;
      runTestTempRootTeardown();
      if (existsSync(root)) throw new Error("run root was not removed");
      const child = Bun.spawnSync([process.execPath, "-e", ${JSON.stringify(`
        const fs = require("node:fs");
        if (!fs.existsSync(process.env.TEMP ?? process.env.TMP ?? "")) {
          console.error("bash.exe: warning: could not find /tmp, please create!");
          process.exit(1);
        }
      `)}], { env: process.env, stdout: "pipe", stderr: "pipe" });
      if (child.exitCode !== 0) throw new Error(child.stderr.toString());
      if (names.some((name, index) => process.env[name] !== previous[index])) {
        throw new Error("temp environment was not restored exactly");
      }
    `
    const result = spawnSync(process.execPath, ["-e", script], {
      cwd: import.meta.dir,
      env: process.env,
      encoding: "utf8",
      timeout: 20_000,
    })
    expect(result.error).toBeUndefined()
    expect(result.stderr).toBe("")
    expect(result.status).toBe(0)
  })
})

describe("removeAbandonedRunRoots", () => {
  const fixtures: string[] = []
  afterEach(() => {
    for (const fixture of fixtures.splice(0)) removeTreeSync(fixture)
  })

  function fixtureRoot(): string {
    const fixture = mkdtempSync(join(tmpdir(), "omo-root-sweep-"))
    fixtures.push(fixture)
    return fixture
  }

  function abandonedRoot(parent: string, name: string): string {
    const root = join(parent, `omo-test-run-${name}`)
    mkdirSync(root)
    const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
    utimesSync(root, old, old)
    return root
  }

  for (const code of ["EBUSY", "EPERM", "ENOTEMPTY", "EACCES"]) {
    test(`#given an abandoned root held with ${code} #when swept #then it remains and other roots are removed`, () => {
      const fixture = fixtureRoot()
      abandonedRoot(fixture, "a")
      abandonedRoot(fixture, "b")
      const [held, removable] = readdirSync(fixture).map((entry) => join(fixture, entry))
      if (!held || !removable) throw new Error("missing abandoned root fixtures")
      const attempted: string[] = []
      const error = Object.assign(new Error(code), { code })
      const warnings = spyOn(console, "warn").mockImplementation(() => {})

      try {
        expect(() => removeAbandonedRunRoots(fixture, (root) => {
          attempted.push(root)
          if (root === held) throw error
          removeTreeSync(root)
        })).not.toThrow()
        const reports = warnings.mock.calls
          .filter(([kind]) => kind === "SKIPPED_TEST_TEMP_ROOT")
          .map(([, record]) => JSON.parse(String(record)))
        expect(reports).toContainEqual(expect.objectContaining({ root: held, code }))
      } finally {
        warnings.mockRestore()
      }

      expect(attempted.sort()).toEqual([held, removable].sort())
      expect(existsSync(held)).toBe(true)
      expect(existsSync(removable)).toBe(false)

      removeAbandonedRunRoots(fixture)
      expect(existsSync(held)).toBe(false)
    })
  }

  test("#given a non-lock removal error #when swept #then the same error surfaces", () => {
    const fixture = fixtureRoot()
    abandonedRoot(fixture, "broken")
    const error = Object.assign(new Error("device I/O error"), { code: "EIO" })
    let caught: unknown
    try {
      removeAbandonedRunRoots(fixture, () => { throw error })
    } catch (failure) {
      caught = failure
    }
    expect(caught).toBe(error)
  })

  test("#given a live root and an unrelated directory #when swept #then neither is removed", () => {
    const fixture = fixtureRoot()
    const live = abandonedRoot(fixture, "live")
    writeFileSync(join(live, ".owner-pid"), String(process.pid))
    const unrelated = join(fixture, "unrelated")
    mkdirSync(unrelated)
    const attempted: string[] = []

    removeAbandonedRunRoots(fixture, (root) => { attempted.push(root) })

    expect(attempted).toEqual([])
    expect(existsSync(live)).toBe(true)
    expect(existsSync(unrelated)).toBe(true)
  })
})

describe("removeRunRootAside (#11630)", () => {
  const fixtures: string[] = []
  afterEach(() => {
    for (const fixture of fixtures.splice(0)) removeTreeSync(fixture)
  })

  // Stands for the OS temp dir of a lane that keeps its bun caches there, beside one run's root.
  function tempDirWithCachesAndRoot(files: number): { readonly tempDir: string; readonly cache: string; readonly root: string } {
    const tempDir = mkdtempSync(join(tmpdir(), "omo-aside-"))
    fixtures.push(tempDir)
    const cache = join(tempDir, "bun-transpiler")
    const root = join(tempDir, "omo-test-run-big")
    for (const dir of [cache, root]) {
      for (let group = 0; group < 10; group++) {
        mkdirSync(join(dir, `g${group}`), { recursive: true })
        for (let file = 0; file < files / 10; file++) writeFileSync(join(dir, `g${group}`, `f${file}`), "x")
      }
    }
    writeFileSync(join(root, ".owner-pid"), String(process.pid))
    return { tempDir, cache, root }
  }

  test.skipIf(process.platform === "win32")(
    "#given a run root beside an unrelated cache tree #when it is removed aside #then its path empties at once, nothing else is touched, and the detached remover deletes it",
    async () => {
      const { tempDir, cache, root } = tempDirWithCachesAndRoot(200)

      const remover = removeRunRootAside(root)

      expect(existsSync(root)).toBe(false)
      if (remover === undefined) throw new Error("expected a detached remover")
      const code = remover.exitCode ?? (await new Promise<number | null>((resolve) => remover.once("exit", resolve)))
      expect(code).toBe(0)
      expect(readdirSync(tempDir)).toEqual(["bun-transpiler"])
      expect(readdirSync(cache).flatMap((group) => readdirSync(join(cache, group)))).toHaveLength(200)
    },
  )

  test.skipIf(process.platform === "win32")(
    "#given a remover that has not run yet #when the root is removed aside #then the caller returns without deleting anything itself",
    async () => {
      const { root } = tempDirWithCachesAndRoot(100)
      const removing: string[] = []

      const standIn = removeRunRootAside(root, (path) => {
        removing.push(path)
        return spawn("true")
      })
      if (standIn !== undefined && standIn.exitCode === null) await new Promise((resolve) => standIn.once("exit", resolve))

      expect(removing).toEqual([`${root}.removing`])
      expect(readdirSync(`${root}.removing`)).toHaveLength(11)
    },
  )

  test.skipIf(process.platform === "win32")(
    "#given an abandoned root #when swept without an injected remover #then it is renamed aside for a detached remover",
    async () => {
      const { tempDir, root } = tempDirWithCachesAndRoot(100)
      writeFileSync(join(root, ".owner-pid"), "999999999")
      const removers: ChildProcess[] = []

      removeAbandonedRunRoots(tempDir, undefined, (path) => {
        const remover = spawn("/bin/rm", ["-rf", path], { stdio: "ignore" })
        removers.push(remover)
        return remover
      })

      expect(existsSync(root)).toBe(false)
      expect(removers.map((remover) => remover.spawnargs.at(-1))).toEqual([`${root}.removing`])
      for (const remover of removers) {
        if (remover.exitCode === null) await new Promise((resolve) => remover.once("exit", resolve))
      }
      expect(readdirSync(tempDir)).toEqual(["bun-transpiler"])
    },
  )
})
