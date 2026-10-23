import { afterEach, describe, expect, test } from "bun:test"
import { lstatSync, readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { bunBinShimScript } from "../bin/lib/bun-bin-shim.js"
import { createFixture, NODE, NODELESS_UNAVAILABLE, nodelessEnv, removeFixtureRoots, stageInstalledPackage } from "./bun-bin-shim.fixture"

afterEach(removeFixtureRoots)

/**
 * Stages the tree `bun add -g` just linked, runs its postinstall on a PATH without node, and checks
 * the bin is the shim again and `omo` starts on bun with that same node-less PATH.
 */
function expectPostinstallLeavesANodelessOmo(): void {
  // given: the bin is the stock symlink to the entrypoint, whose `#!/usr/bin/env node` cannot start
  // where node is not on PATH
  const fixture = createFixture()
  stageInstalledPackage(fixture)
  const env = nodelessEnv(fixture)
  const stock = spawnSync(fixture.binPath, ["--version"], { encoding: "utf8", env })
  expect(stock.status).toBe(127)

  // when: bun runs the package's postinstall right after linking; with no node on PATH, bun runs
  // the script's `node` itself
  const postinstall = spawnSync(process.execPath, ["run", "postinstall"], {
    cwd: fixture.packageRoot,
    encoding: "utf8",
    env,
  })

  // then
  expect(postinstall.status).toBe(0)
  expect(lstatSync(fixture.binPath).isSymbolicLink()).toBe(false)
  expect(readFileSync(fixture.binPath, "utf8")).toBe(bunBinShimScript(fixture.launcher, fixture.bunBinary))
  const launched = spawnSync(fixture.binPath, ["--version"], { encoding: "utf8", env })
  expect(launched.status).toBe(42)
  expect(readFileSync(fixture.markerFile, "utf8")).toBe("fake-bun-ran")
}

describe("#given a bun add -g update on a machine without node (#9293)", () => {
  test.skipIf(NODELESS_UNAVAILABLE)("#then bun's postinstall leaves an omo that starts without node", () => {
    expectPostinstallLeavesANodelessOmo()
  })

  // A test run started from a package script inherits NODE and npm_node_execpath pointing at a real
  // node; the node-less machine must stay node-less anyway (#10419).
  for (const name of ["NODE", "npm_node_execpath"] as const) {
    test.skipIf(NODELESS_UNAVAILABLE || NODE === undefined)(`#then it still holds when the parent exported ${name}`, () => {
      const previous = process.env[name]
      process.env[name] = NODE
      try {
        expectPostinstallLeavesANodelessOmo()
      } finally {
        if (previous === undefined) delete process.env[name]
        else process.env[name] = previous
      }
    })
  }
})
