import { describe, expect, it, mock, beforeEach, afterAll } from "bun:test"
import type { ParentContext } from "./executor-types"

const encodeMock = mock((value: unknown) => `toon:${JSON.stringify(value)}`)

mock.module("@toon-format/toon", () => ({
  encode: encodeMock,
}))

// Store original module for restoration
import * as originalToon from "@toon-format/toon"

import { compressParentContext } from "./parent-context-resolver"

afterAll(() => {
  mock.module("@toon-format/toon", () => originalToon)
})

const enabledConfig = { enabled: true, threshold: 10 }
const disabledConfig = { enabled: false, threshold: 10 }

function createParentContext(overrides: Partial<ParentContext> = {}): ParentContext {
  return {
    sessionID: "ses_abc123",
    messageID: "msg_xyz789",
    agent: "sisyphus",
    model: {
      providerID: "anthropic",
      modelID: "claude-opus-4-6",
      variant: "high",
    },
    ...overrides,
  }
}

describe("parent-context-resolver", () => {
  beforeEach(() => {
    encodeMock.mockReset()
    encodeMock.mockImplementation((value: unknown) => `toon:${JSON.stringify(value)}`)
  })

  describe("#given compressParentContext", () => {
    it("#then returns JSON string when compression is disabled", () => {
      const context = createParentContext()
      const result = compressParentContext(context, disabledConfig)

      expect(result).toBe(JSON.stringify(context))
      expect(encodeMock).not.toHaveBeenCalled()
    })

    it("#then returns JSON string for small context below threshold", () => {
      const context = createParentContext()
      const result = compressParentContext(context, { enabled: true, threshold: 10000 })

      expect(result).toBe(JSON.stringify(context))
      expect(encodeMock).not.toHaveBeenCalled()
    })

    it("#then returns JSON string for context without model", () => {
      const context = createParentContext({ model: undefined })
      const result = compressParentContext(context, enabledConfig)

      expect(result).toBe(JSON.stringify(context))
    })

    it("#then returns JSON string for context without agent", () => {
      const context = createParentContext({ agent: undefined })
      const result = compressParentContext(context, enabledConfig)

      expect(result).toBe(JSON.stringify(context))
    })

    it("#then falls back to JSON when encoder throws", () => {
      const context = createParentContext()
      encodeMock.mockImplementation(() => {
        throw new Error("encoder failure")
      })

      const result = compressParentContext(context, enabledConfig)
      expect(result).toBe(JSON.stringify(context))
    })

    it("#then serializes minimal context correctly", () => {
      const context: ParentContext = {
        sessionID: "ses_minimal",
        messageID: "msg_minimal",
      }
      const result = compressParentContext(context, disabledConfig)

      expect(result).toBe(JSON.stringify(context))
      expect(JSON.parse(result)).toEqual(context)
    })

    it("#then preserves all fields during serialization", () => {
      const context = createParentContext({
        sessionID: "ses_full",
        messageID: "msg_full",
        agent: "hephaestus",
        model: {
          providerID: "openai",
          modelID: "gpt-5.3-codex",
          variant: "xhigh",
        },
      })
      const result = compressParentContext(context, disabledConfig)
      const parsed = JSON.parse(result)

      expect(parsed.sessionID).toBe("ses_full")
      expect(parsed.messageID).toBe("msg_full")
      expect(parsed.agent).toBe("hephaestus")
      expect(parsed.model?.providerID).toBe("openai")
      expect(parsed.model?.modelID).toBe("gpt-5.3-codex")
      expect(parsed.model?.variant).toBe("xhigh")
    })
  })
})
