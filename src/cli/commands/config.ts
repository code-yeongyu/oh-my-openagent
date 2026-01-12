import * as p from "@clack/prompts"
import color from "picocolors"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { parseJsonc, getOpenCodeConfigPaths } from "../../shared"

const SYMBOLS = {
  check: color.green("✓"),
  arrow: color.cyan("→"),
  bullet: color.dim("•"),
}

const CONFIGURABLE_AGENTS = [
  { value: "Sisyphus", label: "Sisyphus", hint: "Main orchestrator agent" },
  { value: "oracle", label: "oracle", hint: "Debugging and architecture consultant" },
  { value: "librarian", label: "librarian", hint: "Documentation and external references" },
  { value: "explore", label: "explore", hint: "Codebase exploration and search" },
  { value: "frontend-ui-ux-engineer", label: "frontend-ui-ux-engineer", hint: "UI/UX design and implementation" },
  { value: "document-writer", label: "document-writer", hint: "Technical documentation" },
  { value: "multimodal-looker", label: "multimodal-looker", hint: "Image and PDF analysis" },
  { value: "Metis (Plan Consultant)", label: "Metis (Plan Consultant)", hint: "Pre-planning analysis" },
  { value: "Momus (Plan Reviewer)", label: "Momus (Plan Reviewer)", hint: "Plan evaluation" },
  { value: "orchestrator-sisyphus", label: "orchestrator-sisyphus", hint: "Orchestration mode" },
] as const

const MODEL_GROUPS = [
  {
    name: "Anthropic",
    models: [
      { value: "anthropic/claude-opus-4-5", label: "claude-opus-4-5", hint: "Highest quality, slower" },
      { value: "anthropic/claude-sonnet-4-5", label: "claude-sonnet-4-5", hint: "Balanced quality and speed" },
      { value: "anthropic/claude-haiku-4-5", label: "claude-haiku-4-5", hint: "Fast and efficient" },
    ],
  },
  {
    name: "OpenAI",
    models: [
      { value: "openai/gpt-5.2", label: "gpt-5.2", hint: "Latest GPT model" },
      { value: "openai/gpt-5.2-codex", label: "gpt-5.2-codex", hint: "Optimized for code" },
      { value: "openai/gpt-5.1-codex-max", label: "gpt-5.1-codex-max", hint: "Extended context" },
    ],
  },
  {
    name: "Google (Antigravity)",
    models: [
      { value: "google/antigravity-gemini-3-pro-high", label: "gemini-3-pro-high", hint: "Multimodal, thinking enabled" },
      { value: "google/antigravity-gemini-3-pro-low", label: "gemini-3-pro-low", hint: "Multimodal, faster" },
      { value: "google/antigravity-gemini-3-flash", label: "gemini-3-flash", hint: "Fast and efficient" },
    ],
  },
  {
    name: "Free",
    models: [
      { value: "opencode/glm-4.7-free", label: "glm-4.7-free", hint: "Free tier, no subscription needed" },
    ],
  },
]

interface OmoConfig {
  $schema?: string
  agents?: Record<string, { model?: string; [key: string]: unknown }>
  [key: string]: unknown
}

function getOmoConfigPath(): string {
  const paths = getOpenCodeConfigPaths({ binary: "opencode", version: null })
  return paths.omoConfig
}

function loadOmoConfig(): OmoConfig {
  const configPath = getOmoConfigPath()
  
  if (!existsSync(configPath)) {
    return {
      $schema: "https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/master/assets/oh-my-opencode.schema.json",
    }
  }
  
  try {
    const content = readFileSync(configPath, "utf-8")
    const config = parseJsonc<OmoConfig>(content)
    return config ?? {}
  } catch {
    return {}
  }
}

function saveOmoConfig(config: OmoConfig): void {
  const configPath = getOmoConfigPath()
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n")
}

function getCurrentModel(config: OmoConfig, agentName: string): string | undefined {
  return config.agents?.[agentName]?.model
}

function getDefaultModel(agentName: string): string {
  const defaults: Record<string, string> = {
    "Sisyphus": "anthropic/claude-opus-4-5",
    "oracle": "openai/gpt-5.2",
    "librarian": "opencode/glm-4.7-free",
    "explore": "opencode/glm-4.7-free",
    "frontend-ui-ux-engineer": "google/antigravity-gemini-3-pro-high",
    "document-writer": "google/antigravity-gemini-3-flash",
    "multimodal-looker": "google/antigravity-gemini-3-flash",
    "Metis (Plan Consultant)": "anthropic/claude-opus-4-5",
    "Momus (Plan Reviewer)": "anthropic/claude-opus-4-5",
    "orchestrator-sisyphus": "anthropic/claude-opus-4-5",
  }
  return defaults[agentName] ?? "opencode/glm-4.7-free"
}

function formatModelDisplay(model: string): string {
  const parts = model.split("/")
  return parts.length > 1 ? parts[1] : model
}

function buildModelOptions() {
  const options: Array<{ value: string; label: string; hint?: string }> = []
  
  for (const group of MODEL_GROUPS) {
    options.push({
      value: `__separator_${group.name}`,
      label: color.dim(`── ${group.name} ──`),
      hint: "",
    })
    
    for (const model of group.models) {
      options.push(model)
    }
  }
  
  return options
}

export async function configureAgents(): Promise<number> {
  p.intro(color.bgMagenta(color.white(" oMoMoMoMo... Agent Configuration ")))
  
  const config = loadOmoConfig()
  
  const agentOptions = CONFIGURABLE_AGENTS.map((agent) => {
    const currentModel = getCurrentModel(config, agent.value)
    const displayModel = currentModel 
      ? formatModelDisplay(currentModel)
      : color.dim(`(default: ${formatModelDisplay(getDefaultModel(agent.value))})`)
    
    return {
      value: agent.value,
      label: `${agent.label}`,
      hint: `${SYMBOLS.arrow} ${currentModel ? color.cyan(displayModel) : displayModel}`,
    }
  })
  
  const selectedAgent = await p.select({
    message: "Select an agent to configure:",
    options: agentOptions,
  })
  
  if (p.isCancel(selectedAgent)) {
    p.cancel("Configuration cancelled.")
    return 0
  }
  
  const agentName = selectedAgent as string
  const currentModel = getCurrentModel(config, agentName) ?? getDefaultModel(agentName)
  
  p.log.info(`Current model for ${color.bold(agentName)}: ${color.cyan(formatModelDisplay(currentModel))}`)
  
  const allModelOptions = buildModelOptions()
  const selectableModels = allModelOptions.filter((opt) => !opt.value.startsWith("__separator_"))
  
  const initialModel = selectableModels.find((m) => m.value === currentModel)?.value ?? selectableModels[0].value
  
  const selectedModel = await p.select({
    message: `Select a model for ${color.bold(agentName)}:`,
    options: selectableModels,
    initialValue: initialModel,
  })
  
  if (p.isCancel(selectedModel)) {
    p.cancel("Configuration cancelled.")
    return 0
  }
  
  const newModel = selectedModel as string
  
  if (!config.agents) {
    config.agents = {}
  }
  
  if (!config.agents[agentName]) {
    config.agents[agentName] = {}
  }
  
  config.agents[agentName].model = newModel
  
  if (!config.$schema) {
    config.$schema = "https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/master/assets/oh-my-opencode.schema.json"
  }
  
  const s = p.spinner()
  s.start("Saving configuration")
  
  try {
    saveOmoConfig(config)
    s.stop(`Configuration saved to ${color.cyan(getOmoConfigPath())}`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    s.stop(`Failed to save configuration: ${message}`)
    return 1
  }
  
  p.log.success(`${SYMBOLS.check} Updated ${color.bold(agentName)} ${SYMBOLS.arrow} ${color.cyan(formatModelDisplay(newModel))}`)
  
  const configureAnother = await p.confirm({
    message: "Configure another agent?",
    initialValue: false,
  })
  
  if (p.isCancel(configureAnother)) {
    p.outro(color.green("Configuration complete!"))
    return 0
  }
  
  if (configureAnother) {
    return configureAgents()
  }
  
  p.outro(color.green("Configuration complete!"))
  return 0
}

export async function listAgentModels(): Promise<number> {
  const config = loadOmoConfig()
  
  console.log()
  console.log(color.bold(color.white("Current Agent Model Configuration")))
  console.log(color.dim("─".repeat(50)))
  console.log()
  
  for (const agent of CONFIGURABLE_AGENTS) {
    const currentModel = getCurrentModel(config, agent.value)
    const displayModel = currentModel 
      ? color.cyan(formatModelDisplay(currentModel))
      : color.dim(`(default: ${formatModelDisplay(getDefaultModel(agent.value))})`)
    
    const agentLabel = agent.value.padEnd(25)
    console.log(`  ${SYMBOLS.bullet} ${agentLabel} ${SYMBOLS.arrow} ${displayModel}`)
  }
  
  console.log()
  console.log(color.dim(`Config file: ${getOmoConfigPath()}`))
  console.log()
  
  return 0
}
