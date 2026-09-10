/// <reference types="bun-types" />
import assert from "node:assert/strict"
import { readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const [mode, home, repo, evidence] = process.argv.slice(2)
assert.ok(mode && home && repo && evidence)
const text = readFileSync(join(home, "config.toml"), "utf8")
const config = Bun.TOML.parse(text) as Record<string, unknown>
const agents = config.agents as Record<string, { config_file?: string }>
const features = config.features as { multi_agent_v2?: { max_concurrent_threads_per_session?: number } }
const roles = Object.entries(agents).filter(([key]) => key !== "max_threads")
assert.equal(roles.length, 12)
assert.equal((text.match(/^\[agents\./gm) ?? []).length, 12)
const installedAgents = roles.map(([role, settings]) => {
  assert.ok(typeof settings.config_file === "string")
  const path = join(home, settings.config_file)
  const agent = Bun.TOML.parse(readFileSync(path, "utf8")) as Record<string, unknown>
  assert.equal(agent.model, "gpt-6-astra")
  return { role, model: agent.model, effort: agent.model_reasoning_effort }
})
const cache = join(home, "plugins/cache/sisyphuslabs/omo")
const versions = readdirSync(cache)
assert.equal(versions.length, 1)
const cacheManifest = JSON.parse(readFileSync(join(cache, versions[0], ".codex-plugin/plugin.json"), "utf8"))
const installedManifest = JSON.parse(readFileSync(join(home, ".tmp/marketplaces/sisyphuslabs/plugins/omo/.codex-plugin/plugin.json"), "utf8"))
const sourceManifest = JSON.parse(readFileSync(join(repo, "packages/omo-codex/plugin/.codex-plugin/plugin.json"), "utf8"))
assert.equal(installedManifest.hooks.length, sourceManifest.hooks.length)
assert.deepEqual(installedManifest.hooks, sourceManifest.hooks)
const windowsOnlyHooks = [
  "./hooks/pre-tool-use-recommending-git-bash-mcp.json",
  "./hooks/post-compact-resetting-git-bash-mcp-reminder.json",
]
assert.deepEqual(cacheManifest.hooks, sourceManifest.hooks.filter((hook: string) => !windowsOnlyHooks.includes(hook)))
assert.equal(Object.hasOwn(agents, "max_threads"), false)
if (mode === "preservation") {
  assert.equal(config.model, "gpt-5.6-terra")
  assert.equal(config.model_reasoning_effort, "medium")
  assert.equal(features.multi_agent_v2?.max_concurrent_threads_per_session, 4)
} else {
  assert.equal(config.model, "gpt-6-astra")
  assert.equal(config.model_context_window, 600000)
  assert.equal(config.model_reasoning_effort, "high")
  assert.equal(config.plan_mode_reasoning_effort, "xhigh")
  assert.equal(Object.hasOwn(features.multi_agent_v2 ?? {}, "max_concurrent_threads_per_session"), false)
  assert.equal(/max_threads|max_concurrent_threads_per_session/.test(text), false)
}
if (mode === "agent-preservation") {
  assert.equal(installedAgents.find((agent) => agent.role === "explorer")?.effort, "xhigh")
}
writeFileSync(join(evidence, `task-7-${mode}-config.toml`), text)
const result = {
  mode, home, model: config.model, model_context_window: config.model_context_window,
  model_reasoning_effort: config.model_reasoning_effort,
  plan_mode_reasoning_effort: config.plan_mode_reasoning_effort,
  agents: installedAgents, agentBlocks: roles.length,
  installedHookCount: installedManifest.hooks.length, sourceHookCount: sourceManifest.hooks.length,
  installedManifestSurface: ".tmp/marketplaces/sisyphuslabs/plugins/omo/.codex-plugin/plugin.json",
  cacheHookCount: cacheManifest.hooks.length,
  cacheVsSourceCountEqual: cacheManifest.hooks.length === sourceManifest.hooks.length,
  cacheRemovedHooks: windowsOnlyHooks,
  customV2Cap: features.multi_agent_v2?.max_concurrent_threads_per_session ?? null,
  passed: true,
}
writeFileSync(join(evidence, `task-7-${mode}-assertions.json`), JSON.stringify(result, null, 2) + "\n")
console.log(JSON.stringify(result))
