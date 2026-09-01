import { describe, expect, test } from "bun:test"

import { closeTeamMemberPane } from "./close-team-member-pane"
import { closeTeamMemberPane as coreCloseTeamMemberPane } from "@oh-my-opencode/team-core/team-layout-tmux/close-team-member-pane"

describe("closeTeamMemberPane adapter shim", () => {
  test("#given omo-opencode shim #when imported #then it re-exports team-core implementation", () => {
    expect(closeTeamMemberPane).toBe(coreCloseTeamMemberPane)
  })
})
