import type { OpencodeClient } from "../constants"
import { log, resolveSessionDirectory } from "../../../shared"

export async function resolveParentDirectory(options: {
  client: OpencodeClient
  parentSessionID: string
  defaultDirectory: string
}): Promise<string> {
  const { client, parentSessionID, defaultDirectory } = options

  const parentSession = await client.session
    .get({ path: { id: parentSessionID } })
    .catch((error: unknown) => {
      log(`[background-agent] Failed to get parent session: ${error}`)
      return null
    })

  const parentDirectory = resolveSessionDirectory({
    parentDirectory: parentSession?.data?.directory,
    fallbackDirectory: defaultDirectory,
  })
  log(`[background-agent] Parent dir: ${parentSession?.data?.directory}, using: ${parentDirectory}`)
  return parentDirectory
}
