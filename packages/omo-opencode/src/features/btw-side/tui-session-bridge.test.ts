import { describe, expect, it } from "bun:test"

import { isCurrentTuiSession } from "./tui-session-bridge"

describe("isCurrentTuiSession", () => {
  it("#given an adoption lookup #when the route changes #then the original session is stale", () => {
    // given
    const route = {
      current: {
        name: "session",
        params: {
          sessionID: "ses_a",
        },
      },
    }

    // then
    expect(isCurrentTuiSession({ route } as never, "ses_a")).toBe(true)

    // when
    route.current.params.sessionID = "ses_b"

    // then
    expect(isCurrentTuiSession({ route } as never, "ses_a")).toBe(false)
  })
})
