import type { Message, Part } from "@opencode-ai/sdk"

export type { FixedCommentRuleConfig } from "./types"

interface MessageWithParts {
  info: Message
  parts: Part[]
}

const FIXED_COMMENT_RULE_TEXT = `[System Rule: Bug Fix Comments]
When fixing bugs, ALWAYS add a comment above the fix:
// Fixed: [YYYY-MM-DD] - Before: [original behavior], Bug: [what was wrong], After: [new behavior]

For non-JS/TS files, use appropriate comment syntax:
- Python: # Fixed: ...
- HTML: <!-- Fixed: ... -->
- CSS: /* Fixed: ... */
- Shell: # Fixed: ...

Example:
// Fixed: 2026-01-26 - Before: returned undefined for empty array, Bug: missing null check, After: returns empty array safely`

export function createFixedCommentRuleHook() {
  return {
    "experimental.chat.messages.transform": async (
      _input: Record<string, never>,
      output: { messages: MessageWithParts[] }
    ) => {
      const { messages } = output
      if (messages.length === 0) return

      // Find last user message
      let lastUserMessageIndex = -1
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].info.role === "user") {
          lastUserMessageIndex = i
          break
        }
      }
      if (lastUserMessageIndex === -1) return

      const lastUserMessage = messages[lastUserMessageIndex]

      // Find text part index
      const textPartIndex = lastUserMessage.parts.findIndex(
        (p) => p.type === "text" && (p as { text?: string }).text
      )
      if (textPartIndex === -1) return

      // Create synthetic part with rule
      const syntheticPart = {
        id: `fixed-comment-rule_${Date.now()}`,
        messageID: lastUserMessage.info.id,
        sessionID: (lastUserMessage.info as { sessionID?: string }).sessionID ?? "",
        type: "text" as const,
        text: FIXED_COMMENT_RULE_TEXT,
        synthetic: true,
      }

      // Insert before the text part
      lastUserMessage.parts.splice(textPartIndex, 0, syntheticPart as Part)
    },
  }
}
