import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { status } from "./status"

describe("status command", () => {
  beforeEach(() => {
    // setup
  })

  afterEach(() => {
    // cleanup
  })

  it("returns success code when checking status for specific server", async () => {
    // given
    const serverName = "test-server"

    // when
    const exitCode = await status(serverName)

    // then
    expect(typeof exitCode).toBe("number")
    expect(exitCode).toBe(0)
  })

  it("returns success code when checking status for all servers", async () => {
    // given
    const serverName = undefined

    // when
    const exitCode = await status(serverName)

    // then
    expect(typeof exitCode).toBe("number")
    expect(exitCode).toBe(0)
  })

  it("handles non-existent server gracefully", async () => {
    // given
    const serverName = "non-existent-server"

    // when
    const exitCode = await status(serverName)

    // then
    expect(typeof exitCode).toBe("number")
    expect(exitCode).toBe(0)
  })
})
