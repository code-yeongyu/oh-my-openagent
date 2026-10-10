import { describe, expect, it } from "bun:test"

import { fakeCommandContext } from "./commands.test-support"
import { respond } from "./types"

describe("respond", () => {
  it("#given text carrying a credential assignment #when responded #then the notification and the returned text are masked", () => {
    // given
    const ctx = fakeCommandContext()

    // when
    const returned = respond(ctx, "lock at /x pid 1 token=abc123456", "info")

    // then
    expect(returned).not.toContain("abc123456")
    expect(returned).toContain("***")
    expect(ctx.ui.notifications).toEqual([{ message: returned, level: "info" }])
  })

  it("#given structured text carrying a credential assignment #when responded #then the result still parses and only the credential is masked", () => {
    // given
    const ctx = fakeCommandContext()

    // when
    const returned = respond(ctx, JSON.stringify({ detail: "token=abc123456", n: 3 }))

    // then
    expect(JSON.parse(returned)).toEqual({ detail: "***", n: 3 })
  })
})
