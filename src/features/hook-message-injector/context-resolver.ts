import { isSqliteBackend } from "../../shared/opencode-storage-detection"
import { findFirstMessageWithAgent, findNearestMessageWithFields } from "./json-message-lookup"
import {
  findFirstMessageWithAgentFromSDK,
  findNearestMessageWithFieldsFromSDK,
  type OpencodeClient,
} from "./sdk-message-lookup"
import type { StoredMessage } from "./types"

export async function resolveMessageContext(
  sessionID: string,
  client: OpencodeClient,
  messageDir: string | null
): Promise<{ prevMessage: StoredMessage | null; firstMessageAgent: string | null }> {
  const [prevMessage, firstMessageAgent] = isSqliteBackend()
    ? await Promise.all([
        findNearestMessageWithFieldsFromSDK(client, sessionID),
        findFirstMessageWithAgentFromSDK(client, sessionID),
      ])
    : [
        messageDir ? findNearestMessageWithFields(messageDir) : null,
        messageDir ? findFirstMessageWithAgent(messageDir) : null,
      ]

  return { prevMessage, firstMessageAgent }
}
