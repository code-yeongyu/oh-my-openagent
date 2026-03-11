import type { AgentConfig } from "@opencode-ai/sdk"
import type { BuiltinAgentName, AgentOverrides, AgentFactory, AgentPromptMetadata } from "./types"
import type { CategoriesConfig, GitMasterConfig } from "../config/schema"
import type { LoadedSkill } from "../features/opencode-skill-loader/types"
import type { BrowserAutomationProvider } from "../config/schema"
import { createSisyphusAgent } from "./sisyphus"
import { createOracleAgent, ORACLE_PROMPT_METADATA } from "./oracle"
import { createLibrarianAgent, LIBRARIAN_PROMPT_METADATA } from "./librarian"
import { createExploreAgent, EXPLORE_PROMPT_METADATA } from "./explore"
import { createMultimodalLookerAgent, MULTIMODAL_LOOKER_PROMPT_METADATA } from "./multimodal-looker"
import { createMetisAgent, metisPromptMetadata } from "./metis"
import { createAtlasAgent, atlasPromptMetadata } from "./atlas"
import { createMomusAgent, momusPromptMetadata } from "./momus"
import { createHephaestusAgent } from "./hephaestus"
import { createAthenaAgent, createAthenaJuniorAgent, ATHENA_JUNIOR_PROMPT_METADATA, COUNCIL_DEFAULTS } from "./athena"
import { createSisyphusJuniorAgentWithOverrides } from "./sisyphus-junior"
import type { AvailableCategory } from "./dynamic-agent-prompt-builder"
import {
  fetchAvailableModels,
  readConnectedProvidersCache,
  readProviderModelsCache,
  log,
} from "../shared"
import { CATEGORY_DESCRIPTIONS } from "../tools/delegate-task/constants"
import { mergeCategories } from "../shared/merge-categories"
import { buildAvailableSkills } from "./builtin-agents/available-skills"
import { collectPendingBuiltinAgents } from "./builtin-agents/general-agents"
import { maybeCreateSisyphusConfig } from "./builtin-agents/sisyphus-agent"
import { maybeCreateHephaestusConfig } from "./builtin-agents/hephaestus-agent"
import { maybeCreateAtlasConfig } from "./builtin-agents/atlas-agent"
import { buildCustomAgentMetadata, parseRegisteredAgentSummaries } from "./custom-agent-summaries"
import { registerCouncilMemberAgents } from "./builtin-agents/council-member-agents"
import { applyMissingCouncilGuard } from "./builtin-agents/athena-council-guard"
import type { CouncilConfig } from "../config/schema/athena"

type AgentSource = AgentFactory | AgentConfig

const agentSources: Partial<Record<BuiltinAgentName, AgentSource>> = {
  sisyphus: createSisyphusAgent,
  hephaestus: createHephaestusAgent,
  oracle: createOracleAgent,
  librarian: createLibrarianAgent,
  explore: createExploreAgent,
  "multimodal-looker": createMultimodalLookerAgent,
  metis: createMetisAgent,
  momus: createMomusAgent,
  athena: createAthenaAgent,
  "athena-junior": createAthenaJuniorAgent,
  // Note: Atlas is handled specially in createBuiltinAgents()
  // because it needs OrchestratorContext, not just a model string
  atlas: createAtlasAgent as AgentFactory,
  "sisyphus-junior": createSisyphusJuniorAgentWithOverrides as unknown as AgentFactory,
}

/**
 * Metadata for each agent, used to build Sisyphus's dynamic prompt sections
 * (Delegation Table, Tool Selection, Key Triggers, etc.)
 */
const agentMetadata: Partial<Record<BuiltinAgentName, AgentPromptMetadata>> = {
  oracle: ORACLE_PROMPT_METADATA,
  librarian: LIBRARIAN_PROMPT_METADATA,
  explore: EXPLORE_PROMPT_METADATA,
  "multimodal-looker": MULTIMODAL_LOOKER_PROMPT_METADATA,
  metis: metisPromptMetadata,
  momus: momusPromptMetadata,
  "athena-junior": ATHENA_JUNIOR_PROMPT_METADATA,
  atlas: atlasPromptMetadata,
}

export async function createBuiltinAgents(
  disabledAgents: string[] = [],
  agentOverrides: AgentOverrides = {},
  directory?: string,
  systemDefaultModel?: string,
  categories?: CategoriesConfig,
  gitMasterConfig?: GitMasterConfig,
  discoveredSkills: LoadedSkill[] = [],
  customAgentSummaries?: unknown,
  browserProvider?: BrowserAutomationProvider,
  uiSelectedModel?: string,
  disabledSkills?: Set<string>,
  useTaskSystem = false,
  councilConfig?: CouncilConfig,
  disableOmoEnv = false,
  bulkLaunch = false,
  athenaNonInteractiveConfig?: {
    non_interactive_mode?: string
    non_interactive_members?: string
    non_interactive_member_list?: string[]
  },
): Promise<Record<string, AgentConfig>> {

  const connectedProviders = readConnectedProvidersCache()
  const providerModelsConnected = connectedProviders
    ? (readProviderModelsCache()?.connected ?? [])
    : []
  const mergedConnectedProviders = Array.from(
    new Set([...(connectedProviders ?? []), ...providerModelsConnected])
  )
  // IMPORTANT: Do NOT call OpenCode client APIs during plugin initialization.
  // This function is called from config handler, and calling client API causes deadlock.
  // See: https://github.com/code-yeongyu/oh-my-openagent/issues/1301
  const availableModels = await fetchAvailableModels(undefined, {
    connectedProviders: mergedConnectedProviders.length > 0 ? mergedConnectedProviders : undefined,
  })
  const isFirstRunNoCache =
    availableModels.size === 0 && mergedConnectedProviders.length === 0

  const result: Record<string, AgentConfig> = {}

  const mergedCategories = mergeCategories(categories)

  const availableCategories: AvailableCategory[] = Object.entries(mergedCategories).map(([name]) => ({
    name,
    description: categories?.[name]?.description ?? CATEGORY_DESCRIPTIONS[name] ?? "General tasks",
  }))

  const availableSkills = buildAvailableSkills(discoveredSkills, browserProvider, disabledSkills)

  // Collect general agents first (for availableAgents), but don't add to result yet
  const { pendingAgentConfigs, availableAgents } = collectPendingBuiltinAgents({
    agentSources,
    agentMetadata,
    disabledAgents,
    agentOverrides,
    directory,
    systemDefaultModel,
    mergedCategories,
    gitMasterConfig,
    browserProvider,
    uiSelectedModel,
    availableModels,
    disabledSkills,
    disableOmoEnv,
  })

  const registeredAgents = parseRegisteredAgentSummaries(customAgentSummaries)
  const builtinAgentNames = new Set(Object.keys(agentSources).map((name) => name.toLowerCase()))
  const disabledAgentNames = new Set(disabledAgents.map((name) => name.toLowerCase()))

  for (const agent of registeredAgents) {
    const lowerName = agent.name.toLowerCase()
    if (builtinAgentNames.has(lowerName)) continue
    if (disabledAgentNames.has(lowerName)) continue
    if (availableAgents.some((availableAgent) => availableAgent.name.toLowerCase() === lowerName)) continue

    availableAgents.push({
      name: agent.name,
      description: agent.description,
      metadata: buildCustomAgentMetadata(agent.name, agent.description),
    })
  }

  const sisyphusConfig = maybeCreateSisyphusConfig({
    disabledAgents,
    agentOverrides,
    uiSelectedModel,
    availableModels,
    systemDefaultModel,
    isFirstRunNoCache,
    availableAgents,
    availableSkills,
    availableCategories,
    mergedCategories,
    directory,
    userCategories: categories,
    useTaskSystem,
    disableOmoEnv,
  })
  if (sisyphusConfig) {
    result["sisyphus"] = sisyphusConfig
  }

  const hephaestusConfig = maybeCreateHephaestusConfig({
    disabledAgents,
    agentOverrides,
    availableModels,
    systemDefaultModel,
    isFirstRunNoCache,
    availableAgents,
    availableSkills,
    availableCategories,
    mergedCategories,
    directory,
    useTaskSystem,
    disableOmoEnv,
  })
  if (hephaestusConfig) {
    result["hephaestus"] = hephaestusConfig
  }

  // Add pending agents after sisyphus and hephaestus to maintain order
  for (const [name, config] of pendingAgentConfigs) {
    result[name] = config
  }

  const atlasConfig = maybeCreateAtlasConfig({
    disabledAgents,
    agentOverrides,
    uiSelectedModel,
    availableModels,
    systemDefaultModel,
    availableAgents,
    availableSkills,
    mergedCategories,
    directory,
    userCategories: categories,
  })
  if (atlasConfig) {
    result["atlas"] = atlasConfig
  }

  if (councilConfig?.members && councilConfig.members.length >= 2 && (result["athena"] || result["athena-junior"])) {
    const { agents: councilAgents, registeredKeys, skippedMembers } = registerCouncilMemberAgents(councilConfig)
    for (const [key, config] of Object.entries(councilAgents)) {
      result[key] = config
    }

    if (registeredKeys.length > 0) {
      const memberList = registeredKeys.map((key) => `- "${key}"`).join("\n")
      let councilTaskInstructions = `\n\n## Registered Council Members\n\nUse these as subagent_type in task calls:\n\n${memberList}`

      if (skippedMembers.length > 0) {
        const skipDetails = skippedMembers.map((m) => `- **${m.name}**: ${m.reason}`).join("\n")
        councilTaskInstructions += `\n\n> **Note**: Some configured council members were skipped:\n${skipDetails}`
        log("[builtin-agents] Some council members were skipped during registration", { skippedMembers })
      }

      const retryOnFail = councilConfig.retry_on_fail ?? 0
      const retryIfFinished = councilConfig.retry_failed_if_others_finished ?? false
      const cancelOnQuorum = councilConfig.cancel_retrying_on_quorum ?? true
      const stuckThreshold = councilConfig.stuck_threshold_seconds ?? COUNCIL_DEFAULTS.STUCK_THRESHOLD_SECONDS
      const memberMaxRunning = councilConfig.member_max_running_seconds ?? COUNCIL_DEFAULTS.MEMBER_MAX_RUNNING_SECONDS
      const resilienceConfig = `\n\n## Council Resilience Config\n- retry_on_fail: ${retryOnFail}\n- retry_failed_if_others_finished: ${retryIfFinished}\n- cancel_retrying_on_quorum: ${cancelOnQuorum}\n- stuck_threshold_seconds: ${stuckThreshold}\n- member_max_running_seconds: ${memberMaxRunning}`

      const step5_2_individual = `## Step 5.2: For each selected member, call the task tool with:
  - subagent_type: the exact member name from your available council members listed below (e.g., "Council: Claude Opus 4.6")
  - run_in_background: true
  - write_output_to_file: true
  - prompt: "Read <path> for your instructions." (where <path> is the file path from Step 5.1)
  - load_skills: []
  - description: the member name (e.g., "Council: Claude Opus 4.6")
- Launch ALL selected members before collecting any results.
- Track every returned task_id and member mapping.
- IMPORTANT: Use EXACTLY the subagent_type names listed in your available council members below — they MUST match precisely.`

      const step5_2_bulk = `## Step 5.2: Call athena_council to launch ALL members at once:
- prompt_file: the path returned from Step 5.1
- members: the resolved member names from Step 4 (omit to launch all configured members)

athena_council launches all members in parallel and returns JSON with task IDs.
Track every task_id from the response for use in Step 6.`

      const step5_2Content = bulkLaunch ? step5_2_bulk : step5_2_individual

      if (result["athena"]) {
        let athenaPrompt = (result["athena"].prompt ?? "") + councilTaskInstructions
        athenaPrompt = athenaPrompt
          .replace(/\{RETRY_ON_FAIL\}/g, String(retryOnFail))
          .replace(/\{RETRY_FAILED_IF_OTHERS_FINISHED\}/g, String(retryIfFinished))
          .replace(/\{CANCEL_RETRYING_ON_QUORUM\}/g, String(cancelOnQuorum))
          .replace(/\{STUCK_THRESHOLD_SECONDS\}/g, String(stuckThreshold))
          .replace(/\{MEMBER_MAX_RUNNING_SECONDS\}/g, String(memberMaxRunning))
          .replace(/\{MEMBER_WAIT_TIMEOUT_MS\}/g, String(COUNCIL_DEFAULTS.MEMBER_WAIT_TIMEOUT_MS))
          .replace(/\{BULK_LAUNCH_STEP_5_2\}/g, step5_2Content)
        athenaPrompt += resilienceConfig
        result["athena"] = { ...result["athena"], prompt: athenaPrompt }
      }

      if (result["athena-junior"]) {
        let athenaJuniorPrompt = (result["athena-junior"].prompt ?? "") + councilTaskInstructions
        athenaJuniorPrompt = athenaJuniorPrompt
          .replace(/\{RETRY_ON_FAIL\}/g, String(retryOnFail))
          .replace(/\{RETRY_FAILED_IF_OTHERS_FINISHED\}/g, String(retryIfFinished))
          .replace(/\{CANCEL_RETRYING_ON_QUORUM\}/g, String(cancelOnQuorum))
          .replace(/\{STUCK_THRESHOLD_SECONDS\}/g, String(stuckThreshold))
          .replace(/\{MEMBER_MAX_RUNNING_SECONDS\}/g, String(memberMaxRunning))
          .replace(/\{NON_INTERACTIVE_MODE\}/g, athenaNonInteractiveConfig?.non_interactive_mode ?? "delegation")
          .replace(/\{NON_INTERACTIVE_MEMBERS\}/g, athenaNonInteractiveConfig?.non_interactive_members ?? "all")
          .replace(/\{NON_INTERACTIVE_MEMBER_LIST\}/g, JSON.stringify(athenaNonInteractiveConfig?.non_interactive_member_list ?? []))
          .replace(/\{MEMBER_WAIT_TIMEOUT_MS\}/g, String(COUNCIL_DEFAULTS.MEMBER_WAIT_TIMEOUT_MS))
        athenaJuniorPrompt += resilienceConfig
        result["athena-junior"] = { ...result["athena-junior"], prompt: athenaJuniorPrompt }
      }
    } else {
      if (result["athena"]) {
        result["athena"] = applyMissingCouncilGuard(result["athena"], skippedMembers)
      }
      if (result["athena-junior"]) {
        result["athena-junior"] = applyMissingCouncilGuard(result["athena-junior"], skippedMembers)
      }
    }
  } else if (councilConfig?.members && councilConfig.members.length >= 2) {
    log("[builtin-agents] Skipping council member registration — Athena and Athena-Junior are disabled")
  } else {
    if (result["athena"]) {
      result["athena"] = applyMissingCouncilGuard(result["athena"])
    }
    if (result["athena-junior"]) {
      result["athena-junior"] = applyMissingCouncilGuard(result["athena-junior"])
    }
  }

  return result
}
