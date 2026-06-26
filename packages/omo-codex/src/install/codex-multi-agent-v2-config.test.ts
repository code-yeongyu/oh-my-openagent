/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { updateCodexConfig } from "./codex-config-toml"

describe("codex MultiAgentV2 config", () => {
  test("#given legacy boolean flag and table #when updating config #then output remains valid TOML without enabling V2", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-mav2-valid-toml-"))
    const configPath = join(root, "config.toml")
    await writeFile(
      configPath,
      [
        "[features]",
        "multi_agent_v2 = true",
        "plugins = false",
        "",
        "[features.multi_agent_v2]",
        "usage_hint_enabled = false",
        "",
      ].join("\n"),
    )

    // when
    await updateCodexConfig({
      configPath,
      repoRoot: "/repo/packages/omo-codex",
      marketplaceName: "debug",
      marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex" },
      pluginNames: ["omo"],
    })

    // then
    const content = await readFile(configPath, "utf8")
    const parsed = parseToml(content)
    expect(content).not.toMatch(/^\s*multi_agent_v2\s*=/m)
    expect(parsed.features.multi_agent_v2).toEqual({
      usage_hint_enabled: false,
      max_concurrent_threads_per_session: 10000,
    })
  })

  test("#given disabled boolean shorthand #when updating config #then explicit disable is preserved in table form", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-mav2-disabled-shorthand-"))
    const configPath = join(root, "config.toml")
    await writeFile(
      configPath,
      [
        "[features]",
        "multi_agent_v2 = false # user disabled the beta path",
        "plugins = false",
        "",
      ].join("\n"),
    )

    // when
    await updateCodexConfig({
      configPath,
      repoRoot: "/repo/packages/omo-codex",
      marketplaceName: "debug",
      marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex" },
      pluginNames: ["omo"],
    })

    // then
    const content = await readFile(configPath, "utf8")
    const parsed = parseToml(content)
    expect(content).not.toMatch(/^\s*multi_agent_v2\s*=/m)
    expect(parsed.features.multi_agent_v2).toEqual({
      enabled: false,
      max_concurrent_threads_per_session: 10000,
    })
  })
})

interface ParsedCodexConfig {
  readonly features: {
    readonly multi_agent_v2: Record<string, boolean | number>
  }
}

function parseToml(config: string): ParsedCodexConfig {
  const result = spawnSync(
    resolvePython(),
    [
      "-c",
      [
        "import json, sys, tomllib",
        "print(json.dumps(tomllib.loads(sys.stdin.read())))",
      ].join("; "),
    ],
    { encoding: "utf8", input: config },
  )
  expect(result.status, result.stderr).toBe(0)
  const parsed: unknown = JSON.parse(result.stdout)
  if (!isParsedCodexConfig(parsed)) {
    throw new Error("Parsed TOML did not have the expected Codex config shape")
  }
  return parsed
}

function resolvePython(): string {
  for (const command of ["python3", "python"]) {
    const result = spawnSync(command, ["-c", "import tomllib"], { encoding: "utf8" })
    if (result.status === 0) return command
  }
  throw new Error("Python with tomllib is required for TOML parse assertions")
}

function isParsedCodexConfig(value: unknown): value is ParsedCodexConfig {
  if (!isRecord(value)) return false
  const features = value.features
  if (!isRecord(features)) return false
  return isRecord(features.multi_agent_v2)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
