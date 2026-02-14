import type { CouncilLauncher, CouncilLaunchInput } from "../../agents/athena/council-orchestrator"
import type { BackgroundManager } from "../../features/background-agent"

export function createCouncilLauncher(manager: BackgroundManager): CouncilLauncher {
  return {
    launch(input: CouncilLaunchInput) {
      return manager.launch({
        description: input.description,
        prompt: input.prompt,
        agent: input.agent,
        parentSessionID: input.parentSessionID,
        parentMessageID: input.parentMessageID,
        parentAgent: input.parentAgent,
        model: input.model,
      })
    },
  }
}
