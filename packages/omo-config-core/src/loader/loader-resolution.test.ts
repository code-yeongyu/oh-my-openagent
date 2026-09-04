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
        "task": { "max_depth": 4, "default_concurrency": 2 },
        "[senpi]": { "task": { "ttl_ms": 111000, "default_concurrency": 3 } },
        "profiles": {
          "opus": {
            "task": { "default_concurrency": 6, "resume_children": false },
            "[senpi]": { "task": { "default_concurrency": 9, "state_dir": "/tmp/opus" } }
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
    expect(result.config.task).toMatchObject({
      max_depth: 4,
      ttl_ms: 111_000,
      resume_children: false,
      default_concurrency: 9,
      state_dir: "/tmp/opus",
    })
    expect(result.config.profiles).toBeUndefined()
    expect(result.config["[senpi]"]).toBeUndefined()
  })

  test("#given user and project profile layers #when loading a resolved view #then raw layers retain user and project provenance", () => {
    // given
    const fixture = makeFixture()
    writeJsonc(
      join(fixture.homeDir, ".omo", "omo.jsonc"),
      `{"task":{"max_depth":4},"profiles":{"opus":{"task":{"ttl_ms":111000}}}}`,
    )
    writeJsonc(
      join(fixture.projectDir, ".omo", "omo.jsonc"),
      `{"[senpi]":{"task":{"default_concurrency":3}},"profiles":{"opus":{"[senpi]":{"task":{"resume_children":false}}}}}`,
    )

    // when
    const result = loadOmoConfig({
      cwd: fixture.cwd,
      env: { HOME: fixture.homeDir, OMO_PROFILE: "opus" },
      harness: "senpi",
      platform: "linux",
    })

    // then
    expect(result.config.task).toMatchObject({
      max_depth: 4,
      ttl_ms: 111_000,
      default_concurrency: 3,
      resume_children: false,
    })
    expect(result.layers.map((layer) => layer.source.scope)).toEqual(["user", "project"])
    expect(result.layers.map((layer) => layer.config)).toEqual([
      { task: { max_depth: 4 }, profiles: { opus: { task: { ttl_ms: 111_000 } } } },
      { "[senpi]": { task: { default_concurrency: 3 } }, profiles: { opus: { "[senpi]": { task: { resume_children: false } } } } },
    ])
  })

  test("#given base telemetry and an empty codex block #when loading the codex view #then defaults do not overwrite the base value", () => {
    // given
    const fixture = makeFixture()
    writeJsonc(
      join(fixture.homeDir, ".omo", "omo.jsonc"),
      `{"telemetry":{"enabled":false},"[codex]":{"telemetry":{}}}`,
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
    expect(result.config.telemetry?.enabled).toBe(false)
  })

  test("#given an unknown activated profile #when loading a harness view #then a profile diagnostic is emitted and no profile overlay is applied", () => {
    // given
    const fixture = makeFixture()
    writeJsonc(
      join(fixture.homeDir, ".omo", "omo.jsonc"),
      `{"task":{"max_depth":4},"[senpi]":{"task":{"default_concurrency":3}},"profiles":{"opus":{"task":{"ttl_ms":111000}}}}`,
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
    expect(result.config.task).toMatchObject({ max_depth: 4, default_concurrency: 3, ttl_ms: 86_400_000 })
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0]).toMatchObject({ kind: "profile", path: "profiles.ghost" })
  })
})
