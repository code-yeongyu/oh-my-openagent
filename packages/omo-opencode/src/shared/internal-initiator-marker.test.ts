/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import {
  createInternalAgentContinuationTextPart,
  createInternalAgentTextPart,
  hasInternalInitiatorMarker,
  hasInternalNoReplyMarker,
  isRealUserMessage,
  isRealUserTextPart,
  isSyntheticOrInternalOnlyTextParts,
  isSyntheticOrInternalUserMessage,
  isTerminalNoReplyUserMessage,
  OMO_INTERNAL_INITIATOR_MARKER,
  OMO_INTERNAL_NOREPLY_MARKER,
  stripInternalInitiatorMarkers,
  withInternalNoReplyMarker,
} from "./internal-initiator-marker"

describe("internal-initiator-marker", () => {
  describe("createInternalAgentTextPart", () => {
    test("#given clean text #when creating an internal agent text part #then appends exactly one marker", () => {
      // given
      const text = "Hello world"

      // when
      const part = createInternalAgentTextPart(text)

      // then
      expect(part.type).toBe("text")
      expect(part.text).toBe(`Hello world\n${OMO_INTERNAL_INITIATOR_MARKER}`)
    })

    test("#given regular internal text #when creating a text part #then leaves it visible as a normal message part", () => {
      // given
      const text = "Visible notification"

      // when
      const part = createInternalAgentTextPart(text)

      // then
      expect("synthetic" in part).toBe(false)
      expect("metadata" in part).toBe(false)
    })

    test("#given text already ending with the marker #when creating a text part #then does not duplicate the marker", () => {
      // given
      const text = `Already marked\n${OMO_INTERNAL_INITIATOR_MARKER}`

      // when
      const part = createInternalAgentTextPart(text)

      // then
      const markerCount = part.text.split(OMO_INTERNAL_INITIATOR_MARKER).length - 1
      expect(markerCount).toBe(1)
      expect(part.text).toBe(`Already marked\n${OMO_INTERNAL_INITIATOR_MARKER}`)
    })

    test("#given text containing multiple embedded markers #when creating a text part #then collapses to a single trailing marker", () => {
      // given
      const text = `First\n${OMO_INTERNAL_INITIATOR_MARKER}\nSecond\n${OMO_INTERNAL_INITIATOR_MARKER}\nThird\n${OMO_INTERNAL_INITIATOR_MARKER}`

      // when
      const part = createInternalAgentTextPart(text)

      // then
      const markerCount = part.text.split(OMO_INTERNAL_INITIATOR_MARKER).length - 1
      expect(markerCount).toBe(1)
      expect(part.text.endsWith(OMO_INTERNAL_INITIATOR_MARKER)).toBe(true)
    })

    test("#given text with embedded markers between content #when creating a text part #then strips embedded markers and keeps content", () => {
      // given
      const text = `Line one\n${OMO_INTERNAL_INITIATOR_MARKER}\nLine two\n${OMO_INTERNAL_INITIATOR_MARKER}`

      // when
      const part = createInternalAgentTextPart(text)

      // then
      expect(part.text).toContain("Line one")
      expect(part.text).toContain("Line two")
      const markerCount = part.text.split(OMO_INTERNAL_INITIATOR_MARKER).length - 1
      expect(markerCount).toBe(1)
    })

    test("#given empty text #when creating a text part #then still appends a single marker", () => {
      // given
      const text = ""

      // when
      const part = createInternalAgentTextPart(text)

      // then
      expect(part.text).toBe(`\n${OMO_INTERNAL_INITIATOR_MARKER}`)
    })
  })

  describe("createInternalAgentContinuationTextPart", () => {
    test("#given continuation text #when creating a text part #then marks it as an agent continuation", () => {
      // given
      const text = "Continue the loop"

      // when
      const part = createInternalAgentContinuationTextPart(text)

      // then
      expect(part.type).toBe("text")
      expect(part.text).toBe(`Continue the loop\n${OMO_INTERNAL_INITIATOR_MARKER}`)
      expect(part.synthetic).toBe(true)
      expect(part.metadata.compaction_continue).toBe(true)
    })
  })

  describe("stripInternalInitiatorMarkers", () => {
    test("#given text with no markers #when stripping #then returns text trimmed at the end", () => {
      // given
      const text = "No markers here"

      // when
      const result = stripInternalInitiatorMarkers(text)

      // then
      expect(result).toBe("No markers here")
    })

    test("#given text with one trailing marker #when stripping #then removes the marker", () => {
      // given
      const text = `Content\n${OMO_INTERNAL_INITIATOR_MARKER}`

      // when
      const result = stripInternalInitiatorMarkers(text)

      // then
      expect(result).toBe("Content")
    })

    test("#given text with multiple stacked markers #when stripping #then removes all of them", () => {
      // given
      const text = `Content\n${OMO_INTERNAL_INITIATOR_MARKER}\n${OMO_INTERNAL_INITIATOR_MARKER}\n${OMO_INTERNAL_INITIATOR_MARKER}`

      // when
      const result = stripInternalInitiatorMarkers(text)

      // then
      expect(result).toBe("Content")
    })

    test("#given text with markers on consecutive lines without separators #when stripping #then removes all markers", () => {
      // given
      const text = `${OMO_INTERNAL_INITIATOR_MARKER}${OMO_INTERNAL_INITIATOR_MARKER}${OMO_INTERNAL_INITIATOR_MARKER}`

      // when
      const result = stripInternalInitiatorMarkers(text)

      // then
      expect(result).toBe("")
    })
  })

  describe("internal message guards", () => {
    test("#given whitespace-normalized marker text #when checking marker presence #then detects it", () => {
      // given
      const text = "notice\n<!--   OMO_INTERNAL_INITIATOR   -->"

      // when
      const result = hasInternalInitiatorMarker(text)

      // then
      expect(result).toBe(true)
    })

    test("#given synthetic and marker-only user parts #when classifying text parts #then treats them as internal-only", () => {
      // given
      const parts = [
        { type: "text", text: "hidden", synthetic: true },
        { type: "text", text: `reminder\n${OMO_INTERNAL_INITIATOR_MARKER}` },
      ]

      // when
      const result = isSyntheticOrInternalOnlyTextParts(parts)

      // then
      expect(result).toBe(true)
      expect(parts.some(isRealUserTextPart)).toBe(false)
    })

    test("#given mixed real and internal user parts #when classifying #then keeps the message real", () => {
      // given
      const message = {
        info: { role: "user" },
        parts: [
          { type: "text", text: `reminder\n${OMO_INTERNAL_INITIATOR_MARKER}` },
          { type: "text", text: "actual user request" },
        ],
      }

      // when
      const isInternal = isSyntheticOrInternalUserMessage(message)

      // then
      expect(isInternal).toBe(false)
      expect(isRealUserMessage(message)).toBe(true)
    })

    test("#given user message with only a marker-tagged text part #when classifying #then rejects it as real user input", () => {
      // given
      const message = {
        role: "user",
        parts: [{ type: "text", text: `wake up\n${OMO_INTERNAL_INITIATOR_MARKER}` }],
      }

      // when
      const result = isRealUserMessage(message)

      // then
      expect(result).toBe(false)
      expect(isSyntheticOrInternalUserMessage(message)).toBe(true)
    })
  })

  describe("noReply marker", () => {
    test("#given a text part wrapped with the noReply marker #when inspecting it #then it carries both markers and is still synthetic", () => {
      // given
      const part = withInternalNoReplyMarker(createInternalAgentTextPart("task done"))

      // then
      expect(hasInternalInitiatorMarker(part.text)).toBe(true)
      expect(hasInternalNoReplyMarker(part.text)).toBe(true)
      expect(part.text).toContain(OMO_INTERNAL_NOREPLY_MARKER)
    })

    test("#given a continuation part wrapped with the noReply marker #when inspecting it #then synthetic and metadata are preserved", () => {
      // given
      const part = withInternalNoReplyMarker(createInternalAgentContinuationTextPart("recover"))

      // then
      expect(part.synthetic).toBe(true)
      expect(part.metadata).toEqual({ compaction_continue: true })
      expect(hasInternalNoReplyMarker(part.text)).toBe(true)
    })

    test("#given a part already carrying the noReply marker #when wrapping again #then it is not duplicated", () => {
      // given
      const once = withInternalNoReplyMarker(createInternalAgentTextPart("task done"))

      // when
      const twice = withInternalNoReplyMarker(once)

      // then
      expect(twice.text).toBe(once.text)
      expect(twice.text.match(/OMO_INTERNAL_NOREPLY/g)).toHaveLength(1)
    })

    test("#given a noReply-tagged user message #when classifying #then it is a terminal noReply message", () => {
      // given
      const message = {
        info: { role: "user" },
        parts: [withInternalNoReplyMarker(createInternalAgentTextPart("task done"))],
      }

      // then
      expect(isTerminalNoReplyUserMessage(message)).toBe(true)
      expect(isSyntheticOrInternalUserMessage(message)).toBe(true)
    })

    test("#given an ordinary internal user message without the noReply marker #when classifying #then it is not terminal", () => {
      // given
      const message = {
        info: { role: "user" },
        parts: [createInternalAgentTextPart("continue")],
      }

      // then
      expect(isTerminalNoReplyUserMessage(message)).toBe(false)
    })

    test("#given an assistant message carrying the noReply marker #when classifying #then it is not a terminal noReply user message", () => {
      // given
      const message = {
        info: { role: "assistant" },
        parts: [withInternalNoReplyMarker(createInternalAgentTextPart("noise"))],
      }

      // then
      expect(isTerminalNoReplyUserMessage(message)).toBe(false)
    })

    test("#given noReply-marked text #when stripping internal markers #then both markers are removed", () => {
      // given
      const part = withInternalNoReplyMarker(createInternalAgentTextPart("hello world"))

      // when
      const stripped = stripInternalInitiatorMarkers(part.text)

      // then
      expect(stripped).toBe("hello world")
      expect(hasInternalInitiatorMarker(stripped)).toBe(false)
      expect(hasInternalNoReplyMarker(stripped)).toBe(false)
    })
  })
})
