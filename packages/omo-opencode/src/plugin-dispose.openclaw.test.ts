import { describe, expect, it, mock } from "bun:test"

const { createPluginDispose } = await import("./plugin-dispose")

describe("createPluginDispose OpenClaw wiring", () => {
  it("stops the reply listener during disposal", async () => {
    const shutdown = mock(async () => {})
    const disconnectAll = mock(async () => {})
    const disposeHooks = mock(() => {})
    const disposeOpenClaw = mock(async () => {})

    const dispose = createPluginDispose({
      backgroundManager: { shutdown },
      skillMcpManager: { disconnectAll },
      disposeHooks,
      disposeOpenClaw,
    })

    await dispose()

    expect(shutdown).toHaveBeenCalledTimes(1)
    expect(disconnectAll).toHaveBeenCalledTimes(1)
    expect(disposeOpenClaw).toHaveBeenCalledTimes(1)
    expect(disposeHooks).toHaveBeenCalledTimes(1)
  })

  it("skips OpenClaw disposal when no listener was started by this instance", async () => {
    const shutdown = mock(async () => {})
    const disconnectAll = mock(async () => {})
    const disposeHooks = mock(() => {})

    const dispose = createPluginDispose({
      backgroundManager: { shutdown },
      skillMcpManager: { disconnectAll },
      disposeHooks,
    })

    await dispose()

    expect(shutdown).toHaveBeenCalledTimes(1)
    expect(disconnectAll).toHaveBeenCalledTimes(1)
    expect(disposeHooks).toHaveBeenCalledTimes(1)
  })
})
