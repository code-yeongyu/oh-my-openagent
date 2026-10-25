import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { removeTreeSync } from "./test-support/remove-tree"
import { removeAbandonedRunRoots } from "./test-temp-root"

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
