import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { describe, test } from "node:test"

import { checkAgentToolkitFresh, stageAgentToolkit } from "./stage-agent-toolkit.mjs"

async function cleanupDir(dir) {
  // Windows can keep a handle on a just-written file; retry instead of
  // letting afterEach hang until the 10s hook timeout.
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {})
}

async function makeFixture() {
  const root = await mkdtemp(join(tmpdir(), "omo-senpi-agent-toolkit-stage-test-"))
  const sourceEntry = join(root, "built", "cli.js")
  const directiveEntry = join(root, "built", "directive.md")
  const targetDir = join(root, "staged", "agent-toolkit")
  await mkdir(join(root, "built"), { recursive: true })
  await writeFile(sourceEntry, "#!/usr/bin/env node\nconsole.log('ulw-loop help')\n", "utf8")
  await writeFile(directiveEntry, "# Ultrawork\n", "utf8")
  await chmod(sourceEntry, 0o755)
  return { extraDirs: [], root, sourceEntry, directiveEntry, targetDir }
}

async function withFixture(run) {
  const fixture = await makeFixture()
  try {
    return await run(fixture)
  } finally {
    await Promise.all([fixture.root, ...fixture.extraDirs].map(cleanupDir))
  }
}

describe("agent-toolkit runtime staging", () => {
  test("#given a standalone ulw-loop bundle #when staged #then dispatcher and executable shims are self-contained", async () => {
    await withFixture(async (fixture) => {
      const result = await stageAgentToolkit({ ...fixture, buildBundle: false })

      const posixShim = join(fixture.targetDir, "omo-agent-toolkit")
      assert.equal(result.ok, true)
      // Windows has no POSIX execute bit, so stat reports 0o666 there no matter what chmod requested.
      if (process.platform !== "win32") {
        assert.equal((await stat(posixShim)).mode & 0o777, 0o755)
      }
      assert.equal(await readFile(posixShim, "utf8"), "#!/bin/sh\nexec node \"$(dirname \"$0\")/cli.js\" \"$@\"\n")
      assert.equal(await readFile(join(fixture.targetDir, "omo-agent-toolkit.cmd"), "utf8"), "@echo off\r\nnode \"%~dp0cli.js\" %*\r\n")
      const probeCwd = await mkdtemp(join(tmpdir(), "omo-senpi-agent-toolkit-probe-test-"))
      fixture.extraDirs.push(probeCwd)
      const probe = spawnSync(process.execPath, [join(fixture.targetDir, "cli.js"), "ulw-loop", "--help"], {
        cwd: probeCwd,
        encoding: "utf8",
      })
      assert.equal(probe.status, 0, probe.stderr)
    })
  })

  test("#given a staged toolkit #when freshness is checked #then runtime artifacts and source bytes must match", async () => {
    await withFixture(async (fixture) => {
      await stageAgentToolkit({ ...fixture, buildBundle: false })

      const result = await checkAgentToolkitFresh(fixture)

      assert.equal(result.ok, true)
      assert.equal(await readFile(join(fixture.targetDir, "ulw-loop", "cli.js"), "utf8"), await readFile(fixture.sourceEntry, "utf8"))
      assert.equal(await readFile(join(fixture.targetDir, "directive.md"), "utf8"), await readFile(fixture.directiveEntry, "utf8"))
    })
  })

  test("#given an identical staged toolkit #when staged again #then preserves the target directory identity", async () => {
    await withFixture(async (fixture) => {
      await stageAgentToolkit({ ...fixture, buildBundle: false })
      const before = await stat(fixture.targetDir)

      await stageAgentToolkit({ ...fixture, buildBundle: false })

      assert.equal((await stat(fixture.targetDir)).ino, before.ino)
    })
  })

  test("#given a malformed staged toolkit #when staged again #then replaces the stale directory shape", async () => {
    await withFixture(async (fixture) => {
      await stageAgentToolkit({ ...fixture, buildBundle: false })
      await rm(join(fixture.targetDir, "ulw-loop"), { recursive: true, force: true })
      await writeFile(join(fixture.targetDir, "ulw-loop"), "stale", "utf8")

      await stageAgentToolkit({ ...fixture, buildBundle: false })

      assert.equal(await readFile(join(fixture.targetDir, "ulw-loop", "cli.js"), "utf8"), await readFile(fixture.sourceEntry, "utf8"))
    })
  })

  test("#given a partial Windows backup copy #when staging fails #then removes backup debris and preserves the target", async () => {
    await withFixture(async (fixture) => {
      await stageAgentToolkit({ ...fixture, buildBundle: false })
      const original = await readFile(join(fixture.targetDir, "ulw-loop", "cli.js"), "utf8")
      await writeFile(fixture.sourceEntry, "#!/usr/bin/env node\nconsole.log('changed')\n", "utf8")

      await assert.rejects(
        stageAgentToolkit({
          ...fixture,
          buildBundle: false,
          platform: "win32",
          copyDirectory: async (_source, backupDir) => {
            await mkdir(backupDir, { recursive: true })
            await writeFile(join(backupDir, "partial"), "partial", "utf8")
            throw new Error("copy failed")
          },
        }),
        /copy failed/,
      )

      assert.equal(await readFile(join(fixture.targetDir, "ulw-loop", "cli.js"), "utf8"), original)
      assert.equal(
        (await readdir(dirname(fixture.targetDir))).some((entry) => entry.startsWith("agent-toolkit.backup-")),
        false,
      )
    })
  })

  test("#given an unknown component #when dispatched #then it exits one and lists ulw-loop", async () => {
    await withFixture(async (fixture) => {
      await stageAgentToolkit({ ...fixture, buildBundle: false })

      const result = spawnSync(process.execPath, [join(fixture.targetDir, "cli.js"), "no-such-component"], { encoding: "utf8" })

      assert.equal(result.status, 1)
      assert.match(result.stderr, /Available components: ulw-loop/)
    })
  })
})
