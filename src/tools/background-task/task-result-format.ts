import type { BackgroundTask } from "../../features/background-agent"
import {
  analyzeBackgroundTaskMessages,
  extractBackgroundMessageText,
} from "../../features/background-agent/session-output-analysis"
import type { BackgroundOutputClient, BackgroundOutputMessagesResult } from "./clients"
import { extractMessages, getErrorMessage } from "./session-messages"
import { formatDuration } from "./time-format"

export async function formatTaskResult(task: BackgroundTask, client: BackgroundOutputClient): Promise<string> {
  if (!task.sessionID) {
    return `Error: Task has no sessionID`
  }

  const messagesResult: BackgroundOutputMessagesResult = await client.session.messages({
    path: { id: task.sessionID },
  })

  const errorMessage = getErrorMessage(messagesResult)
  if (errorMessage) {
    return `Error fetching messages: ${errorMessage}`
  }

  const messages = extractMessages(messagesResult)
  if (!Array.isArray(messages) || messages.length === 0) {
    return `Task Result

Task ID: ${task.id}
Description: ${task.description}
Duration: ${formatDuration(task.startedAt ?? new Date(), task.completedAt)}
Session ID: ${task.sessionID}

---

(No messages found)`
  }

  const relevantMessages = messages.filter((m) => m.info?.role === "assistant" || m.info?.role === "tool")
  if (relevantMessages.length === 0) {
    return `Task Result

Task ID: ${task.id}
Description: ${task.description}
Duration: ${formatDuration(task.startedAt ?? new Date(), task.completedAt)}
Session ID: ${task.sessionID}

---

(No assistant or tool response found)`
  }

  const analysis = analyzeBackgroundTaskMessages(relevantMessages)
  const textContent = analysis.finalAssistant
    ? extractBackgroundMessageText(analysis.finalAssistant)
    : analysis.sortedMessages
        .map((message) => extractBackgroundMessageText(message))
        .filter((text) => text.length > 0)
        .join("\n\n")
  const duration = formatDuration(task.startedAt ?? new Date(), task.completedAt)

  return `Task Result

Task ID: ${task.id}
Description: ${task.description}
Duration: ${duration}
Session ID: ${task.sessionID}

---

${textContent || "(No text output)"}`
}
