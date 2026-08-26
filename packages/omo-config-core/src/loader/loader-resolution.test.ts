import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import { loadOmoConfig } from "../index"

function writeJsonc(path: string, content: string): void {
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, content)
}

function makeFixture(): { readonly cwd: string; readonly homeDir: string; readonly projectDir: string } {
  const homeDir = join(mkdtempSync(join(tmpdir(), "omo-config-loader-resolution-")), "home")
  const projectDir = join(homeDir, "project")
  const cwd = join(projectDir, "child")
  mkdirSync(cwd, { recursive: true })
  return { cwd, homeDir, projectDir }
}

describe("loadOmoConfig resolution", () => {
  test("#given base, harness, profile-base, and profile-harness layers #when loading the active senpi profile #then each layer contributes in precedence order", () => {
    // given
    const fixture = makeFixture()
    writeJsonc(
      join(fixture.homeDir, ".omo", "omo.jsonc"),
      `{
        "codegraph": { "enabled": false, "daemon": true },
        "[senpi]": { "codegraph": { "auto_provision": false, "daemon": false } },
        "profiles": {
          "opus": {
            "codegraph": { "daemon": true, "telemetry": true },
            "[senpi]": { "codegraph": { "daemon": false, "excluded_roots": ["/tmp/opus"] } }
          }
        }
      }`,
    )

    // when
    const result = loadOmoConfig({
      cwd: fixture.cwd,
      env: { HOME: fixture.homeDir, OMO_PROFILE: "opus" },
      harness: "senpi",
      platform: "linux",
    })

    // then
    expect(result.diagnostics).toEqual([])
    expect(result.profile).toBe("opus")
    expect(result.config.codegraph).toMatchObject({
      enabled: false,
      auto_provision: false,
      daemon: false,
      telemetry: true,
      excluded_roots: ["/tmp/opus"],
    })
    expect(result.config.profiles).toBeUndefined()
    expect(result.config["[senpi]"]).toBeUndefined()
  })

  test("#given user and project profile layers #when loading a resolved view #then raw layers retain user and project provenance", () => {
    // given
    const fixture = makeFixture()
    writeJsonc(
      join(fixture.homeDir, ".omo", "omo.jsonc"),
      `{"codegraph":{"enabled":false},"profiles":{"opus":{"codegraph":{"telemetry":true}}}}`,
    )
    writeJsonc(
      join(fixture.projectDir, ".omo", "omo.jsonc"),
      `{"[senpi]":{"codegraph":{"auto_provision":false}},"profiles":{"opus":{"[senpi]":{"codegraph":{"daemon":false}}}}}`,
    )

    // when
    const result = loadOmoConfig({
      cwd: fixture.cwd,
      env: { HOME: fixture.homeDir, OMO_PROFILE: "opus" },
      harness: "senpi",
      platform: "linux",
    })

    // then
    expect(result.config.codegraph).toMatchObject({
      enabled: false,
      auto_provision: false,
      daemon: false,
      telemetry: true,
    })
    expect(result.layers.map((layer) => layer.source.scope)).toEqual(["user", "project"])
    expect(result.layers.map((layer) => layer.config)).toEqual([
      { codegraph: { enabled: false }, profiles: { opus: { codegraph: { telemetry: true } } } },
      { "[senpi]": { codegraph: { auto_provision: false } }, profiles: { opus: { "[senpi]": { codegraph: { daemon: false } } } } },
    ])
  })

  test("#given base telemetry and an empty codex block #when loading the codex view #then defaults do not overwrite the base value", () => {
    // given
    const fixture = makeFixture()
    writeJsonc(
      join(fixture.homeDir, ".omo", "omo.jsonc"),
      `{"codegraph":{"telemetry":true},"[codex]":{"codegraph":{}}}`,
    )

    // when
    const result = loadOmoConfig({
      cwd: fixture.cwd,
      env: { HOME: fixture.homeDir },
      harness: "codex",
      platform: "linux",
    })

    // then
    expect(result.diagnostics).toEqual([])
    expect(result.config.codegraph?.telemetry).toBe(true)
  })

  test("#given user roots and overlapping codex project roots #when loading the codex view #then roots retain their ordered unique union", () => {
    // given
    const fixture = makeFixture()
    writeJsonc(
      join(fixture.homeDir, ".omo", "omo.jsonc"),
      `{"codegraph":{"excluded_roots":["/tmp/omo-a","/tmp/omo-b"]}}`,
    )
    writeJsonc(
      join(fixture.projectDir, ".omo", "omo.jsonc"),
      `{"[codex]":{"codegraph":{"excluded_roots":["/tmp/omo-b","/tmp/omo-c"]}}}`,
    )

    // when
    const result = loadOmoConfig({
      cwd: fixture.cwd,
      env: { HOME: fixture.homeDir },
      harness: "codex",
      platform: "linux",
    })

    // then
    expect(result.diagnostics).toEqual([])
    expect(result.config.codegraph?.excluded_roots).toEqual(["/tmp/omo-a", "/tmp/omo-b", "/tmp/omo-c"])
  })

  test("#given an unknown activated profile #when loading a harness view #then a profile diagnostic is emitted and no profile overlay is applied", () => {
    // given
    const fixture = makeFixture()
    writeJsonc(
      join(fixture.homeDir, ".omo", "omo.jsonc"),
      `{"codegraph":{"enabled":false},"[senpi]":{"codegraph":{"daemon":false}},"profiles":{"opus":{"codegraph":{"telemetry":true}}}}`,
    )

    // when
    const result = loadOmoConfig({
      cwd: fixture.cwd,
      env: { HOME: fixture.homeDir, OMO_PROFILE: "ghost" },
      harness: "senpi",
      platform: "linux",
    })

    // then
    expect(result.profile).toBeUndefined()
    expect(result.config.codegraph).toMatchObject({ enabled: false, daemon: false, telemetry: false })
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0]).toMatchObject({ kind: "profile", path: "profiles.ghost" })
  })
})
