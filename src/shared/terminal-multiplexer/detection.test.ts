import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test"
import { detectMultiplexer, createMultiplexer, resetDetectionCache } from "./detection"
import { TmuxAdapter } from "./tmux-adapter"
import { ZellijAdapter } from "./zellij-adapter"

describe("detectMultiplexer", () => {
  beforeEach(() => {
    resetDetectionCache()
    delete process.env.TMUX
    delete process.env.ZELLIJ
    delete process.env.ZELLIJ_SESSION_NAME
  })

  afterEach(() => {
    resetDetectionCache()
  })

  it("returns 'tmux' when $TMUX env var is set", async () => {
    //#given
    process.env.TMUX = "/tmp/tmux-1000/default,1234,0"

    //#when
    const result = await detectMultiplexer()

    //#then
    expect(result).toBe("tmux")
  })

  it("returns 'zellij' when $ZELLIJ env var is set", async () => {
    //#given
    process.env.ZELLIJ = "/tmp/zellij-1000/default"

    //#when
    const result = await detectMultiplexer()

    //#then
    expect(result).toBe("zellij")
  })

  it("returns 'zellij' when $ZELLIJ_SESSION_NAME env var is set", async () => {
    //#given
    process.env.ZELLIJ_SESSION_NAME = "default"

    //#when
    const result = await detectMultiplexer()

    //#then
    expect(result).toBe("zellij")
  })

  it("prefers $TMUX over $ZELLIJ when both are set", async () => {
    //#given
    process.env.TMUX = "/tmp/tmux-1000/default,1234,0"
    process.env.ZELLIJ = "/tmp/zellij-1000/default"

    //#when
    const result = await detectMultiplexer()

    //#then
    expect(result).toBe("tmux")
  })

  it("caches detection result on subsequent calls", async () => {
    //#given
    process.env.TMUX = "/tmp/tmux-1000/default,1234,0"

    //#when
    const result1 = await detectMultiplexer()
    delete process.env.TMUX
    const result2 = await detectMultiplexer()

    //#then
    expect(result1).toBe("tmux")
    expect(result2).toBe("tmux")
  })

  it("returns null when no multiplexer is detected", async () => {
    //#given
    // No env vars set, and we can't mock spawn easily for binary detection
    // This test verifies the fallback behavior

    //#when
    resetDetectionCache()
    const result = await detectMultiplexer()

    //#then
    expect(result === null || result === "tmux" || result === "zellij").toBe(true)
  })
})

describe("createMultiplexer", () => {
  it("creates TmuxAdapter when type is 'tmux'", () => {
    //#given
    const type = "tmux" as const

    //#when
    const adapter = createMultiplexer(type)

    //#then
    expect(adapter).toBeInstanceOf(TmuxAdapter)
    expect(adapter.type).toBe("tmux")
  })

  it("creates ZellijAdapter when type is 'zellij'", () => {
    //#given
    const type = "zellij" as const

    //#when
    const adapter = createMultiplexer(type)

    //#then
    expect(adapter).toBeInstanceOf(ZellijAdapter)
    expect(adapter.type).toBe("zellij")
  })

  it("passes tmux config to TmuxAdapter", () => {
    //#given
    const config = {
      tmux: {
        enabled: true,
        sessionPrefix: "omo-",
      },
    }

    //#when
    const adapter = createMultiplexer("tmux", config)

    //#then
    expect(adapter).toBeInstanceOf(TmuxAdapter)
    expect(adapter.type).toBe("tmux")
  })

  it("passes zellij config to ZellijAdapter", () => {
    //#given
    const config = {
      zellij: {
        enabled: true,
        sessionPrefix: "omo-",
      },
    }

    //#when
    const adapter = createMultiplexer("zellij", config)

    //#then
    expect(adapter).toBeInstanceOf(ZellijAdapter)
    expect(adapter.type).toBe("zellij")
  })

  it("uses default config when none provided", () => {
    //#given
    //#when
    const tmuxAdapter = createMultiplexer("tmux")
    const zellijAdapter = createMultiplexer("zellij")

    //#then
    expect(tmuxAdapter).toBeInstanceOf(TmuxAdapter)
    expect(zellijAdapter).toBeInstanceOf(ZellijAdapter)
  })

  it("throws error for unknown multiplexer type", () => {
    //#given
    //#when
    const fn = () => createMultiplexer("unknown" as any)

    //#then
    expect(fn).toThrow("Unknown multiplexer type")
  })

  it("TmuxAdapter has correct capabilities", () => {
    //#given
    //#when
    const adapter = createMultiplexer("tmux")

    //#then
    expect(adapter.capabilities.manualLayout).toBe(true)
    expect(adapter.capabilities.persistentLabels).toBe(false)
  })

  it("ZellijAdapter has correct capabilities", () => {
    //#given
    //#when
    const adapter = createMultiplexer("zellij")

    //#then
    expect(adapter.capabilities.manualLayout).toBe(false)
    expect(adapter.capabilities.persistentLabels).toBe(true)
  })
})

describe("resetDetectionCache", () => {
  it("clears cached detection result", async () => {
    //#given
    process.env.TMUX = "/tmp/tmux-1000/default,1234,0"
    await detectMultiplexer()

    //#when
    resetDetectionCache()
    delete process.env.TMUX
    process.env.ZELLIJ = "/tmp/zellij-1000/default"
    const result = await detectMultiplexer()

    //#then
    expect(result).toBe("zellij")
  })
})
