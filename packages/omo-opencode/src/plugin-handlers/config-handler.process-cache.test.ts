/// <reference types="bun-types" />

import { beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createConfigHandler, getLastConfigHandlerPhaseTiming } from "./config-handler"
import { resetProcessConfigCacheForTests } from "../shared/process-config-cache"
import { createModelCacheState } from "../plugin-state"
import type { OhMyOpenCodeConfig } from "../config"

// This suite intentionally uses NO module mocks: the shared logger/agent-name
// barrels are imported by dozens of other test files, and mocking them leaks
// across files sharing a worker. The real sub-handlers run against the
// hermetic home (empty ~/.claude, empty plugin roots), which is both fast and
// a stronger assertion: it proves cross-folder reuse is output-equivalent for
// the real applyAgentConfig, not a mocked one.

const pluginConfig = {} as OhMyOpenCodeConfig

const baseConfig = (): Record<string, unknown> => ({
  formatter: { enabled: false },
  model: "provider/model",
})

describe("config handler process-level snapshot reuse (local fix 28, first-message-drop F5c)", () => {
  let tempRoot: string
  let emptyFolderA: string
  let emptyFolderB: string

  beforeEach(() => {
    resetProcessConfigCacheForTests()
    delete process.env.OMO_DISABLE_PROCESS_CONFIG_CACHE
    tempRoot = mkdtempSync(join(tmpdir(), "omo-cfg-"))
    emptyFolderA = join(tempRoot, "chat-a")
    emptyFolderB = join(tempRoot, "chat-b")
    mkdirSync(emptyFolderA)
    mkdirSync(emptyFolderB)
  })

  test("a rebuilt instance of the same folder reuses the agent snapshot", async () => {
    const first = createConfigHandler({
      ctx: { directory: emptyFolderA },
      pluginConfig,
      modelCacheState: createModelCacheState(),
    })
    const configA = baseConfig()
    await first(configA)
    expect(getLastConfigHandlerPhaseTiming()?.agentsCacheHit).toBe(false)
    expect(Object.keys(configA.agent as Record<string, unknown>).length).toBeGreaterThan(0)

    // A rebuild creates a brand-new handler instance for the same folder.
    const rebuilt = createConfigHandler({
      ctx: { directory: emptyFolderA },
      pluginConfig,
      modelCacheState: createModelCacheState(),
    })
    const configB = baseConfig()
    await rebuilt(configB)

    expect(getLastConfigHandlerPhaseTiming()?.agentsCacheHit).toBe(true)
    expect(configB.agent).toEqual(configA.agent)
    expect(configB.default_agent).toBe(configA.default_agent)
    expect(getLastConfigHandlerPhaseTiming()?.componentsCacheHit).toBe(true)
  })

  test("a different empty chat folder shares the snapshot with identical output", async () => {
    const handlerA = createConfigHandler({
      ctx: { directory: emptyFolderA },
      pluginConfig,
      modelCacheState: createModelCacheState(),
    })
    const configA = baseConfig()
    await handlerA(configA)

    const handlerB = createConfigHandler({
      ctx: { directory: emptyFolderB },
      pluginConfig,
      modelCacheState: createModelCacheState(),
    })
    const configB = baseConfig()
    await handlerB(configB)

    expect(getLastConfigHandlerPhaseTiming()?.agentsCacheHit).toBe(true)
    // Output-equivalence proof for the REAL agent pipeline: two distinct empty
    // folders produce deep-equal agent configs, so sharing the snapshot is
    // behavior-preserving (no directory is baked into agent definitions).
    expect(configB.agent).toEqual(configA.agent)
  })

  test("a folder with project sources gets its own snapshot", async () => {
    const projectFolder = join(tempRoot, "project-folder")
    mkdirSync(join(projectFolder, ".claude", "agents"), { recursive: true })
    writeFileSync(
      join(projectFolder, ".claude", "agents", "project-helper.md"),
      "---\ndescription: project helper\nmode: subagent\n---\nhelps the project\n",
    )

    const handlerA = createConfigHandler({
      ctx: { directory: emptyFolderA },
      pluginConfig,
      modelCacheState: createModelCacheState(),
    })
    const configA = baseConfig()
    await handlerA(configA)

    const handlerProject = createConfigHandler({
      ctx: { directory: projectFolder },
      pluginConfig,
      modelCacheState: createModelCacheState(),
    })
    const configProject = baseConfig()
    await handlerProject(configProject)

    expect(getLastConfigHandlerPhaseTiming()?.agentsCacheHit).toBe(false)
    const projectAgents = configProject.agent as Record<string, Record<string, unknown>>
    const helper = Object.values(projectAgents).find((agent) =>
      typeof agent.prompt === "string" ? agent.prompt.includes("helps the project") : false,
    )
    expect(helper).toBeDefined()

    const emptyAgents = configA.agent as Record<string, unknown>
    expect(Object.keys(projectAgents).length).toBeGreaterThan(Object.keys(emptyAgents).length)
  })

  test("a changed OpenCode config slice recomputes instead of reusing", async () => {
    const handler = createConfigHandler({
      ctx: { directory: emptyFolderA },
      pluginConfig,
      modelCacheState: createModelCacheState(),
    })
    await handler(baseConfig())

    const changedConfig = baseConfig()
    changedConfig.model = "provider/other-model"
    await createConfigHandler({
      ctx: { directory: emptyFolderA },
      pluginConfig,
      modelCacheState: createModelCacheState(),
    })(changedConfig)

    expect(getLastConfigHandlerPhaseTiming()?.agentsCacheHit).toBe(false)
  })

  test("phase timing is recorded with all phases and cache flags (local fix 29, F16)", async () => {
    const handler = createConfigHandler({
      ctx: { directory: emptyFolderA },
      pluginConfig,
      modelCacheState: createModelCacheState(),
    })
    await handler(baseConfig())

    const timing = getLastConfigHandlerPhaseTiming()
    expect(timing).toBeDefined()
    expect(timing?.total).toBeGreaterThanOrEqual(0)
    expect(timing?.provider).toBeGreaterThanOrEqual(0)
    expect(timing?.pluginComponents).toBeGreaterThanOrEqual(0)
    expect(timing?.hooks).toBeGreaterThanOrEqual(0)
    expect(timing?.tools).toBeGreaterThanOrEqual(0)
    expect(timing?.mcp).toBeGreaterThanOrEqual(0)
    expect(timing?.commands).toBeGreaterThanOrEqual(0)
    expect(timing?.agentsCacheHit).toBe(false)
    expect(timing?.directory).toBe(emptyFolderA)
  })
})
