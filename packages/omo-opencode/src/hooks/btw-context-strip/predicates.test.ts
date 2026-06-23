/// <reference path="../../../bun-test.d.ts" />

import { describe, expect, test } from "bun:test"

import {
  AUTO_SLASH_COMMAND_TAG_CLOSE,
  AUTO_SLASH_COMMAND_TAG_OPEN,
} from "../auto-slash-command/constants"
import {
  BTW_AUTO_SLASH_COMMAND_MARKER,
  computeBtwStripIndices,
  isBtwMarked,
  isBtwUserMessage,
  type MessageRole,
  type MessageWithParts,
} from "./predicates"

function createMessage(
  role: MessageRole,
  text: string,
  marked = false,
): MessageWithParts {
  return {
    info: { role },
    parts: [{ type: "text", text }],
    ...(marked ? { __isBtwMarked: true } : {}),
  }
}

function isMarked(msg: MessageWithParts): boolean {
  return msg.__isBtwMarked === true
}

function createAutoSlashCommandMessage(
  role: MessageRole,
  commandHeader: string,
  userRequest: string,
): MessageWithParts {
  return createMessage(
    role,
    `${AUTO_SLASH_COMMAND_TAG_OPEN}\n${commandHeader}\n\n**User Arguments**: ${userRequest}\n${AUTO_SLASH_COMMAND_TAG_CLOSE}`,
  )
}

function sortedIndices(indices: Set<number>): number[] {
  return Array.from(indices).sort((left, right) => left - right)
}

describe("btw context strip predicates", () => {
  describe("#given a user message expanded from the /btw auto slash command", () => {
    describe("#when the concrete marker predicate checks the message", () => {
      test("#then rejects the forgeable text wrapper without the command-origin marker", () => {
        const message = createAutoSlashCommandMessage(
          "user",
          "# BTW Command",
          "remember PURPLE-PANDA-47",
        )

        expect(isBtwMarked(message)).toBe(false)
      })
    })
  })

  describe("#given a user message marked by command metadata", () => {
    describe("#when the concrete marker predicate checks the message", () => {
      test("#then detects the non-text command-origin marker", () => {
        const message = createMessage("user", "/btw remember PURPLE-PANDA-47")
        message.info[BTW_AUTO_SLASH_COMMAND_MARKER] = true

        expect(isBtwMarked(message)).toBe(true)
      })
    })
  })

  describe("#given a user message part marked by command metadata", () => {
    describe("#when the concrete marker predicate checks the message", () => {
      test("#then detects the persisted part-level command-origin marker", () => {
        const message = createMessage("user", "/btw remember PURPLE-PANDA-47")
        message.parts = [{
          type: "text",
          text: "/btw remember PURPLE-PANDA-47",
          [BTW_AUTO_SLASH_COMMAND_MARKER]: true,
        }]

        expect(isBtwMarked(message)).toBe(true)
      })
    })
  })

  describe("#given a normal user message starts with raw /btw text", () => {
    describe("#when the concrete marker predicate checks the message", () => {
      test("#then rejects the message because slash text alone is forgeable", () => {
        const message = createMessage("user", "/btw remember PURPLE-PANDA-47")

        expect(isBtwMarked(message)).toBe(false)
      })
    })
  })

  describe("#given a normal user message contains the readable secret text", () => {
    describe("#when the concrete marker predicate checks the message", () => {
      test("#then rejects the message because content alone is not structural", () => {
        const message = createMessage(
          "user",
          "I can type PURPLE-PANDA-47 without using the auto slash wrapper.",
        )

        expect(isBtwMarked(message)).toBe(false)
      })
    })
  })

  describe("#given a user message expanded from a different auto slash command", () => {
    describe("#when the concrete marker predicate checks the message", () => {
      test("#then rejects the message even though the wrapper is present", () => {
        const message = createAutoSlashCommandMessage(
          "user",
          "# /handoff Command",
          "summarize this session",
        )

        expect(isBtwMarked(message)).toBe(false)
      })
    })
  })

  describe("#given a single completed /btw pair between normal messages", () => {
    describe("#when strip indices are computed", () => {
      test("#then returns only the marked user and paired assistant indices", () => {
        const normalQuestion = createMessage("user", "What is my public project name?")
        const normalAnswer = createMessage("assistant", "Your public project is OMO.")
        const btwQuestion = createMessage(
          "user",
          "/btw remember PURPLE-PANDA-47 as the secret",
          true,
        )
        const btwAnswer = createMessage(
          "assistant",
          "Acknowledged. PURPLE-PANDA-47 is the secret.",
        )
        const nextQuestion = createMessage("user", "Continue with normal context.")
        const messages = [normalQuestion, normalAnswer, btwQuestion, btwAnswer, nextQuestion]
        const originalMessages = [...messages]

        const indices = computeBtwStripIndices(messages, isMarked)

        expect(isBtwUserMessage(btwQuestion, isMarked)).toBe(true)
        expect(sortedIndices(indices)).toEqual([2, 3])
        expect(messages).toEqual(originalMessages)
      })
    })
  })

  describe("#given two consecutive completed /btw pairs", () => {
    describe("#when strip indices are computed", () => {
      test("#then returns both marked users and both paired assistants", () => {
        const messages = [
          createMessage("user", "/btw first private note", true),
          createMessage("assistant", "First private answer."),
          createMessage("user", "/btw second private note", true),
          createMessage("assistant", "Second private answer."),
          createMessage("user", "Back to normal."),
        ]

        const indices = computeBtwStripIndices(messages, isMarked)

        expect(sortedIndices(indices)).toEqual([0, 1, 2, 3])
      })
    })
  })

  describe("#given a pending /btw user message is the final message", () => {
    describe("#when strip indices are computed before an assistant response exists", () => {
      test("#then returns an empty set so the model can answer the turn", () => {
        const pendingQuestion = createMessage("user", "/btw answer this pending turn", true)
        const messages = [createMessage("user", "Earlier public question."), pendingQuestion]

        const indices = computeBtwStripIndices(messages, isMarked)

        expect(isBtwUserMessage(pendingQuestion, isMarked)).toBe(true)
        expect(sortedIndices(indices)).toEqual([])
      })
    })
  })

  describe("#given an unpaired /btw message is followed by a normal user message", () => {
    describe("#when strip indices are computed", () => {
      test("#then returns the aborted /btw user index without stripping the normal user", () => {
        const messages = [
          createMessage("user", "Normal opening."),
          createMessage("user", "/btw aborted private turn", true),
          createMessage("user", "Normal follow-up after abort."),
          createMessage("assistant", "Normal answer."),
        ]

        const indices = computeBtwStripIndices(messages, isMarked)

        expect(sortedIndices(indices)).toEqual([1])
      })
    })
  })

  describe("#given a /btw turn has a multi-message assistant answer", () => {
    describe("#when strip indices are computed", () => {
      test("#then returns every assistant index before the next user message", () => {
        const messages = [
          createMessage("user", "/btw explain privately", true),
          createMessage("assistant", "Private answer part one."),
          createMessage("assistant", "Private answer part two."),
          createMessage("assistant", "Private answer part three."),
          createMessage("user", "Public follow-up."),
          createMessage("assistant", "Public answer."),
        ]

        const indices = computeBtwStripIndices(messages, isMarked)

        expect(sortedIndices(indices)).toEqual([0, 1, 2, 3])
      })
    })
  })

  describe("#given there are zero marked /btw user messages", () => {
    describe("#when strip indices are computed", () => {
      test("#then returns an empty set even when user text contains the readable secret", () => {
        const messages = [
          createMessage("user", "I can type PURPLE-PANDA-47 in a normal message."),
          createMessage("assistant", "That text alone is not a marker."),
          createMessage("user", "Another normal turn."),
        ]

        const indices = computeBtwStripIndices(messages, isMarked)

        expect(sortedIndices(indices)).toEqual([])
      })
    })
  })

  describe("#given a non-user message carries the marker", () => {
    describe("#when strip indices are computed", () => {
      test("#then ignores the marker because only user messages can start /btw turns", () => {
        const markedAssistant = createMessage("assistant", "Marked assistant text.", true)
        const messages = [
          createMessage("user", "Normal question."),
          markedAssistant,
          createMessage("user", "Normal follow-up."),
        ]

        const indices = computeBtwStripIndices(messages, isMarked)

        expect(isBtwUserMessage(markedAssistant, isMarked)).toBe(false)
        expect(sortedIndices(indices)).toEqual([])
      })
    })
  })
})
