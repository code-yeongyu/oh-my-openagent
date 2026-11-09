import { describe, expect, test } from "bun:test"

import { memoryExpiresAtMs, parseMemoryFile } from "."

const file = (expiresLine: string): string => `---\ndescription: Temporary note\n${expiresLine}\n---\nbody\n`

describe("memory file expiry", () => {
  const cases: ReadonlyArray<readonly [string, string, number | undefined]> = [
    ["a date expires at the start of that UTC day", "expires: 2026-10-28", Date.UTC(2026, 9, 28)],
    ["a UTC instant with minutes", "expires: 2026-10-27T06:33Z", Date.UTC(2026, 9, 27, 6, 33)],
    ["a UTC instant with seconds and fraction", "expires: 2026-10-27T06:33:15.250Z", Date.UTC(2026, 9, 27, 6, 33, 15, 250)],
    ["an instant with a positive offset", "expires: 2026-10-27T15:33+09:00", Date.UTC(2026, 9, 27, 6, 33)],
    ["an instant with a negative offset", "expires: 2026-10-26T23:33:00-07:00", Date.UTC(2026, 9, 27, 6, 33)],
    ["a double-quoted instant", "expires: \"2026-10-27T06:33Z\"", Date.UTC(2026, 9, 27, 6, 33)],
    ["a single-quoted date", "expires: '2026-10-28'", Date.UTC(2026, 9, 28)],
    ["a datetime without an offset is device-local, so it never expires", "expires: 2026-10-27T06:33", undefined],
    ["a date with a space-separated time is not ISO 8601", "expires: 2026-10-27 06:33Z", undefined],
    ["an impossible calendar date", "expires: 2026-02-30", undefined],
    ["an impossible hour", "expires: 2026-10-27T25:00Z", undefined],
    ["free text", "expires: after the outage", undefined],
    ["an empty value", "expires: ", undefined],
    ["no expires key", "kind: note", undefined],
  ]

  test.each(cases)("#given %s #when the file is read #then its expiry instant is as declared", (_name, line, expected) => {
    // given
    const parsed = parseMemoryFile(file(line))

    // when
    const expiresAt = memoryExpiresAtMs(parsed.frontmatter)

    // then
    expect(expiresAt).toBe(expected)
  })
})
