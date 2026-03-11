import type { AgentConfig } from "@opencode-ai/sdk"
import { COUNCIL_DEFAULTS, resolveAthenaNonInteractiveMode } from "./index"
import { registerCouncilMemberAgents, ATHENA_JUNIOR_COUNCIL_MEMBER_KEY_PREFIX } from "../builtin-agents/council-member-agents"
import { applyMissingCouncilGuard } from "../builtin-agents/athena-council-guard"
import type { CouncilConfig } from "../../config/schema/athena"
import type { AthenaNonInteractiveConfig } from "./types"
import { log } from "../../shared"

export interface CouncilPromptConfig {
  retryOnFail: number
  retryIfFinished: boolean
  cancelOnQuorum: boolean
  stuckThreshold: number
  memberMaxRunning: number
  bulkLaunch: boolean
  athenaNonInteractiveConfig?: AthenaNonInteractiveConfig
}

/**
 * Build Step 5.2 content for individual member launching
 */
export function buildStep5_2Individual(): string {
  return `## Step 5.2: For each selected member, call the task tool with:
  - subagent_type: the exact member name from your available council members listed below (e.g., "Council: Claude Opus 4.6")
  - run_in_background: true
  - write_output_to_file: true
  - prompt: "Read <path> for your instructions." (where <path> is the file path from Step 5.1)
  - load_skills: []
  - description: the member name (e.g., "Council: Claude Opus 4.6")
- Launch ALL selected members before collecting any results.
- Track every returned task_id and member mapping.
- IMPORTANT: Use EXACTLY the subagent_type names listed in your available council members below — they MUST match precisely.`
}

/**
 * Build Step 5.2 content for bulk member launching
 */
export function buildStep5_2Bulk(): string {
  return `## Step 5.2: Call athena_council to launch ALL members at once:
- prompt_file: the path returned from Step 5.1
- members: the resolved member names from Step 4 (omit to launch all configured members)

athena_council launches all members in parallel and returns structured output with launched members, retryRules, and quorumRules.
Track every launched[].task_id from the response for use in Step 6.
Prefer the returned retryRules/quorumRules over any earlier structured rule output.`
}

/**
 * Build council task instructions with member list and configuration
 */
export function buildCouncilTaskInstructions(
  registeredKeys: string[],
  skippedMembers: Array<{ name: string; reason: string }>,
): string {
  const memberList = registeredKeys.map((key) => `- "${key}"`).join("\n")
  let instructions = `\n\n## Registered Council Members\n\nUse these as subagent_type in task calls:\n\n${memberList}`

  if (skippedMembers.length > 0) {
    const skipDetails = skippedMembers.map((m) => `- **${m.name}**: ${m.reason}`).join("\n")
    instructions += `\n\n> **Note**: Some configured council members were skipped:\n${skipDetails}`
    log("[athena-helpers] Some council members were skipped during registration", { skippedMembers })
  }

  return instructions
}

/**
 * Apply council configuration to Athena agent prompt
 */
export function applyCouncilConfigToAthenaPrompt(
  prompt: string,
  config: CouncilPromptConfig,
): string {
  return prompt
    .replace(/\{RETRY_ON_FAIL\}/g, String(config.retryOnFail))
    .replace(/\{RETRY_FAILED_IF_OTHERS_FINISHED\}/g, String(config.retryIfFinished))
    .replace(/\{CANCEL_RETRYING_ON_QUORUM\}/g, String(config.cancelOnQuorum))
    .replace(/\{STUCK_THRESHOLD_SECONDS\}/g, String(config.stuckThreshold))
    .replace(/\{MEMBER_MAX_RUNNING_SECONDS\}/g, String(config.memberMaxRunning))
    .replace(/\{MEMBER_WAIT_TIMEOUT_MS\}/g, String(COUNCIL_DEFAULTS.MEMBER_WAIT_TIMEOUT_MS))
    .replace(/\{BULK_LAUNCH_STEP_5_2\}/g, config.bulkLaunch ? buildStep5_2Bulk() : buildStep5_2Individual())
}

/**
 * Apply council configuration to Athena-Junior agent prompt
 */
export function applyCouncilConfigToAthenaJuniorPrompt(
  prompt: string,
  config: CouncilPromptConfig,
): string {
  return prompt
    .replace(/\{RETRY_ON_FAIL\}/g, String(config.retryOnFail))
    .replace(/\{RETRY_FAILED_IF_OTHERS_FINISHED\}/g, String(config.retryIfFinished))
    .replace(/\{CANCEL_RETRYING_ON_QUORUM\}/g, String(config.cancelOnQuorum))
    .replace(/\{STUCK_THRESHOLD_SECONDS\}/g, String(config.stuckThreshold))
    .replace(/\{MEMBER_MAX_RUNNING_SECONDS\}/g, String(config.memberMaxRunning))
    .replace(/\{NON_INTERACTIVE_MODE\}/g, config.athenaNonInteractiveConfig?.non_interactive_mode ?? "delegation")
    .replace(/\{NON_INTERACTIVE_MEMBERS\}/g, config.athenaNonInteractiveConfig?.non_interactive_members ?? "all")
    .replace(/\{NON_INTERACTIVE_MEMBER_LIST\}/g, JSON.stringify(config.athenaNonInteractiveConfig?.non_interactive_member_list ?? []))
    .replace(/\{MEMBER_WAIT_TIMEOUT_MS\}/g, String(COUNCIL_DEFAULTS.MEMBER_WAIT_TIMEOUT_MS))
}

/**
 * Register and configure Athena council agents
 */
export function registerAndConfigureAthenaCouncil(
  agents: Record<string, AgentConfig>,
  councilConfig: CouncilConfig,
  athenaNonInteractiveConfig?: AthenaNonInteractiveConfig,
  bulkLaunch = false,
): Record<string, AgentConfig> {
  const result = { ...agents }

  if (!councilConfig?.members || councilConfig.members.length < 2) {
    // Apply missing council guard if no valid council
    if (result["athena"]) {
      result["athena"] = applyMissingCouncilGuard(result["athena"])
    }
    if (result["athena-junior"]) {
      result["athena-junior"] = applyMissingCouncilGuard(result["athena-junior"])
    }
    return result
  }

  if (!result["athena"] && !result["athena-junior"]) {
    log("[athena-helpers] Skipping council member registration — Athena and Athena-Junior are disabled")
    return result
  }

  // Register council members
  const { agents: councilAgents, registeredKeys, skippedMembers } = registerCouncilMemberAgents(councilConfig)
  for (const [key, config] of Object.entries(councilAgents)) {
    result[key] = config
  }

  // Register Athena-Junior council members if Athena-Junior is enabled
  if (result["athena-junior"]) {
    const juniorMode = resolveAthenaNonInteractiveMode(athenaNonInteractiveConfig?.non_interactive_mode)
    const { agents: athenaJuniorCouncilAgents } = registerCouncilMemberAgents(
      councilConfig,
      juniorMode,
      ATHENA_JUNIOR_COUNCIL_MEMBER_KEY_PREFIX,
    )

    for (const [key, config] of Object.entries(athenaJuniorCouncilAgents)) {
      result[key] = { ...config, hidden: true }
    }
  }

  // Apply council configuration to prompts
  if (registeredKeys.length > 0) {
    const councilTaskInstructions = buildCouncilTaskInstructions(registeredKeys, skippedMembers)

    const promptConfig: CouncilPromptConfig = {
      retryOnFail: councilConfig.retry_on_fail ?? 0,
      retryIfFinished: councilConfig.retry_failed_if_others_finished ?? false,
      cancelOnQuorum: councilConfig.cancel_retrying_on_quorum ?? true,
      stuckThreshold: councilConfig.stuck_threshold_seconds ?? COUNCIL_DEFAULTS.STUCK_THRESHOLD_SECONDS,
      memberMaxRunning: councilConfig.member_max_running_seconds ?? COUNCIL_DEFAULTS.MEMBER_MAX_RUNNING_SECONDS,
      bulkLaunch,
      athenaNonInteractiveConfig,
    }

    if (result["athena"]) {
      const athenaPrompt = (result["athena"].prompt ?? "") + councilTaskInstructions
      result["athena"] = {
        ...result["athena"],
        prompt: applyCouncilConfigToAthenaPrompt(athenaPrompt, promptConfig),
      }
    }

    if (result["athena-junior"]) {
      const athenaJuniorPrompt = (result["athena-junior"].prompt ?? "") + councilTaskInstructions
      result["athena-junior"] = {
        ...result["athena-junior"],
        prompt: applyCouncilConfigToAthenaJuniorPrompt(athenaJuniorPrompt, promptConfig),
      }
    }
  } else {
    // No registered keys, apply missing council guard
    if (result["athena"]) {
      result["athena"] = applyMissingCouncilGuard(result["athena"], skippedMembers)
    }
    if (result["athena-junior"]) {
      result["athena-junior"] = applyMissingCouncilGuard(result["athena-junior"], skippedMembers)
    }
  }

  return result
}
