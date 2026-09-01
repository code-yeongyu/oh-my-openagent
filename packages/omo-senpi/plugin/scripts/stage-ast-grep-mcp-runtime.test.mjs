/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { checkAstGrepMcpRuntimeFresh } from "./stage-ast-grep-mcp-runtime.mjs"

const tempDirs = []

async function makeRuntimeFixture() {
  const root = await mkdtemp(join(tmpdir(), "omo-senpi-ast-grep-stage-test-"))
  tempDirs.push(root)
  const sourceEntry = join(root, "built", "cli.js")
  const targetEntry = join(root, "staged", "cli.js")
  const manifestPath = join(root, "staged", "manifest.json")
  const content = "#!/usr/bin/env node\nconsole.log('ast-grep')\n"
  await Promise.all([
    mkdir(join(root, "built"), { recursive: true }),
    mkdir(join(root, "staged"), { recursive: true }),
  ])
  await Promise.all([
    writeFile(sourceEntry, content, "utf8"),
    writeFile(targetEntry, content, "utf8"),
  ])
  await Promise.all([chmod(sourceEntry, 0o755), chmod(targetEntry, 0o700)])
  await writeFile(
    manifestPath,
    `${JSON.stringify({
      sha256: createHash("sha256").update(await readFile(targetEntry)).digest("hex"),
      mode: 0o755,
      stagedAtUtc: "2026-08-03T00:00:00.000Z",
    })}\n`,
    "utf8",
  )
  return { sourceEntry, targetEntry, manifestPath }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("ast-grep MCP staged runtime mode policy", () => {
  test("#given a Windows staged runtime with a POSIX manifest mode #when checked #then matching content is current", async () => {
    const fixture = await makeRuntimeFixture()

    const result = await checkAstGrepMcpRuntimeFresh({ ...fixture, platform: "win32" })

    expect(result.ok).toBe(true)
  })

  test("#given a POSIX staged runtime with a mismatched manifest mode #when checked #then it is stale", async () => {
    const fixture = await makeRuntimeFixture()

    await expect(checkAstGrepMcpRuntimeFresh({ ...fixture, platform: "linux" })).rejects.toThrow(
      "manifest mode 493 does not match staged mode",
    )
  })
})
