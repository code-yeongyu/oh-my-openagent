/// <reference path="../../../bun-test.d.ts" />

import { describe, expect, test } from "bun:test"
import * as boulderState from "../src"

describe("normalizeSessionId", () => {
  test("#given a bare id #when normalized without a platform #then opencode is used by default", () => {
    // given
    expect(typeof boulderState.normalizeSessionId).toBe("function")

    // when
    const normalized = boulderState.normalizeSessionId("sess_abc")

    // then
    expect(normalized).toBe("opencode:sess_abc")
  })

  test("#given a bare id and codex platform #when normalized #then codex is used", () => {
    // given
    expect(typeof boulderState.normalizeSessionId).toBe("function")

    // when
    const normalized = boulderState.normalizeSessionId("sess_abc", "codex")

    // then
    expect(normalized).toBe("codex:sess_abc")
  })

  test("#given an opencode-prefixed id #when normalized #then the id is unchanged", () => {
    // given
    const input = "opencode:sess_abc"
    expect(typeof boulderState.normalizeSessionId).toBe("function")

    // when
    const normalized = boulderState.normalizeSessionId(input)

    // then
    expect(normalized).toBe(input)
  })

  test("#given a codex-prefixed id and opencode platform #when normalized #then the existing prefix wins", () => {
    // given
    expect(typeof boulderState.normalizeSessionId).toBe("function")


    // when
    const normalized = boulderState.normalizeSessionId("codex:sess_abc", "opencode")

    // then
    expect(normalized).toBe("codex:sess_abc")
  })

  test("#given an empty id #when normalized #then opencode empty id is preserved", () => {
    // given
    expect(typeof boulderState.normalizeSessionId).toBe("function")

    // when
    const normalized = boulderState.normalizeSessionId("")

    // then
    expect(normalized).toBe("opencode:")
  })
})
