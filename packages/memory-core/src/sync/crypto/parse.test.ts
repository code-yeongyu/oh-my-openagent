import { describe, expect, test } from "bun:test"
import { parseBody } from "./parse.ts"
import { record } from "./testing/sync-v1.test-support.ts"

describe("parseBody: the rotation schema", () => {
  test("fork_resolution is null or a positive integer seq; any other number is refused", () => {
    const rotation = record("post_join_rotation").body
    expect(parseBody(rotation)?.kind).toBe("rotation")
    expect(parseBody({ ...rotation, fork_resolution: 7 })?.kind).toBe("rotation")
    for (const bad of [1.5, 0, -3, Number.MAX_SAFE_INTEGER + 2]) {
      expect(parseBody({ ...rotation, fork_resolution: bad })).toBeNull()
    }
  })
})
