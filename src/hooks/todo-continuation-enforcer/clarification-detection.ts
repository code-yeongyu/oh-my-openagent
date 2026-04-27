import { log } from "../../shared/logger"
import { HOOK_NAME } from "./constants"

interface MessagePart {
  type?: string
  text?: string
  name?: string
  toolName?: string
}

interface Message {
  info?: { role?: string }
  role?: string
  parts?: MessagePart[]
}

const CLARIFICATION_SEEKING_PATTERNS: RegExp[] = [
  /I need more (information|details|context|instructions|clarification|specifics|guidance|direction)/i,
  /Please (clarify|specify|provide|tell me|explain|elaborate|define|outline)/i,
  /What (should I do|do you want me|is the expected|are the requirements|API endpoint|fields?|parameters?)/i,
  /(awaiting|waiting for) (your|user) (input|response|feedback|answer|reply)/i,
  /Cannot proceed without (more |further |additional )?(information|details|context|instructions|clarification)/i,
  /(need|require) (your|user) (direction|guidance|input|help|assistance|feedback)/i,
  /(blocked|stuck|halted) (until|on|by).*(user|clarification|instructions|guidance)/i,
  /please confirm (the |your )?(requirements|approach|direction|scope|expectations)/i,
  /I('m| am) (unsure|uncertain|not sure|unclear) (about|what|how|which)/i,
  /(not enough|insufficient|lack of) (information|context|details|instructions)/i,
  /(how|where) (should I|do I|can I) (start|begin|proceed|implement)/i,
  /Which (approach|method|option|library|API|endpoint|tool)/i,
  /before I (can |may )?(start|proceed|continue|implement|begin)/i,
  /I need (to know|to understand|you to|someone to)/i,
  /Could you (clarify|specify|elaborate|explain|provide|tell)/i,
  /(Do you want|Should I|Am I supposed to)/i,
  /(before proceeding|before I continue|before starting)/i,
  /(uncertain|unclear) (about |on |what |how )/i,
  /I don't (know|understand|have|see) (what|how|where|which)/i,
  /(missing|absent|lack( of|ing)?) (information|instructions|requirements|specifications|context)/i,
  /(information|instructions|requirements|specifications|context).*(is|are) (missing|absent|insufficient|lacking)/i,
]

export interface ClarificationResult {
  isAskingForClarification: boolean
  matchedPattern?: string
  matchedText?: string
}

/**
 * Detects whether the last assistant message is asking the user for
 * clarification or more instructions — without using the `question` tool.
 *
 * This catches plain-text requests for guidance that the existing
 * `hasUnansweredQuestion` function misses.
 */
export function detectClarificationSeeking(
  messages: Message[]
): ClarificationResult {
  if (!messages || messages.length === 0) {
    return { isAskingForClarification: false }
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    const role = msg.info?.role ?? msg.role

    if (role === "user") return { isAskingForClarification: false }

    if (role === "assistant" && msg.parts) {
      const hasQuestionTool = msg.parts.some(
        (part) =>
          (part.type === "tool_use" || part.type === "tool-invocation") &&
          (part.name === "question" || part.toolName === "question"),
      )

      if (hasQuestionTool) return { isAskingForClarification: false }

      const textParts = msg.parts.filter(
        (part) => part.type === "text" || (!part.type && part.text),
      )
      const combinedText = textParts
        .map((part) => part.text ?? "")
        .join("\n")

      for (const pattern of CLARIFICATION_SEEKING_PATTERNS) {
        const match = combinedText.match(pattern)
        if (match) {
          const matchedText =
            combinedText.length > 200
              ? combinedText.slice(
                  Math.max(0, (match.index ?? 0) - 40),
                  (match.index ?? 0) + match[0].length + 40,
                )
              : combinedText

          log(`[${HOOK_NAME}] Detected clarification-seeking in assistant message`, {
            pattern: pattern.source,
            textExcerpt: matchedText,
          })
          return {
            isAskingForClarification: true,
            matchedPattern: pattern.source,
            matchedText,
          }
        }
      }

      return { isAskingForClarification: false }
    }
  }

  return { isAskingForClarification: false }
}
