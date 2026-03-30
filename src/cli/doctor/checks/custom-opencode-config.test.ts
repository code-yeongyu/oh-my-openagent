import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"

const hostConfigPath = new URL("../../../../assets/custom-opencode/opencode.json", import.meta.url)
const pluginConfigPath = new URL("../../../../assets/custom-opencode/oh-my-opencode.json", import.meta.url)
const wrapperPluginPath = new URL("../../../../assets/custom-opencode/plugins/oh-my-openagent.js", import.meta.url)

const EXECUTION_PROMPT_APPEND = "Before substantive work in any repository, first check whether the root AGENTS.md exists and matches the current project. If it is missing, outdated, or clearly incomplete, create or refresh it immediately before major edits. Keep it concise and factual. Add nested AGENTS.md files only when the repository is large or conventions differ by subtree. Maintain these files as you learn the repo's structure, commands, tests, conventions, and gotchas. If execution begins via /start-work, an approved Prometheus handoff, or an active boulder, treat that as explicit permission to implement. In execution mode, drive the plan to completion, keep delegating and verifying until all planned work is done, and do not stop at interim summaries or partial progress. Return control early only for destructive or irreversible actions, materially missing information, or hard environment blockers that cannot be solved from the repo."
const PROMETHEUS_PROMPT_APPEND = "Before substantive work in any repository, first check whether the root AGENTS.md exists and matches the current project. If it is missing, outdated, or clearly incomplete, create or refresh it immediately before major edits. Keep it concise and factual. Add nested AGENTS.md files only when the repository is large or conventions differ by subtree. Maintain these files as you learn the repo's structure, commands, tests, conventions, and gotchas. You are the planning and negotiation front door. Stay in planning mode, resolve scope and tradeoffs with the user, and finish with a concrete executable plan plus /start-work guidance. Do not execute the plan yourself unless the user explicitly overrides this role."

const REQUIRED_AGENTS = [
  "sisyphus",
  "hephaestus",
  "oracle",
  "librarian",
  "explore",
  "multimodal-looker",
  "prometheus",
  "metis",
  "momus",
  "atlas",
  "sisyphus-junior",
] as const

const REQUIRED_CATEGORIES = [
  "visual-engineering",
  "ultrabrain",
  "deep",
  "artistry",
  "quick",
  "unspecified-low",
  "unspecified-high",
  "writing",
] as const

const EXPECTED_MODEL = "openai/gpt-5.4"
const EXPECTED_VARIANT = "xhigh"
const EXPECTED_TEXT_VERBOSITY = "high"

const hostConfig = JSON.parse(readFileSync(hostConfigPath, "utf-8")) as {
  $schema?: string
  default_agent?: string
  plugin?: string[]
}

const pluginConfigContents = readFileSync(pluginConfigPath, "utf-8")
const pluginConfig = JSON.parse(pluginConfigContents) as {
  $schema?: string
  agents?: Record<string, Record<string, unknown>>
  categories?: Record<string, Record<string, unknown>>
  background_task?: {
    staleTimeoutMs?: number
  }
  hashline_edit?: boolean
  sisyphus?: {
    tasks?: Record<string, unknown>
  }
  babysitting?: {
    timeout_ms?: number
  }
  model_capabilities?: {
    refresh_timeout_ms?: number
  }
  experimental?: {
    auto_resume?: boolean
  }
  notification?: {
    force_enable?: boolean
  }
}

const wrapperPluginContents = readFileSync(wrapperPluginPath, "utf-8")

describe("managed custom OpenCode config assets", () => {
  it("keeps explicit wrapper-plugin registration in the host config", () => {
    expect(hostConfig.default_agent).toBe("prometheus")
    expect(hostConfig.plugin).toEqual(["./plugins/oh-my-openagent.js"])
  })

  it("pins the required agents and categories to the validated model settings", () => {
    for (const agentName of REQUIRED_AGENTS) {
      const agentConfig = pluginConfig.agents?.[agentName]

      expect(agentConfig?.model).toBe(EXPECTED_MODEL)
      expect(agentConfig?.variant).toBe(EXPECTED_VARIANT)
      expect(agentConfig?.textVerbosity).toBe(EXPECTED_TEXT_VERBOSITY)
    }

    for (const categoryName of REQUIRED_CATEGORIES) {
      const categoryConfig = pluginConfig.categories?.[categoryName]

      expect(categoryConfig?.model).toBe(EXPECTED_MODEL)
      expect(categoryConfig?.variant).toBe(EXPECTED_VARIANT)
      expect(categoryConfig?.textVerbosity).toBe(EXPECTED_TEXT_VERBOSITY)
    }
  })

  it("preserves the audited prompt_append text only for the intended agents", () => {
    expect(pluginConfig.agents?.sisyphus?.prompt_append).toBe(EXECUTION_PROMPT_APPEND)
    expect(pluginConfig.agents?.hephaestus?.prompt_append).toBe(EXECUTION_PROMPT_APPEND)
    expect(pluginConfig.agents?.atlas?.prompt_append).toBe(EXECUTION_PROMPT_APPEND)
    expect(pluginConfig.agents?.["sisyphus-junior"]?.prompt_append).toBe(EXECUTION_PROMPT_APPEND)
    expect(pluginConfig.agents?.prometheus?.prompt_append).toBe(PROMETHEUS_PROMPT_APPEND)

    expect(pluginConfig.agents?.oracle?.prompt_append).toBeUndefined()
    expect(pluginConfig.agents?.librarian?.prompt_append).toBeUndefined()
    expect(pluginConfig.agents?.explore?.prompt_append).toBeUndefined()
  })

  it("keeps the intentional runtime knob changes while removing unsupported drift", () => {
    expect(pluginConfig.$schema).toBe("./node_modules/oh-my-openagent/dist/oh-my-opencode.schema.json")
    expect(pluginConfigContents).not.toContain("raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/oh-my-opencode.schema.json")

    expect(pluginConfig.hashline_edit).toBe(true)
    expect(pluginConfig.background_task?.staleTimeoutMs).toBe(600000)
    expect(pluginConfig.babysitting?.timeout_ms).toBe(300000)
    expect(pluginConfig.model_capabilities?.refresh_timeout_ms).toBe(10000)
    expect(pluginConfig.experimental?.auto_resume).toBe(true)
    expect(pluginConfig.notification?.force_enable).toBe(true)

    expect(pluginConfig.sisyphus?.tasks).toEqual({
      storage_path: ".sisyphus/tasks",
      claude_code_compat: false,
    })
    expect(pluginConfig.sisyphus?.tasks?.enabled).toBeUndefined()

    if (/"tasks"\s*:\s*\{[^}]*"enabled"/s.test(pluginConfigContents)) {
      throw new Error("Managed config must not reintroduce sisyphus.tasks.enabled.")
    }
  })

  it("keeps the wrapper plugin minimal and pointed at the preferred plugin identity", () => {
    expect(wrapperPluginContents).toContain('import OhMyOpenAgent from "oh-my-openagent"')
    expect(wrapperPluginContents).toContain("export const OhMyOpenAgentPlugin = OhMyOpenAgent")
  })
})
