import { afterEach, beforeEach, expect, spyOn, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import * as agents from "../agents"
import * as skills from "./agent-skill-discovery"
import * as commands from "./command-config-handler"
import * as mcps from "./mcp-config-handler"
import * as plugins from "./plugin-components-loader"
import { createConfigHandler } from "./config-handler"
import { hasProjectAgentProvenance, replaceProjectAgentProvenance } from "../features/team-mode/final-open-code-agent-registry"

const restorers: Array<{ mockRestore(): void }> = []
let directory: string

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), "project-agent-cache-"))
  mkdirSync(path.join(directory, ".opencode", "agents"), { recursive: true })
  restorers.push(
    spyOn(agents, "createBuiltinAgents").mockResolvedValue({}),
    spyOn(skills, "discoverAgentSkills").mockResolvedValue([]),
    spyOn(commands, "applyCommandConfig").mockResolvedValue(undefined),
    spyOn(mcps, "applyMcpConfig").mockResolvedValue(undefined),
    spyOn(plugins, "loadPluginComponents").mockResolvedValue({
      commands: {}, skills: {}, agents: {}, mcpServers: {}, hooksConfigs: [], plugins: [], errors: [],
    }),
  )
})

afterEach(() => {
  for (const restorer of restorers.splice(0)) restorer.mockRestore()
  rmSync(directory, { recursive: true, force: true })
})

function writeAgent(name = "project-worker", prompt = "first source") {
  writeFileSync(path.join(directory, ".opencode", "agents", `${name}.md`),
    `---\ndescription: project worker\nmode: subagent\n---\n${prompt}\n`)
}

function handler() {
  return createConfigHandler({
    ctx: { directory },
    pluginConfig: { sisyphus_agent: { disabled: true }, claude_code: { agents: false } },
    modelCacheState: { anthropicContext1MEnabled: false, modelContextLimitsCache: new Map() },
  })
}

test("captures project provenance and replays it on a config cache hit", async () => {
  writeAgent()
  const apply = handler()
  await apply({ agent: {} })
  expect(hasProjectAgentProvenance(directory, "project-worker")).toBe(true)
  replaceProjectAgentProvenance(directory, [])
  await apply({ agent: {} })
  expect(hasProjectAgentProvenance(directory, "project-worker")).toBe(true)
})

test("invalidates unchanged incoming config when a project source changes or disappears", async () => {
  writeAgent()
  const apply = handler()
  await apply({ agent: {} })
  writeAgent("project-worker", "changed source")
  const changed: Record<string, unknown> = { agent: {} }
  await apply(changed)
  expect(JSON.stringify(changed.agent)).toContain("changed source")
  rmSync(path.join(directory, ".opencode", "agents", "project-worker.md"))
  await apply({ agent: {} })
  expect(hasProjectAgentProvenance(directory, "project-worker")).toBe(false)
})

test("clears stale provenance before a failed cold config refresh", async () => {
  writeAgent()
  const apply = handler()
  await apply({ agent: {} })
  const failure = spyOn(agents, "createBuiltinAgents").mockRejectedValueOnce(new Error("refresh failed"))
  restorers.push(failure)
  await expect(apply({ model: "qa/changed", agent: {} })).rejects.toThrow("refresh failed")
  expect(hasProjectAgentProvenance(directory, "project-worker")).toBe(false)
})

test("does not attribute a later OpenCode config definition or host-only entry to a project file", async () => {
  writeAgent()
  writeFileSync(path.join(directory, ".opencode", "opencode.jsonc"), JSON.stringify({
    agent: { "project-worker": { mode: "subagent", prompt: "later source" } },
  }))
  await handler()({ agent: { "host-only": { mode: "subagent" } } })
  expect(hasProjectAgentProvenance(directory, "project-worker")).toBe(false)
  expect(hasProjectAgentProvenance(directory, "host-only")).toBe(false)
})

test("does not attribute a filtered project collision to the surviving protected built-in", async () => {
  writeAgent("oracle")
  const builtin = spyOn(agents, "createBuiltinAgents").mockResolvedValue({ oracle: { mode: "subagent", prompt: "builtin" } })
  restorers.push(builtin)
  await handler()({ agent: {} })
  expect(hasProjectAgentProvenance(directory, "oracle")).toBe(false)
})
