/// <reference types="bun-types" />

// Package contract: every bin of the oh-my-openagent wrapper must reach the oh-my-opencode platform binary through
// the payload's own launcher, under Node's real `exports` resolution, with the bin name the user typed as
// OMO_INVOCATION_NAME (argv[1] names the forwarder file, not the bin) and the payload root as the package root the
// CLI reads its bundles from. npm hoists the payload beside the wrapper or nests it under it; both must work.

import { afterAll, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const repoRoot = join(import.meta.dir, "..")
const scratch = mkdtempSync(join(tmpdir(), "omo-wrapper-install-"))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

const WRAPPER_BINS = ["oh-my-opencode", "oh-my-openagent", "omo-agent-toolkit", "lazycodex", "lazycodex-ai"]
const FAKE_PLATFORM_BIN = `console.log(JSON.stringify({
  invocation: process.env.OMO_INVOCATION_NAME,
  packageRoot: process.env.OMO_WRAPPER_PACKAGE_ROOT,
  args: process.argv.slice(2),
}))
`

// The payload as published: its real manifest and launcher; its platform packages answer with what they received.
function installPayload(nodeModules: string): string {
  const payloadRoot = join(nodeModules, "oh-my-opencode")
  mkdirSync(payloadRoot, { recursive: true })
  cpSync(join(repoRoot, "package.json"), join(payloadRoot, "package.json"))
  cpSync(join(repoRoot, "bin"), join(payloadRoot, "bin"), { recursive: true })
  for (const platformPackage of readdirSync(join(repoRoot, "packages")).filter((name) =>
    name.startsWith("oh-my-opencode-"),
  )) {
    mkdirSync(join(nodeModules, platformPackage, "bin"), { recursive: true })
    writeFileSync(join(nodeModules, platformPackage, "package.json"), JSON.stringify({ name: platformPackage }))
    writeFileSync(join(nodeModules, platformPackage, "bin", "oh-my-opencode.js"), FAKE_PLATFORM_BIN)
  }
  symlinkSync(join(repoRoot, "node_modules", "detect-libc"), join(nodeModules, "detect-libc"), "junction")
  return payloadRoot
}

function install(layout: "hoisted" | "nested"): { wrapperRoot: string; payloadRoot: string } {
  const nodeModules = join(scratch, layout, "node_modules")
  const wrapperRoot = join(nodeModules, "oh-my-openagent")
  cpSync(join(repoRoot, "packages", "oh-my-openagent-wrapper"), wrapperRoot, { recursive: true })
  const payloadRoot = installPayload(layout === "hoisted" ? nodeModules : join(wrapperRoot, "node_modules"))
  return { wrapperRoot, payloadRoot }
}

function runBin(wrapperRoot: string, bin: string, env: Record<string, string> = {}) {
  const { OMO_INVOCATION_NAME: _inherited, ...base } = process.env
  const run = spawnSync("node", [join(wrapperRoot, "bin", `${bin}.js`), "--version"], {
    encoding: "utf8",
    env: { ...base, ...env },
  })
  expect(run.stderr).toBe("")
  expect(run.status).toBe(0)
  return JSON.parse(run.stdout)
}

describe.each(["hoisted", "nested"] as const)("oh-my-openagent wrapper installed with its payload %s", (layout) => {
  const { wrapperRoot, payloadRoot } = install(layout)

  test.each(WRAPPER_BINS)(
    "#given the %s bin #when run #then the platform binary sees that name and the payload root",
    (bin) => {
      expect(runBin(wrapperRoot, bin)).toEqual({
        invocation: bin,
        packageRoot: `${payloadRoot}/`,
        args: ["--version"],
      })
    },
  )

  test("#given an invocation name inherited from a parent omo #when a bin runs #then the inherited name still wins", () => {
    expect(runBin(wrapperRoot, "oh-my-openagent", { OMO_INVOCATION_NAME: "lazycodex-ai" }).invocation).toBe(
      "lazycodex-ai",
    )
  })
})
