/// <reference types="bun-types" />

import { afterAll, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { npmSpawnOptions } from "./npm-invocation.mjs"

const packFixtures: string[] = []

afterAll(() => {
  for (const fixture of packFixtures) rmSync(fixture, { recursive: true, force: true })
})

describe("npm spawn options", () => {
  test("#given win32 #when npm spawn options are resolved #then a shell is requested", () => {
    // given / when
    const options = npmSpawnOptions("win32")

    // then
    expect(options).toEqual({ shell: true })
  })

  test("#given linux and darwin #when npm spawn options are resolved #then no shell is requested", () => {
    // given / when
    const linux = npmSpawnOptions("linux")
    const darwin = npmSpawnOptions("darwin")

    // then
    expect(linux).toEqual({})
    expect(darwin).toEqual({})
  })

  test("#given the current platform #when npm is spawned with these options #then npm actually runs", () => {
    // given
    const spawnNpm = () =>
      execFileSync("npm", ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...npmSpawnOptions() })

    // when
    const version = spawnNpm().trim()

    // then
    expect(version).toMatch(/^\d+\.\d+\.\d+/)
  })

  test("#given a minimal package #when npm pack --dry-run --json is spawned with these options #then its stdout is parseable JSON naming that package", () => {
    // given
    const fixture = mkdtempSync(join(tmpdir(), "omo-npm-pack-"))
    packFixtures.push(fixture)
    writeFileSync(join(fixture, "package.json"), JSON.stringify({ name: "omo-pack-probe", version: "1.0.0", private: true }))

    // when
    const raw = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
      cwd: fixture,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      ...npmSpawnOptions(),
    })

    // then
    expect(() => JSON.parse(raw)).not.toThrow()
    expect(raw).toContain("omo-pack-probe")
  })
})
