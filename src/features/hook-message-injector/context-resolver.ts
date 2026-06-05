import { isSqliteBackend } from "../../shared/opencode-storage-detection"
import { findFirstMessageWithAgent, findNearestMessageWithFields } from "./json-message-lookup"
import { findMessageContextFromSDK } from "./sdk-message-context"
import type { OpencodeClient } from "./sdk-message-lookup"
import type { StoredMessage } from "./types"

export async function resolveMessageContext(
  sessionID: string,
  client: OpencodeClient,
  messageDir: string | null
): Promise<{ prevMessage: StoredMessage | null; firstMessageAgent: string | null }> {
  if (isSqliteBackend()) {
    return findMessageContextFromSDK(client, sessionID)
  }

  return {
    prevMessage: messageDir ? findNearestMessageWithFields(messageDir) : null,
    firstMessageAgent: messageDir ? findFirstMessageWithAgent(messageDir) : null,
  }
}
