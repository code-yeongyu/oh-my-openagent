/// <reference types="bun-types" />

import { afterEach, expect, mock, test } from "bun:test"

const layoutSpecifier = import.meta.resolve("./layout")
const originalTmux = process.env.TMUX
const isServerRunningMock = mock(async () => false)

afterEach(() => {
  if (originalTmux === undefined) delete process.env.TMUX
  else process.env.TMUX = originalTmux
  mock.restore()
})

test("#given the production layout dependencies #when current-listener readiness fails #then it requests authenticated health", async () => {
  // given
  const currentServerUrl = "http://127.0.0.1:43127"
  process.env.TMUX = "/tmp/team-layout-auth"
  mock.module("@oh-my-opencode/tmux-core", () => ({
    isServerRunning: isServerRunningMock,
    runTmuxCommand: mock(async () => ({ success: false, output: "", stdout: "", stderr: "", exitCode: 1 })),
  }))
  const { createTeamLayout } = await import(`${layoutSpecifier}?test=${crypto.randomUUID()}`)

  // when
  const result = await createTeamLayout(
    "run-auth-boundary",
    [{ name: "worker", sessionId: "session-worker" }],
    {
      getServerUrl: () => currentServerUrl,
      getCtxServerUrl: () => "http://127.0.0.1:43128",
    },
  )

  // then
  expect(result).toBeNull()
  expect(isServerRunningMock.mock.calls).toEqual([
    [currentServerUrl, { authentication: "opencode-server" }],
  ])
})
