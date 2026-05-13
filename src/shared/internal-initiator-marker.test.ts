import { describe, expect, test } from "bun:test"
import {
  OMO_INTERNAL_INITIATOR_MARKER,
  createInternalAgentTextPart,
  stripInternalInitiatorMarkers,
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
})
