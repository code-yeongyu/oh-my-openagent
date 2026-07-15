import { log } from "../../shared"
import type { OmoAgentClient } from "../../tools/delegate-task/types"
import type { LaunchInput } from "./types"

export async function createBackgroundSession(input: {
  readonly client: OmoAgentClient
  readonly launch: LaunchInput
  readonly managerDirectory: string
}): Promise<{
  readonly sessionID: string
  readonly parentDirectory: string
  readonly launchDirectory: string
}> {
  const parentSession = await input.client.session.get({
    path: { id: input.launch.parentSessionId },
    query: { directory: input.managerDirectory },
  }).catch((error: unknown) => {
    log(`[background-agent] Failed to get parent session: ${error}`)
    return null
  })
  const parentDirectory = parentSession?.data?.directory ?? input.managerDirectory
  const launchDirectory = input.launch.directory ?? parentDirectory
  log(`[background-agent] Parent dir: ${parentSession?.data?.directory}, using: ${launchDirectory}`)

  const createResult = await input.client.session.create({
    body: {
      parentID: input.launch.parentSessionId,
      title: `${input.launch.description} (@${input.launch.agent} subagent)`,
      ...(input.launch.sessionPermission ? { permission: input.launch.sessionPermission } : {}),
      ...(input.launch.model
        ? {
            model: {
              id: input.launch.model.modelID,
              providerID: input.launch.model.providerID,
              ...(input.launch.model.variant ? { variant: input.launch.model.variant } : {}),
            },
          }
        : {}),
    },
    query: { directory: launchDirectory },
  })
  if (createResult.error) {
    throw new Error(`Failed to create background session: ${createResult.error}`)
  }
  if (!createResult.data?.id) {
    throw new Error("Failed to create background session: API returned no session ID")
  }

  return { sessionID: createResult.data.id, parentDirectory, launchDirectory }
}
