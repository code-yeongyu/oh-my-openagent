import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { ensureBunBinShim } from "../bin/lib/bun-bin-shim.js"
import { legacyShim, nodeModulesBinPath, stockLinkTarget } from "./bun-bin-shim.test-support"
import { capture, createFixture, fixtureEnv, launchEntry, launchShim, launchViaNode, NODE, POSIX_ONLY, removeFixtureRoots } from "./bun-bin-shim.fixture"

afterEach(removeFixtureRoots)

describe.skipIf(POSIX_ONLY)("real Bun-global launch surface", () => {
  test("#given a stock link #then preparation keeps it and the next launch never boots node", () => {
    const fixture = createFixture()
    const first = launchViaNode(fixture, ["--version"])
    expect(first.status).toBe(42)
    expect(lstatSync(fixture.binPath).isSymbolicLink()).toBe(true)
    expect(readlinkSync(fixture.binPath)).toBe(stockLinkTarget())
    expect(statSync(fixture.launcher).mode & 0o111).not.toBe(0)

    const path = join(fixture.root, "trap-path")
    mkdirSync(path)
    writeFileSync(join(path, "node"), "#!/bin/sh\nexit 97\n", { mode: 0o755 })
    rmSync(fixture.markerFile)
    const second = launchShim(fixture, ["say", "hi"], { PATH: path })
    expect(second.status).toBe(42)
    expect(readFileSync(fixture.markerFile, "utf8")).toBe("fake-bun-ran")
    expect(existsSync(fixture.captureFile)).toBe(false)
  })

  test("#given OMO_RUNTIME=node #then launcher and engine stay on node with exact arguments", () => {
    const fixture = createFixture()
    launchViaNode(fixture, ["--version"])
    const args = ["say", "two words", "it's literal", "--flag=value"]
    const result = launchShim(fixture, args, { OMO_RUNTIME: "node" })
    expect(result.status).toBe(0)
    const captured = capture(fixture)
    expect(captured.env.SENPI_RUNTIME).toBe("node")
    expect(captured.versions.bun).toBeUndefined()
    expect(captured.argv.slice(-args.length)).toEqual(args)
  })

  test("#given Bun disappears #then the prepared entrypoint falls back to node", () => {
    const fixture = createFixture()
    launchViaNode(fixture, ["--version"])
    rmSync(fixture.bunBinary)
    const path = join(fixture.root, "node-only-path")
    mkdirSync(path)
    symlinkSync(NODE ?? process.execPath, join(path, "node"))
    const result = launchShim(fixture, ["--version"], { PATH: path })
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe("omo 9.9.9-test.0 (engine: senpi 2026.8.9)")
  })

  test("#given both legacy wrappers #then a launch restores both and both remain executable", () => {
    const fixture = createFixture()
    const secondary = nodeModulesBinPath(fixture.bunInstall)
    mkdirSync(join(fixture.bunInstall, "install/global/node_modules/.bin"), { recursive: true })
    rmSync(fixture.binPath)
    for (const path of [fixture.binPath, secondary]) {
      writeFileSync(path, legacyShim(fixture.launcher, fixture.bunBinary), { mode: 0o755 })
    }
    const migrated = launchEntry(fixture, ["--version"])
    expect(migrated.status).toBe(42)
    for (const path of [fixture.binPath, secondary]) {
      expect(lstatSync(path).isSymbolicLink()).toBe(true)
      expect(launchShim({ ...fixture, binPath: path }, ["--version"]).status).toBe(42)
    }
  })

  test("#given Bun relinks a prepared install #then the next launch leaves its link intact", () => {
    const fixture = createFixture()
    launchViaNode(fixture, ["--version"])
    rmSync(fixture.binPath)
    symlinkSync(stockLinkTarget(), fixture.binPath)
    const result = launchShim(fixture, ["--version"])
    expect(result.status).toBe(42)
    expect(lstatSync(fixture.binPath).isSymbolicLink()).toBe(true)
  })

  test("#given a current entrypoint #then later node boots do not rewrite its permissions", () => {
    const fixture = createFixture()
    launchViaNode(fixture, ["--version"])
    chmodSync(fixture.launcher, 0o644)
    const result = launchEntry(fixture, ["--version"], { OMO_RUNTIME: "node" })
    expect(result.status).toBe(0)
    expect(statSync(fixture.launcher).mode & 0o777).toBe(0o644)
  })

  test("#given an unwritable bin directory #then preparation still works without replacing its link", () => {
    const fixture = createFixture()
    chmodSync(join(fixture.bunInstall, "bin"), 0o555)
    try {
      const result = launchEntry(fixture, ["say", "hi"], { OMO_RUNTIME: "node" })
      expect(result.status).toBe(0)
      expect(capture(fixture).env.SENPI_RUNTIME).toBe("node")
      expect(lstatSync(fixture.binPath).isSymbolicLink()).toBe(true)
    } finally {
      chmodSync(join(fixture.bunInstall, "bin"), 0o755)
    }
  })

  test("#given quotes and newlines in the install path #then the shell prelude treats them as data", () => {
    const fixture = createFixture("it's a\npath")
    rmSync(fixture.binPath)
    writeFileSync(fixture.binPath, legacyShim(fixture.launcher, fixture.bunBinary), { mode: 0o755 })
    const migrated = ensureBunBinShim({ scriptPath: fixture.launcher, env: fixtureEnv(fixture) })
    expect(migrated.action).toBe("repaired")
    const result = launchShim(fixture, ["--version"])
    expect(result.status).toBe(42)
    expect(readFileSync(fixture.markerFile, "utf8")).toBe("fake-bun-ran")
  })
})
