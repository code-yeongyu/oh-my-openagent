/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

// allow: SIZE_OK - Codex TOML writer coverage shares parser/fixture helpers across migration edge cases; this release adds config regressions and future edits should split by table family.

import { describe, expect, test } from "bun:test"
import { lstat, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { updateCodexConfig } from "./codex-config-toml"

describe("codex-config-toml", () => {
  test("#given autonomous permissions requested #when updating config #then enables full Codex autonomy", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-config-autonomous-"))
    const configPath = join(root, "config.toml")
    await writeFile(
      configPath,
      [
        'approval_policy = "on-request"',
        'sandbox_mode = "workspace-write"',
        "network_access = \"disabled\"",
        "",
        "[notice]",
        "hide_full_access_warning = false",
        "hide_world_writable_warning = false",
        "hide_rate_limit_model_nudge = true",
        "",
        "[windows]",
        'sandbox = "elevated"',
        "wsl2_proxy = true",
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
      autonomousPermissions: true,
    })

    // then
    const content = await readFile(configPath, "utf8")
    expect(content).toContain('approval_policy = "never"')
    expect(content).toContain('sandbox_mode = "danger-full-access"')
    expect(content).toContain('network_access = "enabled"')
    expect(content).toContain("[notice]")
    expect(content).toContain("hide_full_access_warning = true")
    expect(content).toContain("hide_world_writable_warning = true")
    expect(content).toContain("hide_rate_limit_model_nudge = true")
    expect(content).toContain("[windows]")
    expect(content).toContain("wsl2_proxy = true")
    expect(content).not.toContain('approval_policy = "on-request"')
    expect(content).not.toContain('sandbox_mode = "workspace-write"')
    expect(content).not.toContain('sandbox = "elevated"')
  })

  test("#given empty Codex config #when updating config #then creates MultiAgentV2 section without root multi-agent mode", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-config-multi-agent-"))
    const configPath = join(root, "config.toml")

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
    expect(content).not.toMatch(/^\s*multi_agent_mode\s*=/m)
    expect(content).toContain("[features.multi_agent_v2]")
    const v2Section = content.slice(content.indexOf("[features.multi_agent_v2]"))
      .split(/^\[/m).slice(0, 1).join("")
    expect(v2Section).not.toContain("enabled")
    expect(content).toContain("max_concurrent_threads_per_session = 16")
    // The stamped gpt-5.6 default is a V2-preferred model: Codex rejects
    // agents.max_threads while MultiAgentV2 is active, so a fresh install
    // must not introduce it.
    expect(content).not.toMatch(/^\s*max_threads\s*=/m)
  })

  test("#given stale queue multi-agent mode #when updating config #then removes unsupported root key", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-config-multi-agent-mode-"))
    const configPath = join(root, "config.toml")
    await writeFile(
      configPath,
      [
        'multi_agent_mode = "queue"',
        "",
        "[features]",
        "multi_agent = true",
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
    expect(content).not.toMatch(/^\s*multi_agent_mode\s*=/m)
    expect(content).not.toContain('multi_agent_mode = "queue"')
  })

  test("#given stale indented steering mode and inline-comment features table #when updating config #then removes root key and preserves table", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-config-toml-root-regression-"))
    const configPath = join(root, "config.toml")
    await writeFile(
      configPath,
      [
        '  multi_agent_mode = "steering"',
        "",
        "[features] # keep comment",
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
    expect(content.match(/^\s*multi_agent_mode\s*=/gm)).toBeNull()
    expect(content.match(/^\s*\[features\](?:\s*#.*)?$/gm)).toHaveLength(1)
    expect(content).toContain("[features] # keep comment")
    expect(content).not.toContain('multi_agent_mode = "queue"')
    expect(content).not.toContain('multi_agent_mode = "steering"')
  })

  test("#given stale proactive multi-agent mode #when updating config #then removes unsupported root key", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-config-proactive-cleanup-"))
    const configPath = join(root, "config.toml")
    await writeFile(configPath, ['multi_agent_mode = "proactive"', "", "[features]", "multi_agent = true", ""].join("\n"))

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
    expect(content).not.toMatch(/^\s*multi_agent_mode\s*=/m)
    expect(content).toContain("[features]")
  })

  test("#given existing MultiAgentV2 table #when updating config #then preserves user enabled flag and unrelated tuning while setting thread limit", async () => {
    // given
    // A pinned v1 model keeps this exercising the preserve-user-disable path;
    // an absent model would be stamped with the v2-preferred default, which
    // intentionally clears the disable.
    const root = await mkdtemp(join(tmpdir(), "omo-codex-config-multi-agent-existing-"))
    const configPath = join(root, "config.toml")
    await writeFile(
      configPath,
      [
        'model = "gpt-5.5"',
        "",
        "[features.multi_agent_v2]",
        "enabled = false",
        "usage_hint_enabled = false",
        "max_concurrent_threads_per_session = 4",
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
    expect(content).toContain("[features.multi_agent_v2]")
    expect(content).toContain("enabled = false")
    expect(content).toContain("usage_hint_enabled = false")
    expect(content).toContain("max_concurrent_threads_per_session = 4")
    expect(content).not.toContain("max_concurrent_threads_per_session = 1000")
  })

  test("#given empty Codex config #when updating config #then leaves Context7 to the plugin MCP manifest", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-config-context7-"))
    const configPath = join(root, "config.toml")

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
    expect(content).not.toContain("[mcp_servers.context7]")
    expect(content).not.toContain("@upstash/context7-mcp")
    expect(content).not.toContain("YOUR_API_KEY")
  })

  test("#given sisyphuslabs omo install #when updating config #then enables Context7 plugin mcp policy", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-config-context7-plugin-policy-"))
    const configPath = join(root, "config.toml")

    // when
    await updateCodexConfig({
      configPath,
      repoRoot: "/repo/packages/omo-codex",
      marketplaceName: "sisyphuslabs",
      marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex/cache/sisyphuslabs" },
      pluginNames: ["omo"],
    })

    // then
    const content = await readFile(configPath, "utf8")
    expect(content).toContain('[plugins."omo@sisyphuslabs".mcp_servers.context7]')
    expect(content).toMatch(/\[plugins\."omo@sisyphuslabs"\.mcp_servers\.context7\][\s\S]*?enabled = true/)
    expect(content).not.toContain("[mcp_servers.context7]")
    expect(content).not.toContain("@upstash/context7-mcp")
    expect(content).not.toContain("YOUR_API_KEY")
  })

  test("#given existing Context7 MCP server #when updating config #then leaves user server settings untouched", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-config-context7-existing-"))
    const configPath = join(root, "config.toml")
    await writeFile(
      configPath,
      [
        "[mcp_servers.context7] # stale npx package from old docs",
        'command = "node"',
        'args = ["/opt/context7/server.js"]',
        "startup_timeout_sec = 40",
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
    expect(content).toContain("[mcp_servers.context7]")
    expect(content).toContain('command = "node"')
    expect(content).toContain('args = ["/opt/context7/server.js"]')
    expect(content).toContain("startup_timeout_sec = 40")
    expect(content).not.toContain("YOUR_API_KEY")
  })

  test("#given real Context7 API key and placeholder comment #when updating config #then preserves user server settings", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-config-context7-real-key-"))
    const configPath = join(root, "config.toml")
    await writeFile(
      configPath,
      [
        "[mcp_servers.context7]",
        'command = "npx"',
        'args = ["-y", "@upstash/context7-mcp", "--api-key", "ctx7sk_live_example"] # replace YOUR_API_KEY in docs only',
        "startup_timeout_sec = 20",
        "",
      ].join("\n"),
    )

    // when
    await updateCodexConfig({
      configPath,
      repoRoot: "/repo/packages/omo-codex",
      marketplaceName: "sisyphuslabs",
      marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex/cache/sisyphuslabs" },
      pluginNames: ["omo"],
    })

    // then
    const content = await readFile(configPath, "utf8")
    expect(content).toContain("[mcp_servers.context7]")
    expect(content).toContain("ctx7sk_live_example")
    expect(content).toContain("replace YOUR_API_KEY in docs only")
    expect(content).toContain('[plugins."omo@sisyphuslabs".mcp_servers.context7]')
  })

  test("#given stale Context7 placeholder MCP server #when updating config #then removes it for the plugin MCP", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-config-context7-placeholder-"))
    const configPath = join(root, "config.toml")
    await writeFile(
      configPath,
      [
        "[mcp_servers.context7]",
        'command = "npx"',
        'args = ["-y", "@upstash/context7-mcp", "--api-key", "YOUR_API_KEY"]',
        "startup_timeout_sec = 20",
        "",
      ].join("\n"),
    )

    // when
    await updateCodexConfig({
      configPath,
      repoRoot: "/repo/packages/omo-codex",
      marketplaceName: "sisyphuslabs",
      marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex/cache/sisyphuslabs" },
      pluginNames: ["omo"],
    })

    // then
    const content = await readFile(configPath, "utf8")
    expect(content).toContain('[plugins."omo@sisyphuslabs".mcp_servers.context7]')
    expect(content).not.toContain("[mcp_servers.context7]")
    expect(content).not.toContain("@upstash/context7-mcp")
    expect(content).not.toContain("YOUR_API_KEY")
  })

  test("#given legacy boolean MultiAgentV2 flag and table #when updating config #then normalizes to table config", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-config-multi-agent-legacy-"))
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
    expect(content).not.toMatch(/^multi_agent_v2\s*=/m)
    expect(content).toContain("[features.multi_agent_v2]")
    const v2LegacySection = content.slice(content.indexOf("[features.multi_agent_v2]"))
      .split(/^\[/m).slice(0, 1).join("")
    expect(v2LegacySection).not.toContain("enabled")
    expect(content).toContain("usage_hint_enabled = false")
    expect(content).toContain("max_concurrent_threads_per_session = 16")
  })

  test("#given legacy boolean MultiAgentV2 flag false #when updating config #then normalizes to a disabled table config", async () => {
    // given
    // A pinned v1 model keeps the legacy boolean materializing as a disabled
    // table; the stamped v2-preferred default would drop the disable instead.
    const root = await mkdtemp(join(tmpdir(), "omo-codex-config-multi-agent-legacy-false-"))
    const configPath = join(root, "config.toml")
    await writeFile(
      configPath,
      [
        'model = "gpt-5.5"',
        "",
        "[features]",
        "multi_agent_v2 = false",
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
    expect(content).not.toMatch(/^multi_agent_v2\s*=/m)
    expect(content).toContain("[features.multi_agent_v2]")
    expect(content).toMatch(/\[features\.multi_agent_v2\]\nenabled = false\nmax_concurrent_threads_per_session = 16/)
  })

  test("#given legacy agents max_threads #when updating config #then raises the root subagent thread cap", async () => {
    // given
    // A pinned v1 model keeps the legacy low-cap raise path exercised; the
    // stamped v2-preferred default would remove agents.max_threads instead.
    const root = await mkdtemp(join(tmpdir(), "omo-codex-config-multi-agent-legacy-threads-"))
    const configPath = join(root, "config.toml")
    await writeFile(
      configPath,
      [
        'model = "gpt-5.5"',
        "",
        "[agents]",
        "max_threads = 16",
        "max_depth = 4",
        "job_max_runtime_seconds = 3600",
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
    expect(content).toContain("[features.multi_agent_v2]")
    const v2ThreadsSection = content.slice(content.indexOf("[features.multi_agent_v2]"))
      .split(/^\[/m).slice(0, 1).join("")
    expect(v2ThreadsSection).not.toContain("enabled")
    expect(content).toContain("max_concurrent_threads_per_session = 16")
    expect(content).toContain("[agents]")
    expect(content).toContain("max_threads = 1000")
    expect(content).not.toContain("max_threads = 16")
    expect(content).toContain("max_depth = 4")
    expect(content).toContain("job_max_runtime_seconds = 3600")
  })

  test("#given gpt-5.6 v2 model in models_cache #when updating config #then skips agents.max_threads and legacy disable", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-config-multi-agent-v2-preferred-"))
    const configPath = join(root, "config.toml")
    await writeFile(
      configPath,
      [
        'model = "gpt-5.6-sol"',
        "",
        "[features]",
        "multi_agent_v2 = false",
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
    expect(content).not.toMatch(/^\s*max_threads\s*=/m)
    expect(content).not.toMatch(/^\s*multi_agent_v2\s*=/m)
    expect(content).not.toMatch(/^\s*enabled\s*=\s*false/m)
    expect(content).toContain("max_depth = 4")
    expect(content).toContain("max_concurrent_threads_per_session = 16")
  })

  test("#given gpt-5.6 family model without models_cache #when updating config #then treats it as V2-preferred", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-config-multi-agent-v2-nocache-"))
    const configPath = join(root, "config.toml")
    await writeFile(configPath, ['model = "gpt-5.6-terra"', ""].join("\n"))

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
    expect(content).not.toMatch(/^\s*max_threads\s*=/m)
    expect(content).toContain("max_concurrent_threads_per_session = 16")
  })

  test("#given gpt-5.6-luna resolving v1 in models_cache #when updating config #then keeps the v1 thread cap", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-config-multi-agent-v1-luna-"))
    const configPath = join(root, "config.toml")
    await writeFile(configPath, ['model = "gpt-5.6-luna"', ""].join("\n"))
    await writeFile(
      join(root, "models_cache.json"),
      JSON.stringify({ models: [{ slug: "gpt-5.6-luna", multi_agent_version: "v1" }] }),
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

  test("#given user-modified config without root model #when updating config #then does not introduce agents.max_threads", async () => {
    // given: Codex Desktop selects the model in the UI; a user-modified config
    // (reasoning profile not applied) keeps no root model, so the installer
    // cannot prove the session is not a GPT-5.6 V2 model that rejects
    // agents.max_threads at thread/start (#6002).
    const root = await mkdtemp(join(tmpdir(), "omo-codex-config-multi-agent-no-model-"))
    const configPath = join(root, "config.toml")
    await writeFile(configPath, ['model_reasoning_effort = "high"', "", "[features]", "plugins = false", ""].join("\n"))

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
    expect(content).not.toMatch(/^\s*max_threads\s*=/m)
    expect(content).toContain("max_concurrent_threads_per_session = 16")
  })

  test("#given managed agent role sections #when updating config #then preserves role config while raising only root agents max_threads", async () => {
    // given
    // A pinned v1 model keeps the legacy low-cap raise path exercised; the
    // stamped v2-preferred default would remove agents.max_threads instead.
    const root = await mkdtemp(join(tmpdir(), "omo-codex-config-multi-agent-role-section-"))
    const configPath = join(root, "config.toml")
    await writeFile(
      configPath,
      [
        'model = "gpt-5.5"',
        "",
        "[agents]",
        "max_threads = 16",
        "",
        "[agents.explorer]",
        'description = "read-only explorer"',
        'config_file = "./agents/explorer.toml"',
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
      agentConfigs: [{ name: "explorer", configFile: "./agents/explorer.toml" }],
    })

    // then
    const content = await readFile(configPath, "utf8")
    expect(content).toContain("max_threads = 1000")
    expect(content).not.toContain("max_threads = 16")
    expect(content).toContain("[agents.explorer]")
    expect(content).toContain('description = "read-only explorer"')
    expect(content).toContain('config_file = "./agents/explorer.toml"')
  })

  test("writes config blocks and stays idempotent", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-config-"))
    const configPath = join(root, "config.toml")
    await writeFile(
      configPath,
      [
        "[marketplaces.code-yeongyu-codex-plugins]",
        'last_updated = "2026-05-01T00:00:00Z"',
        'source_type = "git"',
        'source = "https://github.com/code-yeongyu/codex-plugins.git"',
        "",
        '[plugins."omo@code-yeongyu-codex-plugins"]',
        "enabled = true",
        "",
        '[plugins."omo@code-yeongyu-codex-plugins".mcp_servers.lsp]',
        "enabled = true",
        "",
        "[hooks.state.'omo@code-yeongyu-codex-plugins:hooks/hooks.json:post_tool_use:0:0']",
        'trusted_hash = "sha256:old"',
        "",
        "[marketplaces.lazycodex]",
        'last_updated = "2026-05-10T00:00:00Z"',
        'source_type = "local"',
        'source = "/tmp/stale-lazycodex-cache"',
        "",
        '[plugins."omo@lazycodex"]',
        "enabled = true",
        "",
        "[hooks.state.'omo@lazycodex:hooks/hooks.json:post_tool_use:0:0']",
        'trusted_hash = "sha256:stale"',
        "",
      ].join("\n"),
    )

    // when
    await updateCodexConfig({
      configPath,
      repoRoot: "/repo/packages/omo-codex",
      marketplaceName: "sisyphuslabs",
      marketplaceSource: {
        sourceType: "local",
        source: "/repo/packages/omo-codex/cache/sisyphuslabs",
      },
      pluginNames: ["omo"],
      trustedHookStates: [{ key: "omo@sisyphuslabs:hooks/hooks.json:post_tool_use:0:0", trustedHash: "sha256:abc" }],
      agentConfigs: [
        { name: "explorer", configFile: "./agents/explorer.toml" },
        { name: "librarian", configFile: "./agents/librarian.toml" },
        { name: "plan", configFile: "./agents/plan.toml" },
      ],
    })
    await updateCodexConfig({
      configPath,
      repoRoot: "/repo/packages/omo-codex",
      marketplaceName: "sisyphuslabs",
      marketplaceSource: {
        sourceType: "local",
        source: "/repo/packages/omo-codex/cache/sisyphuslabs",
      },
      pluginNames: ["omo"],
      trustedHookStates: [{ key: "omo@sisyphuslabs:hooks/hooks.json:post_tool_use:0:0", trustedHash: "sha256:abc" }],
      agentConfigs: [
        { name: "explorer", configFile: "./agents/explorer.toml" },
        { name: "librarian", configFile: "./agents/librarian.toml" },
        { name: "plan", configFile: "./agents/plan.toml" },
      ],
    })

    // then
    const content = await readFile(configPath, "utf8")
    expect(content).toContain("[features]")
    expect(content).toContain("plugins = true")
    expect(content).toContain("plugin_hooks = true")
    expect(content).toContain("[marketplaces.sisyphuslabs]")
    expect(content).toContain('source_type = "local"')
    expect(content).toContain('source = "/repo/packages/omo-codex/cache/sisyphuslabs"')
    expect(content).not.toContain('source = "https://github.com/code-yeongyu/lazycodex.git"')
    expect(content).not.toContain('ref = "main"')
    expect(content).toContain("[plugins.\"omo@sisyphuslabs\"]")
    expect(content).toContain("[hooks.state.\"omo@sisyphuslabs:hooks/hooks.json:post_tool_use:0:0\"]")
    expect(content).toContain("[agents.explorer]")
    expect(content).toContain('config_file = "./agents/explorer.toml"')
    expect(content).toContain("[agents.librarian]")
    expect(content).toContain('config_file = "./agents/librarian.toml"')
    expect(content).toContain("[agents.plan]")
    expect(content).toContain('config_file = "./agents/plan.toml"')
    expect(content).not.toContain("[marketplaces.lazycodex]")
    expect(content).not.toContain("omo@lazycodex")
    expect(content).not.toContain("/tmp/stale-lazycodex-cache")
    expect(content).not.toContain("code-yeongyu-codex-plugins")
  })

  test("#given marketplace bootstrap preserves source #when marketplace block exists #then existing source stays byte-identical", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-config-preserve-marketplace-"))
    const configPath = join(root, "config.toml")
    const existingMarketplaceBlock = [
      "[marketplaces.sisyphuslabs]",
      'last_updated = "2026-06-15T00:00:00Z"',
      'source_type = "git"',
      'source = "https://github.com/code-yeongyu/lazycodex.git"',
      'ref = "main"',
    ].join("\n")
    await writeFile(configPath, `${existingMarketplaceBlock}\n`)

    // when
    await updateCodexConfig({
      configPath,
      repoRoot: "/repo/packages/omo-codex",
      marketplaceName: "sisyphuslabs",
      marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex" },
      pluginNames: ["omo"],
      preserveMarketplaceSource: true,
    })

    // then
    const content = await readFile(configPath, "utf8")
    expect(content).toContain(existingMarketplaceBlock)
    expect(content).not.toContain('source = "/repo/packages/omo-codex"')
  })

  test("#given config path is a symlink #when updating config #then writes through target and preserves link", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-config-symlink-"))
    const targetPath = join(root, "target.toml")
    const configPath = join(root, "config.toml")
    await writeFile(targetPath, "")
    await symlink(targetPath, configPath)

    // when
    await updateCodexConfig({
      configPath,
      repoRoot: "/repo/packages/omo-codex",
      marketplaceName: "debug",
      marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex" },
      pluginNames: ["omo"],
    })

    // then
    const linkStats = await lstat(configPath)
    const content = await readFile(targetPath, "utf8")
    expect(linkStats.isSymbolicLink()).toBe(true)
    expect(content).toContain("[marketplaces.debug]")
    expect(content).toContain("[plugins.\"omo@debug\"]")
  })

  test("repairs existing agent config_file entries without dropping descriptions", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-config-agents-"))
    const configPath = join(root, "config.toml")
    await writeFile(
      configPath,
      [
        "[agents.explorer]",
        'description = "existing description"',
        'config_file = "./agents/stale-explorer.toml"',
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
      agentConfigs: [{ name: "explorer", configFile: "./agents/explorer.toml" }],
    })

    // then
    const content = await readFile(configPath, "utf8")
    expect(content).toContain("[agents.explorer]")
    expect(content).toContain('description = "existing description"')
    expect(content).toContain('config_file = "./agents/explorer.toml"')
    expect(content).not.toContain("stale-explorer")
    expect(content).not.toContain("ref = undefined")
  })

  test("#given git marketplace source #when updating config #then writes second-precision timestamp and ref", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-config-marketplace-git-"))
    const configPath = join(root, "config.toml")

    // when
    await updateCodexConfig({
      configPath,
      repoRoot: "/repo/packages/omo-codex",
      marketplaceName: "debug",
      marketplaceSource: {
        sourceType: "git",
        source: "https://github.com/code-yeongyu/lazycodex.git",
        ref: "main",
      },
      pluginNames: ["omo"],
    })

    // then
    const content = await readFile(configPath, "utf8")
    const lastUpdatedLine = content.split("\n").find((line) => line.startsWith("last_updated = "))
    expect(lastUpdatedLine ?? "").toMatch(/^last_updated = "\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z"$/)
    expect(content).toContain('source_type = "git"')
    expect(content).toContain('source = "https://github.com/code-yeongyu/lazycodex.git"')
    expect(content).toContain('ref = "main"')
  })

  test("#given agent name needs quoting #when updating config #then writes quoted agent key", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-config-quoted-agent-"))
    const configPath = join(root, "config.toml")

    // when
    await updateCodexConfig({
      configPath,
      repoRoot: "/repo/packages/omo-codex",
      marketplaceName: "debug",
      marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex" },
      pluginNames: ["omo"],
      agentConfigs: [{ name: "review.agent", configFile: "./agents/review.agent.toml" }],
    })

    // then
    const content = await readFile(configPath, "utf8")
    expect(content).toContain('[agents."review.agent"]')
    expect(content).toContain('config_file = "./agents/review.agent.toml"')
  })

})

  test("#given model_catalog_json declares a v2 family model as v1 #when updating config #then keeps agents.max_threads", async () => {
    // given: Codex documents model_catalog_json as a complete replacement for
    // models_cache.json (codex-rs load_model_catalog). A user forcing gpt-5.6-sol
    // to v1 via that catalog must keep the v1 thread cap (lazycodex#120).
    const root = await mkdtemp(join(tmpdir(), "omo-codex-config-model-catalog-override-"))
    const configPath = join(root, "config.toml")
    const catalogPath = join(root, "custom-catalog.json")
    await writeFile(configPath, [
      'model = "gpt-5.6-sol"',
      `model_catalog_json = "${catalogPath}"`,
      "",
      "[features]",
      "multi_agent_v2 = false",
      "",
    ].join("\n"))
    await writeFile(catalogPath, JSON.stringify({ models: [{ slug: "gpt-5.6-sol", multi_agent_version: "v1" }] }))

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
