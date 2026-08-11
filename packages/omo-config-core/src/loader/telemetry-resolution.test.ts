import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"

import { isOmoTelemetryEnabled, loadOmoConfig } from "../index"

function makeFixture(): { readonly cwd: string; readonly homeDir: string; readonly root: string } {
  const root = mkdtempSync(join(tmpdir(), "omo-config-telemetry-resolution-"))
  const homeDir = join(root, "home")
  const cwd = join(homeDir, "project")
  mkdirSync(join(homeDir, ".omo"), { recursive: true })
  mkdirSync(cwd, { recursive: true })
  return { cwd, homeDir, root }
}

function writeUserConfig(homeDir: string, content: string): void {
  writeFileSync(join(homeDir, ".omo", "omo.json"), content)
}

function loadSenpi(fixture: { readonly cwd: string; readonly homeDir: string }, profile?: string) {
  return loadOmoConfig({
    cwd: fixture.cwd,
    env: { HOME: fixture.homeDir },
    harness: "senpi",
    platform: "linux",
    ...(profile === undefined ? {} : { profile }),
  })
}

describe("loadOmoConfig telemetry resolution", () => {
  test("#given base telemetry is disabled #when loading the senpi view #then the typed accessor returns false", () => {
    // given
    const fixture = makeFixture()
    writeUserConfig(fixture.homeDir, `{"telemetry":{"enabled":false}}`)

    try {
      // when
      const result = loadSenpi(fixture)

      // then
      expect(result.diagnostics).toEqual([])
      expect(isOmoTelemetryEnabled(result.config)).toBe(false)
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test("#given base telemetry is disabled and the senpi block enables it #when loading the senpi view #then the senpi override wins", () => {
    // given
    const fixture = makeFixture()
    writeUserConfig(fixture.homeDir, `{"telemetry":{"enabled":false},"[senpi]":{"telemetry":{"enabled":true}}}`)

    try {
      // when
      const result = loadSenpi(fixture)

      // then
      expect(result.diagnostics).toEqual([])
      expect(isOmoTelemetryEnabled(result.config)).toBe(true)
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test("#given base telemetry is enabled and the active profile disables it #when loading the senpi view #then the profile layer wins", () => {
    // given
    const fixture = makeFixture()
    writeUserConfig(
      fixture.homeDir,
      `{"telemetry":{"enabled":true},"profiles":{"private":{"telemetry":{"enabled":false}}}}`,
    )

    try {
      // when
      const result = loadSenpi(fixture, "private")

      // then
      expect(result.diagnostics).toEqual([])
      expect(result.profile).toBe("private")
      expect(isOmoTelemetryEnabled(result.config)).toBe(false)
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test("#given telemetry is absent from every layer #when loading the senpi view #then telemetry defaults to enabled", () => {
    // given
    const fixture = makeFixture()
    writeUserConfig(fixture.homeDir, `{}`)

    try {
      // when
      const result = loadSenpi(fixture)

      // then
      expect(result.diagnostics).toEqual([])
      expect(isOmoTelemetryEnabled(result.config)).toBe(true)
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test("#given an unknown sibling inside telemetry #when loading the senpi view #then the strict block is rejected", () => {
    // given
    const fixture = makeFixture()
    writeUserConfig(fixture.homeDir, `{"telemetry":{"enabled":false,"unexpected":true}}`)

    try {
      // when
      const result = loadSenpi(fixture)

      // then
      expect(result.diagnostics).toHaveLength(1)
      expect(result.diagnostics[0]).toMatchObject({ kind: "validation" })
      expect(result.diagnostics[0]?.issuePaths).toContain("telemetry")
      expect(isOmoTelemetryEnabled(result.config)).toBe(true)
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test("#given telemetry enabled is a string #when loading the senpi view #then the malformed value is rejected", () => {
    // given
    const fixture = makeFixture()
    writeUserConfig(fixture.homeDir, `{"telemetry":{"enabled":"yes"}}`)

    try {
      // when
      const result = loadSenpi(fixture)

      // then
      expect(result.diagnostics).toHaveLength(1)
      expect(result.diagnostics[0]).toMatchObject({ kind: "validation" })
      expect(result.diagnostics[0]?.issuePaths).toContain("telemetry.enabled")
      expect(isOmoTelemetryEnabled(result.config)).toBe(true)
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test.each([
    ["number", `{"telemetry":{"enabled":1}}`],
    ["null", `{"telemetry":{"enabled":null}}`],
    ["deeply nested garbage", `{"telemetry":{"enabled":{"nested":{"garbage":true}}}}`],
  ])("#given telemetry enabled is %s #when loading the senpi view #then malformed input is rejected", (_name, content) => {
    // given
    const fixture = makeFixture()
    writeUserConfig(fixture.homeDir, content)

    try {
      // when
      const result = loadSenpi(fixture)

      // then
      expect(result.diagnostics).toHaveLength(1)
      expect(result.diagnostics[0]).toMatchObject({ kind: "validation" })
      expect(result.diagnostics[0]?.issuePaths).toContain("telemetry.enabled")
      expect(isOmoTelemetryEnabled(result.config)).toBe(true)
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })
})
