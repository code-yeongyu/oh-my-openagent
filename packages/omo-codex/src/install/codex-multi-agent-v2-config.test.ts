/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
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
      max_concurrent_threads_per_session: 16,
    })
  })

  test("#given an inline-commented V2 thread cap #when updating config twice #then preserves the line and ordering byte-for-byte", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-mav2-explicit-cap-"))
    const configPath = join(root, "config.toml")
    await writeFile(
      configPath,
      [
        "[features.multi_agent_v2]",
        "usage_hint_enabled = false",
        "max_concurrent_threads_per_session = 7 # user cap",
        "show_tool_use = false",
        "",
      ].join("\n"),
    )

    // when
    const updateInput = {
      configPath,
      repoRoot: "/repo/packages/omo-codex",
      marketplaceName: "debug",
      marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex" },
      pluginNames: ["omo"],
    } as const
    await updateCodexConfig(updateInput)
    const firstPass = await readFile(configPath, "utf8")
    const firstV2Section = sectionText(firstPass, "[features.multi_agent_v2]")
    await updateCodexConfig(updateInput)

    // then
    const secondPass = await readFile(configPath, "utf8")
    const parsed = parseToml(secondPass)
    expect(secondPass).toContain(
      "usage_hint_enabled = false\nmax_concurrent_threads_per_session = 7 # user cap\nshow_tool_use = false",
    )
    expect(parsed.features.multi_agent_v2.max_concurrent_threads_per_session).toBe(7)
    expect(sectionText(secondPass, "[features.multi_agent_v2]")).toBe(firstV2Section)
  })

  for (const fixture of [
    {
      name: "escaped quoted V2 header",
      lines: ['["features"."multi_agent_v\\u0032"]', "max_concurrent_threads_per_session = 7 # user cap"],
      preservedLine: '["features"."multi_agent_v\\u0032"]',
    },
    {
      name: "quoted cap key",
      lines: ["[features.multi_agent_v2]", '"max_concurrent_threads_per_session" = 7 # user cap'],
      preservedLine: '"max_concurrent_threads_per_session" = 7 # user cap',
    },
    {
      name: "escaped quoted cap key",
      lines: ["[features.multi_agent_v2]", '"max_concurrent_threads_per_sessio\\u006e" = 7 # user cap'],
      preservedLine: '"max_concurrent_threads_per_sessio\\u006e" = 7 # user cap',
    },
    {
      name: "dotted cap key",
      lines: ["[features]", "multi_agent_v2.max_concurrent_threads_per_session = 7 # user cap"],
      preservedLine: "multi_agent_v2.max_concurrent_threads_per_session = 7 # user cap",
    },
    {
      name: "root-qualified dotted cap key",
      lines: ["features.multi_agent_v2.max_concurrent_threads_per_session = 7 # user cap"],
      preservedLine: "features.multi_agent_v2.max_concurrent_threads_per_session = 7 # user cap",
    },
  ] as const) {
    test(`#given installer config has a ${fixture.name} #when updating twice #then preserves the semantic cap without duplication`, async () => {
      // given
      const root = await mkdtemp(join(tmpdir(), "omo-codex-mav2-semantic-key-"))
      const configPath = join(root, "config.toml")
      await writeFile(configPath, ['model = "gpt-5.4"', "", ...fixture.lines, ""].join("\n"))
      const updateInput = {
        configPath,
        repoRoot: "/repo/packages/omo-codex",
        marketplaceName: "debug",
        marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex" },
        pluginNames: ["omo"],
      } as const

      // when
      await updateCodexConfig(updateInput)
      const firstPass = await readFile(configPath, "utf8")
      const parsed = parseToml(firstPass)
      await updateCodexConfig(updateInput)

      // then
      const secondPass = await readFile(configPath, "utf8")
      const secondParsed = parseToml(secondPass)
      expect(parsed.features.multi_agent_v2.max_concurrent_threads_per_session).toBe(7)
      expect(secondParsed.features.multi_agent_v2.max_concurrent_threads_per_session).toBe(7)
      expect(secondPass.indexOf(fixture.preservedLine)).toBe(firstPass.indexOf(fixture.preservedLine))
      expect(secondPass.split(fixture.preservedLine)).toHaveLength(2)
      expect(secondPass).toContain(fixture.preservedLine)
      expect(secondPass).not.toMatch(/^max_concurrent_threads_per_session = 16$/m)
      if (fixture.name === "root-qualified dotted cap key") expect(secondPass).not.toContain("[features]")
    })
  }

  test("#given multiline string contains V2 cap lookalikes #when updating config #then writes the absent semantic default", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-mav2-multiline-lookalike-"))
    const configPath = join(root, "config.toml")
    await writeFile(
      configPath,
      [
        'notes = """',
        "[features.multi_agent_v2]",
        "max_concurrent_threads_per_session = 7",
        '"""',
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
    expect(content).toContain("max_concurrent_threads_per_session = 7")
    expect(parsed.features.multi_agent_v2.max_concurrent_threads_per_session).toBe(16)
  })

  test("#given V2 section multiline value contains a cap lookalike #when updating config #then writes the absent default", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-mav2-section-multiline-lookalike-"))
    const configPath = join(root, "config.toml")
    await writeFile(
      configPath,
      [
        "[features.multi_agent_v2]",
        'notes = """',
        "max_concurrent_threads_per_session = 7",
        '"""',
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
    const parsed = parseToml(await readFile(configPath, "utf8"))
    expect(parsed.features.multi_agent_v2.max_concurrent_threads_per_session).toBe(16)
  })

  test("#given root-dotted features and string lookalikes #when updating config #then replaces the semantic flag only", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-mav2-root-feature-integrity-"))
    const configPath = join(root, "config.toml")
    await writeFile(
      configPath,
      [
        'notes = """',
        "features.plugins = false",
        '"""',
        '"features".plugins = false # user flag',
        "features.multi_agent_v2.max_concurrent_threads_per_session = 7",
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
    expect(content).toContain('notes = """\nfeatures.plugins = false\n"""')
    expect(content).toContain('"features".plugins = true # user flag')
    expect(content).not.toContain("[features]")
  })

  test("#given root-dotted plugin flag has a multiline value #when updating config #then replaces the whole semantic assignment", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-mav2-root-feature-multiline-"))
    const configPath = join(root, "config.toml")
    await writeFile(
      configPath,
      [
        '"features".plugins = """',
        "false",
        '"""',
        "features.multi_agent_v2.max_concurrent_threads_per_session = 7",
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
    expect(content).toContain('"features".plugins = true')
    expect(content).not.toContain('\nfalse\n"""')
    expect(parseToml(content).features.multi_agent_v2.max_concurrent_threads_per_session).toBe(7)
  })

  test("#given multiline string closes after an escaped quote #when updating config #then preserves the following explicit cap", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-mav2-overlapping-closer-"))
    const configPath = join(root, "config.toml")
    await writeFile(
      configPath,
      ['notes = """abc\\\""""', "[features.multi_agent_v2]", "max_concurrent_threads_per_session = 7", ""].join(
        "\n",
      ),
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
    expect(parsed.features.multi_agent_v2.max_concurrent_threads_per_session).toBe(7)
    expect(content.match(/^\[features\.multi_agent_v2\]$/gm)).toHaveLength(1)
  })

  test("#given disabled boolean shorthand #when updating config #then explicit disable is preserved in table form", async () => {
    // given
    // A pinned v1 model keeps the explicit disable materializing in table form;
    // the stamped v2-preferred default would drop the disable instead.
    const root = await mkdtemp(join(tmpdir(), "omo-codex-mav2-disabled-shorthand-"))
    const configPath = join(root, "config.toml")
    await writeFile(
      configPath,
      [
        'model = "gpt-5.5"',
        "",
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
      max_concurrent_threads_per_session: 16,
    })
  })
})

interface ParsedCodexConfig {
  readonly features: {
    readonly multi_agent_v2: Record<string, boolean | number>
  }
}

function parseToml(config: string): ParsedCodexConfig {
  const parsed: unknown = Bun.TOML.parse(config)
  if (!isParsedCodexConfig(parsed)) {
    throw new Error("Parsed TOML did not have the expected Codex config shape")
  }
  return parsed
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

function sectionText(config: string, header: string): string {
  const start = config.indexOf(header)
  if (start < 0) return ""
  const next = config.indexOf("\n[", start + header.length)
  return next < 0 ? config.slice(start) : config.slice(start, next)
}
