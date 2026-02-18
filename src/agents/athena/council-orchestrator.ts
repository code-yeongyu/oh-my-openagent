import type { LaunchInput, BackgroundTask } from "../../features/background-agent/types"
import { log } from "../../shared/logger"
import { buildCouncilPrompt } from "./council-prompt"
import { parseModelString } from "./model-parser"
import type { CouncilConfig, CouncilLaunchFailure, CouncilLaunchedMember, CouncilLaunchResult, CouncilMemberConfig } from "./types"

export type CouncilLaunchInput = LaunchInput

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

/**
 * Launches all council members in parallel and returns launch outcomes.
 * Does NOT wait for task completion — actual results are collected by the
 * agent via background_output calls after this returns.
 */
export async function executeCouncil(input: CouncilExecutionInput): Promise<CouncilLaunchResult> {
  const { question, council, launcher, parentSessionID, parentMessageID, parentAgent } = input

  log("[athena-council] Executing council", { memberCount: council.members.length })

  const prompt = buildCouncilPrompt(question)

  const launchResults = await Promise.allSettled(
    council.members.map((member) =>
      launchMember(member, prompt, launcher, parentSessionID, parentMessageID, parentAgent)
    )
  )

  const launched: CouncilLaunchedMember[] = []
  const failures: CouncilLaunchFailure[] = []

  launchResults.forEach((result, index) => {
    const member = council.members[index]

    if (result.status === "fulfilled") {
      launched.push({ member, taskId: result.value.id })
      return
    }

    failures.push({
      member,
      error: `Launch failed: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
    })
  })

  log("[athena-council] Council execution complete", { launched: launched.length, failures: failures.length })

  return {
    question,
    launched,
    failures,
    totalMembers: council.members.length,
  }
}

async function launchMember(
  member: CouncilMemberConfig,
  prompt: string,
  launcher: CouncilLauncher,
  parentSessionID: string,
  parentMessageID: string,
  parentAgent: string | undefined
): Promise<BackgroundTask> {
  const parsedModel = parseModelString(member.model)
  if (!parsedModel) {
    throw new Error(`Invalid model string: "${member.model}"`)
  }

  const memberName = member.name ?? member.model
  return launcher.launch({
    description: `Council member: ${memberName}`,
    prompt,
    agent: "council-member",
    parentSessionID,
    parentMessageID,
    parentAgent,
    model: {
      providerID: parsedModel.providerID,
      modelID: parsedModel.modelID,
      ...(member.variant ? { variant: member.variant } : {}),
    },
  })
}
