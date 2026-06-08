import {
  fetchSDKMessages,
  findFirstMessageWithAgentFromMessages,
  findNearestMessageWithFieldsFromMessages,
  type OpencodeClient,
} from "./sdk-message-lookup"
import type { StoredMessage } from "./types"

export async function findMessageContextFromSDK(
  client: OpencodeClient,
  sessionID: string
): Promise<{ prevMessage: StoredMessage | null; firstMessageAgent: string | null }> {
  const messages = await fetchSDKMessages(client, sessionID)
  if (!messages) {
    return { prevMessage: null, firstMessageAgent: null }
  }

  return {
    prevMessage: findNearestMessageWithFieldsFromMessages(messages),
    firstMessageAgent: findFirstMessageWithAgentFromMessages(messages),
  }
}
