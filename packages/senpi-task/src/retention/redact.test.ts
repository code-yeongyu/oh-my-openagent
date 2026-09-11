import { describe, expect, test } from "bun:test"

import { ARCHIVE_REDACTION_ID, redactArchiveText, redactArchiveValue } from "./redact"

// Fixtures are assembled at runtime (prefix + body) so the SOURCE never contains a contiguous
// credential-shaped literal: they are all synthetic fakes, but GitHub push protection
// pattern-matches the file text, and a test fixture must never look like a real secret.
const tok = (prefix: string, body: string) => `${prefix}${body}`

describe("redactArchiveText", () => {
  test("#given vendor credential shapes #when redacting #then each is replaced with the sentinel", () => {
    const cases: readonly [string, string][] = [
      ["anthropic", `key ${tok("sk-ant-api03-", "abcdef0123456789abcdef0123456789abcdef01")} here`],
      ["openai project", `key ${tok("sk-proj-", "abcdef0123456789abcdef0123456789")} here`],
      ["openai legacy", `key ${tok("sk-", "abcdef0123456789abcdef0123456789abcdef01")} here`],
      ["aws", `key ${tok("AKIA", "IOSFODNN7EXAMPLE")} here`],
      ["aws temp", `key ${tok("ASIA", "IOSFODNN7EXAMPLE")} here`],
      ["github", `token ${tok("ghp_", "0123456789abcdefghijklmnopqrstuvwxyzAB")} here`],
      ["slack", `token ${tok("xoxb-", "123456789012-1234567890123-abcdefabcdefabcdef")} here`],
      ["google", `key ${tok("AIza", "SyA1234567890abcdefghijklmnopqrstuvw")} here`],
      ["jwt", `jwt ${tok("eyJhbGciOiJIUzI1NiJ9.", "eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5c")} here`],
      ["bearer", `Authorization: ${tok("Bearer ", "abcdef0123456789abcdef0123456789")} here`],
    ]
    for (const [name, text] of cases) {
      const redacted = redactArchiveText(text)
      expect(redacted.includes("[REDACTED]"), name).toBe(true)
      expect(redacted === text, name).toBe(false)
    }
  })

  test("#given a pem private key block #when redacting #then the whole block including the body is removed", () => {
    const text = `before
-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAAB
-----END OPENSSH PRIVATE KEY-----
after`
    const redacted = redactArchiveText(text)
    expect(redacted).not.toContain("b3BlbnNzaC1rZXktdjE")
    expect(redacted).toContain("before")
    expect(redacted).toContain("after")
  })

  test("#given ordinary engineering text #when redacting #then nothing changes and the same reference returns", () => {
    const text = "run bun test packages/senpi-task and report the failure count at 0"
    expect(redactArchiveText(text)).toBe(text)
  })

  test("#given multiple secrets in one string #when redacting #then all occurrences are replaced", () => {
    const redacted = redactArchiveText(`a ${tok("AKIA", "IOSFODNN7EXAMPLE")} b ${tok("AKIA", "IOSFODNN7EXAMPL2")} c`)
    expect(redacted.match(/\[REDACTED\]/g)).toHaveLength(2)
  })
})

describe("redactArchiveValue", () => {
  test("#given nested objects and arrays #when redacting #then structure is preserved and every string is redacted", () => {
    const value = {
      tool: "bash",
      output: [`export TOKEN=${tok("ghp_", "0123456789abcdefghijklmnopqrstuvwxyzAB")}`, { nested: tok("sk-ant-api03-", "abcdef0123456789abcdef01") }],
      count: 3,
      flag: false,
      nil: null,
    }
    expect(redactArchiveValue(value)).toEqual({
      tool: "bash",
      output: ["export TOKEN=[REDACTED]", { nested: "[REDACTED]" }],
      count: 3,
      flag: false,
      nil: null,
    })
  })

  test("#given the redaction id #when archiving #then it is the documented builtin version", () => {
    expect(ARCHIVE_REDACTION_ID).toBe("builtin-v1")
  })
})
