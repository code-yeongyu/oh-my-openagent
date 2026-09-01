/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import { isFableFiveModel, isMessageEndEvent, isModelSelectEvent, isRefusalLikeMessage } from "./detection"

function assistant(message: Record<string, unknown>): Record<string, unknown> {
  return { role: "assistant", ...message }
}

describe("fallback-architect detection", () => {
  describe("#given an assistant message that the classifier stopped", () => {
    describe("#when stopDetails marks a refusal", () => {
      it("#then reports the message as refusal-like", () => {
        expect(isRefusalLikeMessage(assistant({ stopReason: "error", stopDetails: { type: "refusal" } }))).toBe(true)
      })
    })

    describe("#when stopDetails marks sensitive content", () => {
      it("#then reports the message as refusal-like", () => {
        expect(isRefusalLikeMessage(assistant({ stopReason: "error", stopDetails: { type: "sensitive" } }))).toBe(true)
      })
    })
  })

  describe("#given a provider policy rejection carried only in errorMessage", () => {
    describe("#when the error text matches the Anthropic usage policy wording", () => {
      it("#then reports the message as refusal-like for an error stop", () => {
        const message = assistant({
          stopReason: "error",
          errorMessage:
            "This request triggered restrictions on account 42 and was blocked under Anthropic's Usage Policy.",
        })
        expect(isRefusalLikeMessage(message)).toBe(true)
      })

      it("#then reports the message as refusal-like for a toolUse stop", () => {
        const message = assistant({
          stopReason: "toolUse",
          errorMessage:
            "This request triggered restrictions on output content and was blocked under Anthropic's Usage Policy",
        })
        expect(isRefusalLikeMessage(message)).toBe(true)
      })
    })
  })

  describe("#given messages that are not refusals", () => {
    describe("#when the stop is an ordinary transient failure", () => {
      it("#then reports the message as not refusal-like", () => {
        expect(isRefusalLikeMessage(assistant({ stopReason: "error", errorMessage: "Request timed out." }))).toBe(false)
      })
    })

    describe("#when the message completed normally", () => {
      it("#then reports the message as not refusal-like", () => {
        expect(isRefusalLikeMessage(assistant({ stopReason: "stop" }))).toBe(false)
      })
    })

    describe("#when the message is not from the assistant", () => {
      it("#then reports the message as not refusal-like", () => {
        expect(isRefusalLikeMessage({ role: "user", stopDetails: { type: "refusal" } })).toBe(false)
      })
    })

    describe("#when an aborted message still carries stale refusal details", () => {
      it("#then the stop reason wins and the message is not refusal-like", () => {
        expect(isRefusalLikeMessage(assistant({ stopReason: "aborted", stopDetails: { type: "refusal" } }))).toBe(false)
        expect(isRefusalLikeMessage(assistant({ stopReason: "stop", stopDetails: { type: "sensitive" } }))).toBe(false)
      })
    })

    describe("#when the payload is malformed", () => {
      it("#then returns false instead of throwing", () => {
        expect(isRefusalLikeMessage(undefined)).toBe(false)
        expect(isRefusalLikeMessage(null)).toBe(false)
        expect(isRefusalLikeMessage("refusal")).toBe(false)
      })
    })
  })

  describe("#given a model descriptor", () => {
    describe("#when the id is claude-fable-5", () => {
      it("#then matches regardless of provider", () => {
        expect(isFableFiveModel({ provider: "anthropic", id: "claude-fable-5" })).toBe(true)
        expect(isFableFiveModel({ provider: "anthropic-api", id: "claude-fable-5" })).toBe(true)
      })
    })

    describe("#when the id is another model", () => {
      it("#then does not match", () => {
        expect(isFableFiveModel({ provider: "anthropic", id: "claude-opus-5" })).toBe(false)
        expect(isFableFiveModel(undefined)).toBe(false)
        expect(isFableFiveModel({ provider: "anthropic" })).toBe(false)
      })
    })
  })

  describe("#given raw extension payloads", () => {
    describe("#when the payload is a well formed model_select event", () => {
      it("#then the guard accepts it", () => {
        const payload = {
          type: "model_select",
          model: { provider: "anthropic", id: "claude-opus-5" },
          previousModel: { provider: "anthropic", id: "claude-fable-5" },
          source: "fallback",
        }
        expect(isModelSelectEvent(payload)).toBe(true)
      })
    })

    describe("#when the payload is missing required fields", () => {
      it("#then the guard rejects it without throwing", () => {
        expect(isModelSelectEvent({ type: "model_select", source: "fallback" })).toBe(false)
        expect(isModelSelectEvent({ type: "model_select", model: { id: "x" } })).toBe(false)
        expect(isModelSelectEvent(null)).toBe(false)
      })
    })

    describe("#when the payload is a well formed message_end event", () => {
      it("#then the guard accepts it and rejects junk", () => {
        expect(isMessageEndEvent({ type: "message_end", message: { role: "assistant", stopReason: "stop" } })).toBe(true)
        expect(isMessageEndEvent({ type: "message_end" })).toBe(false)
        expect(isMessageEndEvent(42)).toBe(false)
      })
    })
  })
})
