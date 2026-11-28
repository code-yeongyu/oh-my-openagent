/// <reference types="bun-types" />

// Release contract: oh-my-openagent is published from packages/oh-my-openagent-wrapper as a thin forwarder over the
// oh-my-opencode payload. A second postinstall, a range pin, a missing bin or plugin subpath, or a stray file would
// ship a package that installs a different payload, runs install work twice, or breaks a command users type.

import { afterAll, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { parseNpmPackPaths } from "./npm-pack-paths.mjs"
import { WRAPPER_DIR, wrapperShapeRefusals } from "./verify-openagent-wrapper.mjs"

const repoRoot = join(import.meta.dir, "..")
const payload = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"))
const checkedIn = JSON.parse(readFileSync(join(repoRoot, WRAPPER_DIR, "package.json"), "utf8"))
const scratch = mkdtempSync(join(tmpdir(), "omo-wrapper-shape-"))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

// The staged wrapper as the publish job packs it: the checked-in files plus the schema copy it adds.
function stagedPackedPaths(): string[] {
  const staged = join(scratch, "wrapper")
  cpSync(join(repoRoot, WRAPPER_DIR), staged, { recursive: true })
  writeFileSync(join(staged, "oh-my-opencode.schema.json"), "{}")
  return parseNpmPackPaths(
    execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
      cwd: staged,
      encoding: "utf8",
      shell: process.platform === "win32",
    }),
  )
}

describe("oh-my-openagent wrapper shape", () => {
  const packed = stagedPackedPaths()

  test("#given the checked-in wrapper staged for publish #when checked #then it is a thin forwarder at the payload's version", () => {
    expect(wrapperShapeRefusals(checkedIn, packed, payload)).toEqual([])
    expect(checkedIn.version).toBe(payload.version)
  })

  test.each([
    ["a postinstall", { scripts: { postinstall: "node postinstall.mjs" } }, "scripts must be empty"],
    ["a range pin", { dependencies: { "oh-my-opencode": `^${checkedIn.version}` } }, "dependencies must be exactly"],
    [
      "its own platform packages",
      { optionalDependencies: { "oh-my-openagent-linux-x64": "1.0.0" } },
      "optionalDependencies",
    ],
    ["a payload bin left out", { bin: { "oh-my-openagent": "bin/oh-my-openagent.js" } }, "bins are"],
    [
      "no ./tui subpath",
      { exports: Object.fromEntries(Object.entries(checkedIn.exports).filter(([key]) => key !== "./tui")) },
      "exports are",
    ],
  ])("#given a wrapper with %s #when checked #then it is refused", (_name, change, reason) => {
    const refusals = wrapperShapeRefusals({ ...checkedIn, ...change }, packed, payload)
    expect(refusals.some((refusal: string) => refusal.includes(reason))).toBe(true)
  })

  test("#given a packed file nothing names #when checked #then it is refused", () => {
    expect(wrapperShapeRefusals(checkedIn, [...packed, "dist/index.js"], payload)).toEqual([
      "dist/index.js is packed but nothing names it",
    ])
  })
})
