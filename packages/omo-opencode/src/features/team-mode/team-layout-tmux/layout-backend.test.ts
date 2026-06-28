import { describe, expect, test } from "bun:test"

import {
  createTeamLayout,
  removeTeamLayout,
  type TeamLayoutBackend,
  type TeamLayoutResult,
} from "./layout"

const tmuxMgr = { getServerUrl: () => "http://127.0.0.1:12345" }

describe("team layout backend seam", () => {
  test("#given an alternate team layout backend #when create/remove run #then layout calls route through the backend seam", async () => {
    // given
    const result: TeamLayoutResult = {
      focusWindowId: "native-focus",
      focusPanesByMember: { m1: "native-pane" },
      gridPanesByMember: {},
      targetSessionId: "native-session",
      ownedSession: false,
    }
    const createRequests: Array<string> = []
    const removeRequests: Array<string> = []
    const backend: TeamLayoutBackend = {
      kind: "native-terminal",
      canVisualize: () => true,
      createLayout: async (request) => {
        createRequests.push(request.tmuxMgr.getServerUrl())
        return result
      },
      removeLayout: async (request) => {
        removeRequests.push(request.cleanupTarget?.targetSessionId ?? request.teamRunId)
      },
    }

    // when
    const created = await createTeamLayout(
      "run-backend",
      [{ name: "m1", sessionId: "s-m1", worktreePath: "/tmp/m1" }],
      tmuxMgr,
      backend,
    )
    await removeTeamLayout("run-backend", result, tmuxMgr, backend)

    // then
    expect(created).toEqual(result)
    expect(createRequests).toEqual(["http://127.0.0.1:12345"])
    expect(removeRequests).toEqual(["native-session"])
  })
})
