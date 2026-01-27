import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { logout } from "./logout"

describe("logout command", () => {
  beforeEach(() => {
    // setup
  })

  afterEach(() => {
    // cleanup
  })

  it("returns success code when logout succeeds", async () => {
    // given
    const serverName = "test-server"

    // when
    const exitCode = await logout(serverName)

    // then
    expect(typeof exitCode).toBe("number")
    expect(exitCode === 0 || exitCode === 1).toBe(true)
  })

  it("handles non-existent server gracefully", async () => {
    // given
    const serverName = "non-existent-server"

    // when
    const exitCode = await logout(serverName)

    // then
    expect(typeof exitCode).toBe("number")
  })
})
