import type { OpencodeClient } from "./types"
import type { DelegatedModelConfig } from "../../shared/model-resolution-types"
import { QUESTION_DENIED_SESSION_PERMISSION } from "../../shared/question-denied-session-permission"

export async function createSyncSession(
  client: OpencodeClient,
  input: {
    parentSessionID: string
    agentToUse: string
    description: string
    directory?: string
    defaultDirectory: string
    categoryModel?: DelegatedModelConfig
  }
): Promise<{ ok: true; sessionID: string; sessionDirectory: string } | { ok: false; error: string }> {
  const parentSession = await client.session.get({ path: { id: input.parentSessionID } }).catch(() => null)
  const sessionDirectory = input.directory ?? parentSession?.data?.directory ?? input.defaultDirectory

  const createResult = await client.session.create({
    body: {
      parentID: input.parentSessionID,
      title: `${input.description} (@${input.agentToUse} subagent)`,
      permission: QUESTION_DENIED_SESSION_PERMISSION,
      ...(input.categoryModel
        ? {
            model: {
              id: input.categoryModel.modelID,
              providerID: input.categoryModel.providerID,
              ...(input.categoryModel.variant ? { variant: input.categoryModel.variant } : {}),
            },
          }
        : {}),
    } as Record<string, unknown>,
    query: {
      directory: sessionDirectory,
    },
  })

  if (createResult.error !== undefined) {
    return { ok: false, error: `Failed to create session: ${createResult.error}` }
  }
  if (createResult.data === undefined) {
    return { ok: false, error: "Failed to create session: missing session data" }
  }

  return { ok: true, sessionID: createResult.data.id, sessionDirectory }
}
