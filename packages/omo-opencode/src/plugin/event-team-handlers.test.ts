import { describe, expect, it } from "bun:test"

import { createEventTeamHandlers } from "./event-team-handlers"
import { unsafeTestValue } from "../../../../test-support/unsafe-test-value"

describe("createEventTeamHandlers", () => {
  it("#given team mode without promptAsync #when creating handlers #then idle wake hint handler is still installed", () => {
    // given
    const pluginConfig = unsafeTestValue({
      team_mode: {
        enabled: true,
      },
    })
    const pluginContext = unsafeTestValue({
      directory: "/tmp",
      client: {
        session: {},
      },
    })
    const managers = unsafeTestValue({
      tmuxSessionManager: {},
      backgroundManager: {},
    })

    // when
    const handlers = createEventTeamHandlers({ pluginConfig, pluginContext, managers })

    // then
    expect(handlers.teamIdleWakeHint).toBeFunction()
  })
})
