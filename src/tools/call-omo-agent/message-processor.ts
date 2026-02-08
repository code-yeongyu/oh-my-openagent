import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared"
import { consumeNewMessages } from "../../shared/session-cursor"

export async function processMessages(
  sessionID: string,
  ctx: PluginInput
): Promise<string> {
  const messagesResult = await ctx.client.session.messages({
    path: { id: sessionID },
  })

  if (messagesResult.error) {
    log(`[call_omo_agent] Messages error:`, messagesResult.error)
    throw new Error(`Failed to get messages: ${messagesResult.error}`)
  }

  const messages = messagesResult.data
  log(`[call_omo_agent] Got ${messages.length} messages`)

  // Include both assistant messages AND tool messages
  // Tool results (grep, glob, bash output) come from role "tool"
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const relevantMessages = messages.filter(
    (m: any) => m.info?.role === "assistant" || m.info?.role === "tool"
  )

  if (relevantMessages.length === 0) {
    log(`[call_omo_agent] No assistant or tool messages found`)
    log(`[call_omo_agent] All messages:`, JSON.stringify(messages, null, 2))
    throw new Error("No assistant or tool response found")
  }

  log(`[call_omo_agent] Found ${relevantMessages.length} relevant messages`)

  // Sort by time ascending (oldest first) to process messages in order
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sortedMessages = [...relevantMessages].sort((a: any, b: any) => {
    const timeA = a.info?.time?.created ?? 0
    const timeB = b.info?.time?.created ?? 0
    return timeA - timeB
  })

  const newMessages = consumeNewMessages(sessionID, sortedMessages)

  if (newMessages.length === 0) {
    return "No new output since last check."
  }

  // Extract content from ALL messages, not just the last one
  // Tool results may be in earlier messages while the final message is empty
  const extractedContent: string[] = []

  for (const message of newMessages) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const part of (message as any).parts ?? []) {
      // Handle both "text" and "reasoning" parts (thinking models use "reasoning")
      if ((part.type === "text" || part.type === "reasoning") && part.text) {
        extractedContent.push(part.text)
      } else if (part.type === "tool_result") {
        // Tool results contain the actual output from tool calls
        const toolResult = part as { content?: string | Array<{ type: string; text?: string }> }
        if (typeof toolResult.content === "string" && toolResult.content) {
          extractedContent.push(toolResult.content)
        } else if (Array.isArray(toolResult.content)) {
          // Handle array of content blocks
          for (const block of toolResult.content) {
            if ((block.type === "text" || block.type === "reasoning") && block.text) {
              extractedContent.push(block.text)
            }
          }
        }
      }
    }
  }

  const responseText = extractedContent
    .filter((text) => text.length > 0)
    .join("\n\n")

  log(`[call_omo_agent] Got response, length: ${responseText.length}`)

  return responseText
}
