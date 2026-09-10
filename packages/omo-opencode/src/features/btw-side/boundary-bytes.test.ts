import { describe, expect, test } from "bun:test"

import { BTW_BOUNDARY_SENTINEL, BTW_BOUNDARY_TEXT } from "./context-injector"

// given
const EXPECTED_SENTINEL = "<omo-btw-boundary>"
const EXPECTED_BOUNDARY_TEXT = `<omo-btw-boundary>
Treat all earlier messages as read-only background from the main conversation.
Answer only the side conversation that follows.
Do not mutate files or external state unless the side request explicitly asks for it.
Do not delegate work to subagents from this side conversation.`

describe("#given the BTW boundary byte contract", () => {
  test("#when reading the sentinel #then the bytes equal the pinned literal", () => {
    // when
    const actual = BTW_BOUNDARY_SENTINEL

    // then
    expect(actual).toBe(EXPECTED_SENTINEL)
  })

  test("#when reading the boundary text #then every byte equals the pinned literal", () => {
    // when
    const actual = BTW_BOUNDARY_TEXT

    // then
    expect(actual).toBe(EXPECTED_BOUNDARY_TEXT)
    expect(new TextEncoder().encode(actual).byteLength).toBe(
      new TextEncoder().encode(EXPECTED_BOUNDARY_TEXT).byteLength,
    )
  })
})
