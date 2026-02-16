import type { OpencodeClient } from "./types"

export async function createSyncSession(
  client: OpencodeClient,
  input: { parentSessionID: string; agentToUse: string; description: string; defaultDirectory: string }
): Promise<{ ok: true; sessionID: string; parentDirectory: string } | { ok: false; error: string }> {
  const parentSession = client.session.get
    ? await client.session.get({ path: { id: input.parentSessionID } }).catch(() => null)
    : null
  const parentDirectory = parentSession?.data?.directory ?? input.defaultDirectory

  const createResult = await client.session.create({
    body: {
      parentID: input.parentSessionID,
      title: `${input.description} (@${input.agentToUse} subagent)`,
    } as any,
    query: {
      directory: parentDirectory,
    },
  })

  if (createResult.error) {
    return { ok: false, error: `Failed to create session: ${createResult.error}` }
  }

  return { ok: true, sessionID: createResult.data.id, parentDirectory }
}
