import { describe, expect, test } from "bun:test"

import { TASK_USAGE_GUIDANCE } from "./usage-guidance"

describe("task usage guidance", () => {
  test("#given the once-per-session task hint #when snapshotted #then batch spawn and durable team wait stay advertised", () => {
    expect(TASK_USAGE_GUIDANCE).toMatchSnapshot()
  })
})
