import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { updateCodexConfig } from "./codex-config-toml"

describe("codex MultiAgentV2 release blockers", () => {
  test("#given gpt-5.6 v2 catalog and existing table disable #when updating config #then removes the disable", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-v2-table-disable-"))
    const configPath = join(root, "config.toml")
    await writeFile(
      configPath,
      [
        'model = "gpt-5.6-sol"',
        "",
        "[features.multi_agent_v2]",
        "enabled = false",
        "max_concurrent_threads_per_session = 6",
        "",
        "[agents]",
        "max_threads = 16",
        "max_depth = 4",
        "",
      ].join("\n"),
    )
    await writeFile(
      join(root, "models_cache.json"),
      JSON.stringify({ models: [{ slug: "gpt-5.6-sol", multi_agent_version: "v2" }] }),
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
    expect(sectionText(content, "[features.multi_agent_v2]")).not.toMatch(/^\s*enabled\s*=\s*false/m)
    expect(sectionText(content, "[features.multi_agent_v2]")).toContain("max_concurrent_threads_per_session = 6")
    expect(sectionText(content, "[features.multi_agent_v2]")).not.toContain("max_concurrent_threads_per_session = 1000")
    expect(content).not.toMatch(/^\s*max_threads\s*=/m)
    expect(content).toContain("max_depth = 4")
  })

  test("#given relative model_catalog_json declares gpt-5.6 model as v1 #when updating config #then resolves catalog beside config", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-v2-relative-catalog-"))
    const configPath = join(root, "config.toml")
    await writeFile(configPath, ['model = "gpt-5.6-sol"', 'model_catalog_json = "custom-catalog.json"', ""].join("\n"))
    await writeFile(
      join(root, "custom-catalog.json"),
      JSON.stringify({ models: [{ slug: "gpt-5.6-sol", multi_agent_version: "v1" }] }),
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
    expect(content).toContain("max_threads = 1000")
    expect(content).toContain("max_concurrent_threads_per_session = 16")
  })

  test("#given root gpt-5.6 model without catalog #when updating config #then removes stale V2 disable", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-v2-root-gpt56-"))
    const configPath = join(root, "config.toml")
    await writeFile(
      configPath,
      [
        'model = "gpt-5.6-terra"',
        "",
        "[features.multi_agent_v2]",
        "enabled = false",
        "max_concurrent_threads_per_session = 6",
        "",
        "[agents]",
        "max_threads = 16",
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
    expect(sectionText(content, "[features.multi_agent_v2]")).not.toMatch(/^\s*enabled\s*=\s*false/m)
    expect(sectionText(content, "[features.multi_agent_v2]")).toContain("max_concurrent_threads_per_session = 6")
    expect(content).not.toMatch(/^\s*max_threads\s*=/m)
  })
})

function sectionText(config: string, header: string): string {
  const start = config.indexOf(header)
  if (start === -1) return ""
  const rest = config.slice(start)
  const nextSection = rest.slice(header.length).search(/\n\[/)
  return nextSection === -1 ? rest : rest.slice(0, header.length + nextSection + 1)
}
