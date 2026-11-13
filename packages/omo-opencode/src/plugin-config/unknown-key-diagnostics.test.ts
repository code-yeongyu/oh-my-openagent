import { describe, expect, test } from "bun:test"
import * as z from "zod"

import { findUnknownKeyPaths } from "./unknown-key-diagnostics"

describe("findUnknownKeyPaths", () => {
  test("#given an own constructor key absent from the schema shape #when walking unknown keys #then treats it as data instead of an inherited schema member", () => {
    // given
    const schema = z.object({ permission: z.object({ edit: z.string().optional() }).strict() }).strict()
    const value = { permission: JSON.parse('{"constructor":"deny"}') }

    // when
    const paths = findUnknownKeyPaths(schema, value)

    // then
    expect(paths).toEqual([["permission", "constructor"]])
  })
})
