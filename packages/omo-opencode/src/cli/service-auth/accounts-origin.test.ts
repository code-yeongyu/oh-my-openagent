import { describe, expect, test } from "bun:test"
import { accountsOrigin, DEFAULT_ACCOUNTS_ORIGIN } from "./commands"

describe("accountsOrigin", () => {
  test("defaults to the OmO sign-in page, not the identity provider's accounts portal", () => {
    expect(DEFAULT_ACCOUNTS_ORIGIN).toBe("https://signin.omo.dev")
    expect(accountsOrigin({}, {})).toBe("https://signin.omo.dev")
  })

  test("the environment overrides the default, and the flag overrides both", () => {
    expect(accountsOrigin({}, { OMO_SERVICE_ACCOUNTS_URL: "https://signin.example.test" })).toBe("https://signin.example.test")
    expect(accountsOrigin({ accounts: "https://flag.example.test" }, { OMO_SERVICE_ACCOUNTS_URL: "https://signin.example.test" })).toBe("https://flag.example.test")
  })
})
