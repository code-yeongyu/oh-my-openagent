/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createConfigHandler, getLastConfigHandlerPhaseTiming } from "./config-handler"
import { applyMcpConfig, buildClaudeMcpCacheKey } from "./mcp-config-handler"
import { resetProcessConfigCacheForTests } from "../shared/process-config-cache"
import { createModelCacheState } from "../plugin-state"
import type { OhMyOpenCodeConfig } from "../config"

// Local fix 31 (cross-review A M3/M4/M7). No module mocks: the real loaders run
// against the hermetic home, with the Claude config directory redirected per test.

const baseConfig = (): Record<string, unknown> => ({
  formatter: { enabled: false },
  model: "provider/model",
})

const agentKeys = (config: Record<string, unknown>, pattern: RegExp) =>
  Object.keys(config.agent as Record<string, unknown>).filter((key) => pattern.test(key))
const hasPrompt = (config: Record<string, unknown>, text: string) =>
  Object.values(config.agent as Record<string, Record<string, unknown>>).some(
    (agent) => typeof agent.prompt === "string" && agent.prompt.includes(text),
  )
const build = (directory: string, pluginConfig: OhMyOpenCodeConfig) =>
  createConfigHandler({ ctx: { directory }, pluginConfig, modelCacheState: createModelCacheState() })

describe("config handler effective cache keys (local fix 31)", () => {
  let tempRoot: string
  let claudeHome: string
  let folderA: string
  let folderB: string
  const savedClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR

  beforeEach(() => {
    resetProcessConfigCacheForTests()
    delete process.env.OMO_DISABLE_PROCESS_CONFIG_CACHE
    tempRoot = mkdtempSync(join(tmpdir(), "omo-eff-"))
    claudeHome = join(tempRoot, "claude-home")
    folderA = join(tempRoot, "chats", "chat-a")
    folderB = join(tempRoot, "chats", "chat-b")
    for (const directory of [claudeHome, folderA, folderB]) mkdirSync(directory, { recursive: true })
    process.env.CLAUDE_CONFIG_DIR = claudeHome
  })

  afterEach(() => {
    if (savedClaudeConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = savedClaudeConfigDir
    rmSync(tempRoot, { recursive: true, force: true })
  })

  test("a different effective OMO config never replays another instance's agents", async () => {
    const configA = baseConfig()
    await build(folderA, { disabled_agents: [] } as unknown as OhMyOpenCodeConfig)(configA)
    expect(agentKeys(configA, /oracle/i).length).toBeGreaterThan(0)

    const configB = baseConfig()
    await build(folderB, { disabled_agents: ["oracle"] } as unknown as OhMyOpenCodeConfig)(configB)
    expect(getLastConfigHandlerPhaseTiming()?.agentsCacheHit).toBe(false)
    expect(agentKeys(configB, /oracle/i)).toEqual([])

    // The same config in another empty folder still shares the snapshot.
    const configC = baseConfig()
    await build(folderA, { disabled_agents: ["oracle"] } as unknown as OhMyOpenCodeConfig)(configC)
    expect(getLastConfigHandlerPhaseTiming()?.agentsCacheHit).toBe(true)
    expect(configC.agent).toEqual(configB.agent)

    resetProcessConfigCacheForTests()
    const fresh = baseConfig()
    await build(folderB, { disabled_agents: ["oracle"] } as unknown as OhMyOpenCodeConfig)(fresh)
    expect(fresh.agent).toEqual(configB.agent)
  })

  test("a project agent added below an existing source directory is picked up by the same handler", async () => {
    const project = join(tempRoot, "project")
    mkdirSync(join(project, ".claude", "agents"), { recursive: true })
    writeFileSync(
      join(project, ".claude", "agents", "first.md"),
      "---\ndescription: first\nmode: subagent\n---\nfirst project agent\n",
    )
    const handler = build(project, {} as OhMyOpenCodeConfig)
    const initial = baseConfig()
    await handler(initial)
    expect(hasPrompt(initial, "first project agent")).toBe(true)

    const repeated = baseConfig()
    await handler(repeated)
    expect(getLastConfigHandlerPhaseTiming()?.agentsCacheHit).toBe(true)

    writeFileSync(
      join(project, ".claude", "agents", "second.md"),
      "---\ndescription: second\nmode: subagent\n---\nsecond project agent\n",
    )
    const afterAdd = baseConfig()
    await handler(afterAdd)
    expect(getLastConfigHandlerPhaseTiming()?.agentsCacheHit).toBe(false)
    expect(hasPrompt(afterAdd, "second project agent")).toBe(true)

    writeFileSync(
      join(project, ".claude", "agents", "first.md"),
      "---\ndescription: first\nmode: subagent\n---\nfirst project agent, edited in place\n",
    )
    const afterEdit = baseConfig()
    await build(project, {} as OhMyOpenCodeConfig)(afterEdit)
    expect(getLastConfigHandlerPhaseTiming()?.agentsCacheHit).toBe(false)
    expect(hasPrompt(afterEdit, "edited in place")).toBe(true)
  })

  test("a user skill or command added after the first load invalidates agents and commands", async () => {
    const first = baseConfig()
    await build(folderA, {} as OhMyOpenCodeConfig)(first)
    const second = baseConfig()
    await build(folderB, {} as OhMyOpenCodeConfig)(second)
    expect(getLastConfigHandlerPhaseTiming()?.agentsCacheHit).toBe(true)
    expect(Object.keys(second.command as Record<string, unknown>)).not.toContain("late-command")

    mkdirSync(join(claudeHome, "commands"), { recursive: true })
    writeFileSync(join(claudeHome, "commands", "late-command.md"), "---\ndescription: late\n---\nrun the late command\n")
    mkdirSync(join(claudeHome, "skills", "late-skill"), { recursive: true })
    writeFileSync(
      join(claudeHome, "skills", "late-skill", "SKILL.md"),
      "---\nname: late-skill\ndescription: added after the first load\n---\n# late skill\n",
    )

    const third = baseConfig()
    await build(folderA, {} as OhMyOpenCodeConfig)(third)
    expect(getLastConfigHandlerPhaseTiming()?.agentsCacheHit).toBe(false)
    const commands = Object.keys(third.command as Record<string, unknown>)
    expect(commands).toContain("late-command")
    expect(commands).toContain("late-skill")
  })

  test("a Claude Code MCP file added after the first load is loaded", async () => {
    const pluginComponents = { commands: {}, skills: {}, agents: {}, mcpServers: {}, hooksConfigs: [], plugins: [], errors: [] }
    const pluginConfig = {} as OhMyOpenCodeConfig
    const before: Record<string, unknown> = {}
    await applyMcpConfig({ config: before, ctx: { directory: folderA }, pluginConfig, pluginComponents })
    expect(Object.keys(before.mcp as Record<string, unknown>)).not.toContain("late-server")
    const keyBefore = buildClaudeMcpCacheKey([], [])

    writeFileSync(
      join(claudeHome, ".mcp.json"),
      JSON.stringify({ mcpServers: { "late-server": { command: "node", args: ["server.js"] } } }),
    )
    expect(buildClaudeMcpCacheKey([], [])).not.toBe(keyBefore)
    const after: Record<string, unknown> = {}
    await applyMcpConfig({ config: after, ctx: { directory: folderB }, pluginConfig, pluginComponents })
    expect(Object.keys(after.mcp as Record<string, unknown>)).toContain("late-server")

    // The environment the transformer expands from and the allowlist are part of the key.
    const keyAfter = buildClaudeMcpCacheKey([], [])
    process.env.OMO_EFFECTIVE_KEY_PROBE = "1"
    try {
      expect(buildClaudeMcpCacheKey([], [])).not.toBe(keyAfter)
    } finally {
      delete process.env.OMO_EFFECTIVE_KEY_PROBE
    }
    expect(buildClaudeMcpCacheKey([], ["EXTRA_VAR"])).not.toBe(keyAfter)
  })
})
