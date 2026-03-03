import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { readFile } from "node:fs/promises"
import type { BackgroundManager } from "../../features/background-agent"
import type { CouncilConfig, CouncilMemberConfig } from "../../config/schema/athena"
import { launchCouncilMember, type CouncilLaunchContext } from "./council-launcher"
import type { AthenaCouncilToolArgs, LaunchedMemberInfo, AthenaCouncilResult } from "./types"
import { log } from "../../shared/logger"

const SESSION_WAIT_INTERVAL_MS = 100
const SESSION_WAIT_TIMEOUT_MS = 30_000

function buildToolDescription(councilConfig: CouncilConfig | undefined): string {
  const memberList = councilConfig?.members.length
    ? councilConfig.members.map((m) => `- ${m.name} (${m.model})`).join("\n")
    : "No members configured."

  return `Launch all council members in parallel for multi-model analysis.

Takes a prompt file path (from prepare_council_prompt) and launches all specified council members
as background tasks. Returns an array of task IDs for use with background_wait and background_output.

Available council members:
${memberList}

Returns JSON with launched task IDs and any launch failures.`
}

function filterMembers(
  allMembers: CouncilMemberConfig[],
  selectedNames: string[] | undefined,
): { members: CouncilMemberConfig[]; error?: string } {
  if (!selectedNames || selectedNames.length === 0) {
    return { members: allMembers }
  }

  const lookup = new Map<string, CouncilMemberConfig>()
  for (const member of allMembers) {
    lookup.set(member.model.toLowerCase(), member)
    if (member.name) {
      lookup.set(member.name.toLowerCase(), member)
    }
  }

  const filtered: CouncilMemberConfig[] = []
  const seen = new Set<CouncilMemberConfig>()
  const unresolved: string[] = []

  for (const name of selectedNames) {
    const match = lookup.get(name.toLowerCase())
    if (!match) {
      unresolved.push(name)
      continue
    }
    if (!seen.has(match)) {
      seen.add(match)
      filtered.push(match)
    }
  }

  if (unresolved.length > 0) {
    const available = allMembers.map((m) => m.name ?? m.model).join(", ")
    return { members: [], error: `Unknown council members: ${unresolved.join(", ")}. Available: ${available}` }
  }

  return { members: filtered }
}

/**
 * Waits briefly for background sessions to acquire session IDs.
 * Non-blocking — returns whatever is available within the timeout.
 */
async function waitForSessionIds(
  taskIds: string[],
  manager: BackgroundManager,
  abort?: AbortSignal,
): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  const pending = new Set(taskIds)
  const deadline = Date.now() + SESSION_WAIT_TIMEOUT_MS

  while (pending.size > 0 && Date.now() < deadline) {
    if (abort?.aborted) break

    for (const taskId of pending) {
      const task = manager.getTask(taskId)
      if (task?.sessionID) {
        result.set(taskId, task.sessionID)
        pending.delete(taskId)
      }
    }

    if (pending.size > 0) {
      await new Promise((resolve) => setTimeout(resolve, SESSION_WAIT_INTERVAL_MS))
    }
  }

  return result
}

export function createAthenaCouncilTool(args: {
  backgroundManager: BackgroundManager
  councilConfig: CouncilConfig | undefined
}): ToolDefinition {
  const { backgroundManager, councilConfig } = args
  const description = buildToolDescription(councilConfig)

  return tool({
    description,
    args: {
      prompt_file: tool.schema.string().describe("Path to the prompt file created by prepare_council_prompt"),
      members: tool.schema
        .array(tool.schema.string())
        .optional()
        .describe("Optional list of council member names to launch. Defaults to all configured members."),
    },
    async execute(toolArgs: AthenaCouncilToolArgs, toolContext) {
      if (!councilConfig || councilConfig.members.length === 0) {
        return "Council not configured. Add agents.athena.council.members to your config."
      }

      const { members, error } = filterMembers(councilConfig.members, toolArgs.members)
      if (error) return error
      if (members.length === 0) return "No council members to launch."

      let promptContent: string
      try {
        promptContent = await readFile(toolArgs.prompt_file, "utf-8")
      } catch (err) {
        return `Failed to read prompt file: ${toolArgs.prompt_file}. Error: ${String(err)}`
      }

      const context: CouncilLaunchContext = {
        parentSessionID: toolContext.sessionID,
        parentMessageID: toolContext.messageID,
        parentAgent: toolContext.agent,
      }

      log("[athena_council] Launching council members", { count: members.length })

      const launchResults = await Promise.allSettled(
        members.map((member) => launchCouncilMember(member, promptContent, backgroundManager, context)),
      )

      const launched: Array<{ taskId: string; member: CouncilMemberConfig }> = []
      const failures: AthenaCouncilResult["failures"] = []

      launchResults.forEach((result, index) => {
        const member = members[index]
        if (result.status === "fulfilled") {
          launched.push({ taskId: result.value.task.id, member: result.value.member })
        } else {
          failures.push({
            member_name: member.name ?? member.model,
            model: member.model,
            error: String(result.reason),
          })
        }
      })

      if (launched.length === 0) {
        return `All council member launches failed:\n${failures.map((f) => `- ${f.member_name}: ${f.error}`).join("\n")}`
      }

      const sessionMap = await waitForSessionIds(
        launched.map((l) => l.taskId),
        backgroundManager,
        toolContext.abort,
      )

      const launchedInfo: LaunchedMemberInfo[] = launched.map((l) => ({
        task_id: l.taskId,
        session_id: sessionMap.get(l.taskId),
        member_name: l.member.name ?? l.member.model,
        model: l.member.model,
      }))

      const output: AthenaCouncilResult = {
        launched: launchedInfo,
        failures,
        total_requested: members.length,
      }

      log("[athena_council] Launch complete", {
        launched: launchedInfo.length,
        failed: failures.length,
      })

      const taskIdList = launchedInfo.map((l) => l.task_id)
      return `${JSON.stringify(output, null, 2)}

Use background_wait with task_ids=${JSON.stringify(taskIdList)} to wait for completion.
Then use background_output for each task_id to collect individual results.`
    },
  })
}
