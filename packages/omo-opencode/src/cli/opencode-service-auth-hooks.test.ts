import { describe, expect, test } from "bun:test"
import { cliServiceAuthHooks } from "../../../omo-native/service-auth-command"
import { openCodeServiceAuthHooks } from "./cli-program"

describe("OpenCode CLI service auth", () => {
  test("#given the OpenCode CLI #when login is configured #then it uses the same device-service hooks as omo login", () => {
    expect(openCodeServiceAuthHooks().deviceService).toBe(cliServiceAuthHooks.deviceService)
  })
})
