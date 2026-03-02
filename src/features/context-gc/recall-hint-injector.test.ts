import { describe, it, expect, beforeEach, mock } from "bun:test"
import type { GcMessageInfo, GcPart, MessageWithParts } from "./types"
import {
  collectBrainIds,
  shouldInjectRecallHint,
  injectRecallHint,
  getRecallHintText,
} from "./recall-hint-injector"

function makeMessage(role: string, parts: Array<Record<string, unknown>>): MessageWithParts {
  return {
    info: { role, id: `msg_${Math.random().toString(36).slice(2)}`, sessionID: "ses_test" } as GcMessageInfo,
    parts: parts as GcPart[],
  }
}

function makeToolPart(toolName: string, output: string): Record<string, unknown> {
  return { type: "tool", tool: toolName, state: { output } }
}

function makeTextPart(text: string): Record<string, unknown> {
  return { type: "text", text }
}

describe("recall-hint-injector", () => {
  beforeEach(() => {
    mock.restore()
  })

  describe("#given messages with brain markers in tool outputs", () => {
    describe("#when collectBrainIds is called", () => {
      it("#then should return unique brain IDs from tool parts", () => {
        const messages: MessageWithParts[] = [
          makeMessage("assistant", [
            makeToolPart("grep", "[brain#42: grep results]"),
            makeToolPart("read", "[brain#7: file content]"),
          ]),
        ]

        expect(collectBrainIds(messages)).toEqual([42, 7])
      })
    })

    describe("#when collectBrainIds encounters duplicate IDs", () => {
      it("#then should deduplicate them", () => {
        const messages: MessageWithParts[] = [
          makeMessage("assistant", [
            makeToolPart("grep", "[brain#42: grep results]"),
          ]),
          makeMessage("assistant", [
            makeToolPart("read", "[brain#42: same content again]"),
          ]),
        ]

        expect(collectBrainIds(messages)).toEqual([42])
      })
    })
  })

  describe("#given messages with brain markers in text parts", () => {
    describe("#when collectBrainIds is called", () => {
      it("#then should find IDs in text parts too", () => {
        const messages: MessageWithParts[] = [
          makeMessage("assistant", [
            makeTextPart("Earlier I found [brain#99: large output] which had useful data"),
          ]),
        ]

        expect(collectBrainIds(messages)).toEqual([99])
      })
    })
  })

  describe("#given messages with no brain markers", () => {
    describe("#when shouldInjectRecallHint is called", () => {
      it("#then should return false", () => {
        const messages: MessageWithParts[] = [
          makeMessage("user", [makeTextPart("hello")]),
          makeMessage("assistant", [makeTextPart("hi there")]),
        ]

        expect(shouldInjectRecallHint(messages)).toBe(false)
      })
    })
  })

  describe("#given messages with brain markers present", () => {
    describe("#when shouldInjectRecallHint is called", () => {
      it("#then should return true", () => {
        const messages: MessageWithParts[] = [
          makeMessage("assistant", [
            makeToolPart("grep", "[brain#42: grep results]"),
          ]),
          makeMessage("user", [makeTextPart("tell me more")]),
        ]

        expect(shouldInjectRecallHint(messages)).toBe(true)
      })
    })
  })

  describe("#given messages with brain markers and a user message at end", () => {
    describe("#when injectRecallHint is called", () => {
      it("#then should append hint text to last user message", () => {
        const messages: MessageWithParts[] = [
          makeMessage("assistant", [
            makeToolPart("grep", "[brain#42: grep results]"),
          ]),
          makeMessage("user", [makeTextPart("tell me more")]),
        ]

        const result = injectRecallHint(messages)

        expect(result).toBe(true)
        const lastUser = messages[1]
        expect(lastUser.parts).toHaveLength(2)
        const hintPart = lastUser.parts[1] as unknown as { type: string; text: string }
        expect(hintPart.type).toBe("text")
        expect(hintPart.text).toContain("[context-gc]")
        expect(hintPart.text).toContain("nous-memory get")
      })
    })
  })

  describe("#given messages with no brain markers", () => {
    describe("#when injectRecallHint is called", () => {
      it("#then should not inject and return false", () => {
        const messages: MessageWithParts[] = [
          makeMessage("assistant", [makeTextPart("regular response")]),
          makeMessage("user", [makeTextPart("okay")]),
        ]

        const result = injectRecallHint(messages)

        expect(result).toBe(false)
        expect(messages[1].parts).toHaveLength(1)
      })
    })
  })

  describe("#given messages where hint was already injected", () => {
    describe("#when injectRecallHint is called again", () => {
      it("#then should not inject duplicate hint", () => {
        const messages: MessageWithParts[] = [
          makeMessage("assistant", [
            makeToolPart("grep", "[brain#42: grep results]"),
          ]),
          makeMessage("user", [makeTextPart("tell me more")]),
        ]

        injectRecallHint(messages)
        const partsCountAfterFirst = messages[1].parts.length

        const result = injectRecallHint(messages)

        expect(result).toBe(false)
        expect(messages[1].parts).toHaveLength(partsCountAfterFirst)
      })
    })
  })

  describe("#given messages with no user message", () => {
    describe("#when injectRecallHint is called", () => {
      it("#then should return false without injecting", () => {
        const messages: MessageWithParts[] = [
          makeMessage("assistant", [
            makeToolPart("grep", "[brain#42: grep results]"),
          ]),
        ]

        const result = injectRecallHint(messages)

        expect(result).toBe(false)
      })
    })
  })

  describe("#given getRecallHintText is called", () => {
    describe("#when checking the hint content", () => {
      it("#then should contain recall instructions", () => {
        const hint = getRecallHintText()

        expect(hint).toContain("nous-memory get")
        expect(hint).toContain("[brain#ID:")
      })
    })
  })
})
