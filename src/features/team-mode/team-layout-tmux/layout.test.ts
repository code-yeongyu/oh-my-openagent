import { beforeEach, describe, expect, mock, test } from "bun:test"

const spawnMock = mock(() => ({
  exited: Promise.resolve(0),
  stdout: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("%1\n")); controller.close() } }),
  stderr: new ReadableStream({ start(controller) { controller.close() } }),
}))

mock.module("bun", () => ({ spawn: spawnMock }))

mock.module("../../../tools/interactive-bash/tmux-path-resolver", () => ({ getTmuxPath: mock(() => Promise.resolve("tmux")) }))

mock.module("../../../shared", () => ({ log: mock(() => undefined) }))

import { createTeamLayout, removeTeamLayout, canVisualize } from "./layout"

describe("team-layout-tmux", () => {
  beforeEach(() => {
    spawnMock.mockClear()
    process.env.TMUX = "/tmp/tmux-1"
  })

  test("returns null and makes no tmux calls when visualization unavailable", async () => {
    // given
    delete process.env.TMUX

    // when
    const result = await createTeamLayout("run-1", [], {} as never)

    // then
    expect(canVisualize()).toBe(false)
    expect(result).toBeNull()
    expect(spawnMock).toHaveBeenCalledTimes(0)
  })

  test("creates focus and grid windows", async () => {
    // given
    const members = [
      { name: "lead", sessionId: "s1", color: "red" },
      { name: "m2", sessionId: "s2" },
      { name: "m3", sessionId: "s3" },
    ]

    // when
    await createTeamLayout("run-2", members, {} as never)

    // then
    expect(spawnMock.mock.calls.flatMap((call) => call[0] as Array<string>)).toContain("new-session")
    expect(spawnMock.mock.calls.flatMap((call) => call[0] as Array<string>)).toContain("new-window")
    expect(spawnMock.mock.calls.flatMap((call) => call[0] as Array<string>)).toContain("split-window")
    expect(spawnMock.mock.calls.flatMap((call) => call[0] as Array<string>)).toContain("select-layout")
    expect(spawnMock.mock.calls.flatMap((call) => call[0] as Array<string>)).toContain("select-pane")
  })

  test("returns null when tmux command fails", async () => {
    // given
    spawnMock.mockImplementationOnce(() => ({
      exited: Promise.resolve(1),
      stdout: new ReadableStream({ start(controller) { controller.close() } }),
      stderr: new ReadableStream({ start(controller) { controller.close() } }),
    }))

    // when
    const result = await createTeamLayout("run-3", [{ name: "lead", sessionId: "s1" }], {} as never)

    // then
    expect(result).toBeNull()
  })

  test("cleans up the tmux session", async () => {
    // given
    // when
    await removeTeamLayout("run-4", {} as never)

    // then
    expect(spawnMock.mock.calls.some((call) => (call[0] as Array<string>).includes("kill-session"))).toBe(true)
  })
})
