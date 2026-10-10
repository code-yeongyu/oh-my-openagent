import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, describe, test } from "node:test"
import { pathToFileURL } from "node:url"

import { checkAgentToolkitFresh, stageAgentToolkit } from "./stage-agent-toolkit.mjs"

const tempDirs = []
const STAGING_TEST_TIMEOUT_MS = process.platform === "win32" ? 30_000 : 5_000

async function makeFixture() {
  const root = await mkdtemp(join(tmpdir(), "omo-senpi-agent-toolkit-stage-test-"))
  tempDirs.push(root)
  const sourceEntry = join(root, "built", "cli.js")
  const directiveEntry = join(root, "built", "directive.md")
  const targetDir = join(root, "staged", "agent-toolkit")
  await mkdir(join(root, "built"), { recursive: true })
  await writeFile(sourceEntry, "#!/usr/bin/env node\nconsole.log(process.argv.slice(2).join(' '))\n", "utf8")
  await writeFile(directiveEntry, "# Ultrawork\n", "utf8")
  await chmod(sourceEntry, 0o755)
  return { sourceEntry, directiveEntry, targetDir }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("agent-toolkit runtime staging", () => {
  test("#given a standalone ulw-loop bundle #when staged #then dispatcher and executable shims are self-contained", { timeout: STAGING_TEST_TIMEOUT_MS }, async () => {
    const fixture = await makeFixture()

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
    tempDirs.push(probeCwd)
    const probe = spawnSync(process.execPath, [join(fixture.targetDir, "cli.js"), "ulw-loop", "--help"], {
      cwd: probeCwd,
      encoding: "utf8",
    })
    assert.equal(probe.status, 0, probe.stderr)
  })

  test("#given a staged toolkit #when inspecting the bundle dir #then the omo-senpi surface marker is baked next to the bundle", { timeout: STAGING_TEST_TIMEOUT_MS }, async () => {
    const fixture = await makeFixture()

    await stageAgentToolkit({ ...fixture, buildBundle: false })

    const marker = JSON.parse(await readFile(join(fixture.targetDir, "ulw-loop", "surface.json"), "utf8"))
    assert.deepEqual(marker, { surface: "omo-senpi" })
    assert.deepEqual((await readdir(join(fixture.targetDir, "ulw-loop"))).sort(), ["cli.js", "surface.json"])
  })

  test("#given a staged toolkit missing the surface marker #when freshness is checked #then it reports stale", { timeout: STAGING_TEST_TIMEOUT_MS }, async () => {
    const fixture = await makeFixture()
    await stageAgentToolkit({ ...fixture, buildBundle: false })
    await rm(join(fixture.targetDir, "ulw-loop", "surface.json"))

    await assert.rejects(checkAgentToolkitFresh(fixture), /missing/)
  })

  test("#given a staged toolkit #when freshness is checked #then runtime artifacts and source bytes must match", { timeout: STAGING_TEST_TIMEOUT_MS }, async () => {
    const fixture = await makeFixture()
    await stageAgentToolkit({ ...fixture, buildBundle: false })

    const result = await checkAgentToolkitFresh(fixture)

    assert.equal(result.ok, true)
    assert.equal(await readFile(join(fixture.targetDir, "ulw-loop", "cli.js"), "utf8"), await readFile(fixture.sourceEntry, "utf8"))
    assert.equal(await readFile(join(fixture.targetDir, "directive.md"), "utf8"), await readFile(fixture.directiveEntry, "utf8"))
  })

  test("#given an identical staged toolkit #when staged again #then preserves the target directory identity", { timeout: STAGING_TEST_TIMEOUT_MS }, async () => {
    const fixture = await makeFixture()
    await stageAgentToolkit({ ...fixture, buildBundle: false })
    const before = await stat(fixture.targetDir)

    await stageAgentToolkit({ ...fixture, buildBundle: false })

    assert.equal((await stat(fixture.targetDir)).ino, before.ino)
  })

  test("#given a malformed staged toolkit #when staged again #then replaces the stale directory shape", { timeout: STAGING_TEST_TIMEOUT_MS }, async () => {
    const fixture = await makeFixture()
    await stageAgentToolkit({ ...fixture, buildBundle: false })
    await rm(join(fixture.targetDir, "ulw-loop"), { recursive: true, force: true })
    await writeFile(join(fixture.targetDir, "ulw-loop"), "stale", "utf8")

    await stageAgentToolkit({ ...fixture, buildBundle: false })

    assert.equal(await readFile(join(fixture.targetDir, "ulw-loop", "cli.js"), "utf8"), await readFile(fixture.sourceEntry, "utf8"))
  })

  test("#given a partial Windows backup copy #when staging fails #then removes backup debris and preserves the target", { timeout: STAGING_TEST_TIMEOUT_MS }, async () => {
    const fixture = await makeFixture()
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

  test("#given bare help #when dispatched #then ulw-loop receives help", { timeout: STAGING_TEST_TIMEOUT_MS }, async () => {
    const fixture = await makeFixture()
    await stageAgentToolkit({ ...fixture, buildBundle: false })

    const result = spawnSync(process.execPath, [join(fixture.targetDir, "cli.js"), "help"], { encoding: "utf8" })

    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout.trim(), "help")
  })

  test("#given an unknown component #when dispatched #then it exits one and lists ulw-loop", { timeout: STAGING_TEST_TIMEOUT_MS }, async () => {
    const fixture = await makeFixture()
    await stageAgentToolkit({ ...fixture, buildBundle: false })

    const result = spawnSync(process.execPath, [join(fixture.targetDir, "cli.js"), "no-such-component"], { encoding: "utf8" })

    assert.equal(result.status, 1)
    assert.match(result.stderr, /Available components: ulw-loop/)
  })
})

describe("agent-toolkit bundle build", () => {
  // Native staging runs next to other builds that share the Codex plugin workspace, so building the
  // bundle must go through bun alone and never reinstall that tree with npm.
  test("#given staging builds the bundle #when it runs #then bun builds it and npm is never invoked", { skip: process.platform === "win32", timeout: STAGING_TEST_TIMEOUT_MS }, async () => {
    const fixture = await makeFixture()
    await rm(fixture.sourceEntry)
    const stubBin = join(dirname(fixture.targetDir), "..", "stub-bin")
    const bunLog = join(stubBin, "bun.log")
    const npmLog = join(stubBin, "npm.log")
    await mkdir(stubBin, { recursive: true })
    await writeFile(join(stubBin, "bun"), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${bunLog}'\nout=""\nwhile [ "$#" -gt 0 ]; do [ "$1" = "--outfile" ] && out="$2"; shift; done\nmkdir -p "$(dirname "$out")"\nprintf '#!/usr/bin/env node\\nconsole.log("built")\\n' > "$out"\n`, "utf8")
    await writeFile(join(stubBin, "npm"), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${npmLog}'\nexit 1\n`, "utf8")
    await chmod(join(stubBin, "bun"), 0o755)
    await chmod(join(stubBin, "npm"), 0o755)

    const moduleUrl = pathToFileURL(join(import.meta.dirname, "stage-agent-toolkit.mjs")).href
    const child = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", `const { stageAgentToolkit } = await import(${JSON.stringify(moduleUrl)}); const result = await stageAgentToolkit({ directiveEntry: ${JSON.stringify(fixture.directiveEntry)}, targetDir: ${JSON.stringify(fixture.targetDir)} }); if (!result.ok) process.exit(3)`],
      { encoding: "utf8", env: { ...process.env, PATH: `${stubBin}:${process.env.PATH ?? ""}`, OMO_AGENT_TOOLKIT_SOURCE_ENTRY: fixture.sourceEntry } },
    )

    assert.equal(child.status, 0, child.stderr)
    const bunCalls = (await readFile(bunLog, "utf8")).trim().split("\n")
    assert.equal(bunCalls.length, 1)
    assert.match(bunCalls[0], /^build \S+ulw-loop\/src\/cli\.ts --target node --format esm --outfile /)
    assert.ok(bunCalls[0].endsWith(fixture.sourceEntry))
    await assert.rejects(readFile(npmLog, "utf8"), { code: "ENOENT" })
    assert.equal(await readFile(join(fixture.targetDir, "ulw-loop", "cli.js"), "utf8"), '#!/usr/bin/env node\nconsole.log("built")\n')
  })
})
