import { describe, expect, test } from "bun:test"

describe("test environment isolation", () => {
  test("#given the host has an OpenCode server password #when the test preload runs #then the credential is not inherited by tests", () => {
    expect(process.env.OPENCODE_SERVER_PASSWORD).toBeUndefined()
  })
})
