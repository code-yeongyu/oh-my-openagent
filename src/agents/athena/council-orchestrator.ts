import type { LaunchInput, BackgroundTask } from "../../features/background-agent/types"
import { createAgentToolRestrictions } from "../../shared/permission-compat"
import { buildCouncilPrompt } from "./council-prompt"
import { collectCouncilResults } from "./council-result-collector"
import { parseModelString } from "./model-parser"
import type { CouncilConfig, CouncilExecutionResult, CouncilMemberConfig, CouncilMemberResponse } from "./types"

export interface CouncilLaunchInput extends LaunchInput {
  temperature?: number
  permission?: Record<string, "ask" | "allow" | "deny">
}

export interface CouncilLauncher {
  launch(input: CouncilLaunchInput): Promise<BackgroundTask>
}

export interface CouncilExecutionInput {
  question: string
  council: CouncilConfig
  launcher: CouncilLauncher
  parentSessionID: string
  parentMessageID: string
  parentAgent?: string
}

export async function executeCouncil(input: CouncilExecutionInput): Promise<CouncilExecutionResult> {
  const { question, council, launcher, parentSessionID, parentMessageID, parentAgent } = input
  const prompt = buildCouncilPrompt(question)
  const startTimes = new Map<string, number>()

  const launchResults = await Promise.allSettled(
    council.members.map((member) =>
      launchMember(
        member,
        prompt,
        launcher,
        parentSessionID,
        parentMessageID,
        parentAgent,
        startTimes
      )
    )
  )

  const launchedTasks: BackgroundTask[] = []
  const launchedMembers: CouncilMemberConfig[] = []
  const launchFailures: CouncilMemberResponse[] = []

  launchResults.forEach((result, index) => {
    const member = council.members[index]

    if (result.status === "fulfilled") {
      launchedTasks.push(result.value)
      launchedMembers.push(member)
      return
    }

    launchFailures.push({
      member,
      status: "error",
      error: `Launch failed: ${String(result.reason)}`,
      taskId: "",
      durationMs: 0,
    })
  })

  const collected = collectCouncilResults(launchedTasks, launchedMembers, startTimes)
  const responses = [...collected, ...launchFailures]
  const completedCount = responses.filter((response) => response.status === "completed").length

  return {
    question,
    responses,
    totalMembers: council.members.length,
    completedCount,
    failedCount: council.members.length - completedCount,
  }
}

async function launchMember(
  member: CouncilMemberConfig,
  prompt: string,
  launcher: CouncilLauncher,
  parentSessionID: string,
  parentMessageID: string,
  parentAgent: string | undefined,
  startTimes: Map<string, number>
): Promise<BackgroundTask> {
  const parsedModel = parseModelString(member.model)
  if (!parsedModel) {
    throw new Error(`Invalid model string: "${member.model}"`)
  }

  const restrictions = createAgentToolRestrictions(["write", "edit", "task"])
  const memberName = member.name ?? member.model
  const task = await launcher.launch({
    description: `Council member: ${memberName}`,
    prompt,
    agent: "athena",
    parentSessionID,
    parentMessageID,
    parentAgent,
    model: {
      providerID: parsedModel.providerID,
      modelID: parsedModel.modelID,
      ...(member.variant ? { variant: member.variant } : {}),
    },
    ...(member.temperature !== undefined ? { temperature: member.temperature } : {}),
    permission: restrictions.permission,
  })

  startTimes.set(task.id, Date.now())
  return task
}
