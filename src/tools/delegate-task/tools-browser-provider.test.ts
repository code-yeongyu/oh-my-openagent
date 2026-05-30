/// <reference types="bun-types" />

import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { clearSkillCache } from "../../features/opencode-skill-loader/skill-content"

declare const require: NodeJS.Require

const { afterEach, beforeEach, describe, expect, test } = require("bun:test")

const SYSTEM_DEFAULT_MODEL = "anthropic/claude-sonnet-4-6"
const TOOL_CONTEXT = {
  sessionID: "parent-session",
  messageID: "parent-message",
  agent: "sisyphus",
  abort: new AbortController().signal,
}

type EnvSnapshot = Record<"CLAUDE_CONFIG_DIR" | "OPENCODE_CONFIG_DIR", string | undefined>
type PromptBody = { system?: string }
type PromptInput = { body?: PromptBody }

let envSnapshot: EnvSnapshot
let testConfigDir: string | undefined

function restoreEnvValue(key: keyof EnvSnapshot): void {
  const value = envSnapshot[key]
  if (value === undefined) {
    delete process.env[key]
    return
  }

  process.env[key] = value
}

function createAgentBrowserSkillFixture(content: string): void {
  const unique = `delegate-agent-browser-${Date.now()}-${Math.random().toString(16).slice(2)}`
  testConfigDir = join(tmpdir(), unique)
  const skillDir = join(testConfigDir, "skills", "compound-engineering", "agent-browser")
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(
    join(skillDir, "SKILL.md"),
    `---\nname: agent-browser\ndescription: Test-owned browser automation skill\n---\n${content}`,
  )
  process.env.CLAUDE_CONFIG_DIR = testConfigDir
  process.env.OPENCODE_CONFIG_DIR = testConfigDir
  clearSkillCache()
}

describe("delegate task browserProvider propagation", () => {
  beforeEach(() => {
    envSnapshot = {
      CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
      OPENCODE_CONFIG_DIR: process.env.OPENCODE_CONFIG_DIR,
    }
    testConfigDir = undefined
    clearSkillCache()
  })

  afterEach(() => {
    restoreEnvValue("CLAUDE_CONFIG_DIR")
    restoreEnvValue("OPENCODE_CONFIG_DIR")
    clearSkillCache()
    if (testConfigDir !== undefined) {
      rmSync(testConfigDir, { recursive: true, force: true })
    }
  })

  test("resolves agent-browser builtin skill when browserProvider is passed", async () => {
    // given
    const { createDelegateTask } = require("./tools")
    let promptBody: PromptBody | undefined
    const promptMock = async (input: PromptInput) => {
      promptBody = input.body
      return { data: {} }
    }
    const mockClient = {
      app: { agents: async () => ({ data: [] }) },
      config: { get: async () => ({ data: { model: SYSTEM_DEFAULT_MODEL } }) },
      session: {
        get: async () => ({ data: { directory: "/project" } }),
        create: async () => ({ data: { id: "ses_browser_provider" } }),
        prompt: promptMock,
        promptAsync: promptMock,
        messages: async () => ({
          data: [{ info: { role: "assistant" }, parts: [{ type: "text", text: "Done" }] }],
        }),
        status: async () => ({ data: {} }),
      },
    }
    const tool = createDelegateTask({
      manager: { launch: async () => ({}) },
      client: mockClient,
      browserProvider: "agent-browser",
    })

    // when
    await tool.execute(
      {
        description: "Test browserProvider propagation",
        prompt: "Do something",
        category: "ultrabrain",
        run_in_background: false,
        load_skills: ["agent-browser"],
      },
      TOOL_CONTEXT,
    )

    // then
    const system = promptBody?.system ?? ""
    expect(system).toContain("agent-browser")
    expect(system).toContain("<Category_Context>")
    expect(system.startsWith("<Category_Context>")).toBe(false)
  }, { timeout: 20000 })

  test("resolves discovered agent-browser skill by short name without browserProvider", async () => {
    // given
    const fixtureContent = "Test-owned agent-browser fixture content"
    createAgentBrowserSkillFixture(fixtureContent)
    const { createDelegateTask } = require("./tools")
    let promptBody: PromptBody | undefined
    const promptMock = async (input: PromptInput) => {
      promptBody = input.body
      return { data: {} }
    }
    const mockClient = {
      app: { agents: async () => ({ data: [] }) },
      config: { get: async () => ({ data: { model: SYSTEM_DEFAULT_MODEL } }) },
      session: {
        get: async () => ({ data: { directory: "/project" } }),
        create: async () => ({ data: { id: "ses_no_browser_provider" } }),
        prompt: promptMock,
        promptAsync: promptMock,
        messages: async () => ({
          data: [{ info: { role: "assistant" }, parts: [{ type: "text", text: "Done" }] }],
        }),
        status: async () => ({ data: {} }),
      },
    }
    const tool = createDelegateTask({
      manager: { launch: async () => ({}) },
      client: mockClient,
    })

    // when
    const result = await tool.execute(
      {
        description: "Test missing browserProvider",
        prompt: "Do something",
        category: "ultrabrain",
        run_in_background: false,
        load_skills: ["agent-browser"],
      },
      TOOL_CONTEXT,
    )

    // then
    expect(result).toContain("Task completed")
    expect(result).toContain("ses_no_browser_provider")
    expect(promptBody?.system).toContain(fixtureContent)
  })
})
