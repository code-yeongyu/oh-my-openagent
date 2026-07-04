import { describe, expect, test } from "bun:test"
import { expandEnvReferences, expandEnvReferencesInObject } from "./env-expansion"

describe("expandEnvReferences", () => {
  test("#given an untrusted command-looking env value #when expanding #then it remains inert string data", () => {
    // given
    const env = {
      PAYLOAD: "$(touch /tmp/omo-should-not-exist)",
    }

    // when
    const result = expandEnvReferences("${PAYLOAD}", {
      env,
      isAllowed: (name: string) => name === "PAYLOAD",
    })

    // then
    expect(result).toBe("$(touch /tmp/omo-should-not-exist)")
  })

  test("#given a blocked variable with a fallback #when expanding #then fallback is used and block is reported", () => {
    // given
    const blocked: string[] = []

    // when
    const result = expandEnvReferences("${SECRET_TOKEN:-fallback}", {
      env: { SECRET_TOKEN: "secret" },
      isAllowed: () => false,
      onBlocked: (name: string) => blocked.push(name),
    })

    // then
    expect(result).toBe("fallback")
    expect(blocked).toEqual(["SECRET_TOKEN"])
  })
})

describe("expandEnvReferencesInObject", () => {
  test("#given nested arrays and objects #when expanding #then strings expand recursively", () => {
    // given
    const input = {
      args: ["--cwd", "${HOME}"],
      headers: {
        Authorization: "Bearer ${TOKEN:-redacted}",
      },
    }

    // when
    const result = expandEnvReferencesInObject(input, {
      env: { HOME: "/Users/tester", TOKEN: "secret" },
      isAllowed: (name: string) => name === "HOME",
    })

    // then
    expect(result).toEqual({
      args: ["--cwd", "/Users/tester"],
      headers: {
        Authorization: "Bearer redacted",
      },
    })
  })

  test("#given prototype pollution keys #when expanding objects #then unsafe keys are ignored", () => {
    // given
    const input = JSON.parse(
      '{"__proto__":{"polluted":"${PAYLOAD}"},"constructor":{"polluted":"${PAYLOAD}"},"prototype":{"polluted":"${PAYLOAD}"},"safe":"ok"}',
    )

    // when
    const result = expandEnvReferencesInObject(input, {
      env: { PAYLOAD: "EXPANDED" },
    })

    // then
    expect(Reflect.get(Object.getPrototypeOf(result), "polluted")).toBeUndefined()
    expect(Reflect.get(Object.prototype, "polluted")).toBeUndefined()
    expect(Object.prototype.hasOwnProperty.call(result, "__proto__")).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(result, "constructor")).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(result, "prototype")).toBe(false)
    expect(result).toEqual({ safe: "ok" })
  })
})
