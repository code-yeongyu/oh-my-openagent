import type { OpencodeClient } from "../constants"
import type { ConcurrencyManager } from "../concurrency"
import type { LaunchInput } from "../types"
import { log } from "../../../shared"

export async function createBackgroundSession(options: {
  client: OpencodeClient
  input: LaunchInput
  parentDirectory: string
  concurrencyManager: ConcurrencyManager
  concurrencyKey: string
}): Promise<string> {
  const { client, input, parentDirectory, concurrencyManager, concurrencyKey } = options

  const body = {
    parentID: input.parentSessionID,
    title: `Background: ${input.description}`,
  }

  const createResult = await client.session
    .create({
      body,
      query: {
        directory: parentDirectory,
      },
    })
    .catch((error: unknown) => {
      concurrencyManager.release(concurrencyKey)
      throw error
    })

  if (createResult.error) {
    concurrencyManager.release(concurrencyKey)
    throw new Error(`Failed to create background session: ${createResult.error}`)
  }

  if (!createResult.data?.id) {
    concurrencyManager.release(concurrencyKey)
    throw new Error("Failed to create background session: API returned no session ID")
  }

  const sessionID = createResult.data.id
  log("[background-agent] Background session created", { sessionID })
  return sessionID
}
