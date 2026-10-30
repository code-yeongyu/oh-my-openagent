import { describe, expect, test } from "bun:test"

import { READABLE_NAMED_VALUES, READABLE_PROVIDER_TEXT, SECRET_CELLS } from "../manager/__fixtures__/secret-inventory"
import { redactSecretText } from "./secret-text"

// The same generated matrix senpi#4283 runs against its stream boundary: every secret shape, key spelling, quoting and
// container. omo stores provider text from children, so its redactor must clear exactly the same cells.
describe("redactSecretText over the shared secret matrix (#11355)", () => {
  test.each(SECRET_CELLS.map((cell) => [cell.name, cell] as const))("#given %s #when redacted #then the secret is gone", (_name, cell) => {
    const redacted = redactSecretText(cell.text)

    expect(redacted).toContain("[REDACTED]")
    expect(redacted.includes(cell.secret)).toBe(false)
    expect(redactSecretText(redacted)).toBe(redacted)
  })

  test("#given model ids, error codes and request ids #when redacted #then the text is unchanged", () => {
    expect(redactSecretText(READABLE_PROVIDER_TEXT)).toBe(READABLE_PROVIDER_TEXT)
  })

  test.each([...READABLE_NAMED_VALUES, "MAX_TOKENS=4096 exceeded"])("#given %s #when redacted #then the text is unchanged", (text) => {
    expect(redactSecretText(text)).toBe(text)
  })

  test("#given a short cookie value #when redacted #then every cookie value is gone", () => {
    expect(redactSecretText("Cookie: a=1; sid=s3cr3t")).toBe("Cookie: a=[REDACTED]; sid=[REDACTED]")
  })
})

const MB = 1 << 20
const fill = (size: number, unit: string): string => unit.repeat(Math.ceil(size / unit.length)).slice(0, size)

// Inputs that made the previous name pattern retry one long run from every position (quadratic), plus every other
// rule's worst case.
const ADVERSARIAL: readonly (readonly [label: string, build: (size: number) => string])[] = [
  ["a keyword repeated", (size) => fill(size, "key")],
  ["a separated keyword repeated", (size) => fill(size, "token_")],
  ["a keyword inside a word repeated", (size) => fill(size, "aaaaakey")],
  ["short credential values repeated", (size) => fill(size, "key: a ")],
  ["separators repeated", (size) => fill(size, "a:")],
  ["whitespace after a credential name", (size) => `key:${" ".repeat(size)}`],
  ["cookie pairs repeated", (size) => `Cookie: ${fill(size, "a=1; ")}`],
  ["cookie names repeated", (size) => fill(size, "Cookie: ")],
  ["open credential objects repeated", (size) => fill(size, "api_key: {")],
  ["XML credential tags repeated", (size) => fill(size, "<apiKey>")],
  ["URL userinfo heads repeated", (size) => fill(size, "https://u:")],
  ["bearer schemes repeated", (size) => fill(size, "bearer ")],
  ["quotes after a name", (size) => `key${fill(size, '\\"')}`],
  ["names past the length bound", (size) => fill(size, `${"a".repeat(129)}_api_key: x `)],
]

// Linearity is the contract, not a wall-clock budget: a fixed ms bound fails on a slow or loaded runner. Each 10x step
// in input size must cost well under the 100x a quadratic scan pays (same shape as senpi#4283's scaling test).
const SIZES = [MB / 100, MB / 10, MB] as const
const MAX_GROWTH_PER_STEP = 30
const NOISE_FLOOR_MS = 1

function bestOf3Ms(text: string): number {
  let best = Number.POSITIVE_INFINITY
  for (let attempt = 0; attempt < 3; attempt++) {
    const start = performance.now()
    redactSecretText(text)
    best = Math.min(best, performance.now() - start)
  }
  return best
}

describe("redactSecretText stays linear (#11355, senpi#4283)", () => {
  test.each(ADVERSARIAL)("#given up to 1 MB of %s #when redacted at 10x larger sizes #then time grows linearly", (_label, build) => {
    const times = SIZES.map((size) => bestOf3Ms(build(size)))
    for (let step = 1; step < times.length; step++) {
      const growth = times[step] / Math.max(times[step - 1], NOISE_FLOOR_MS)
      expect(growth).toBeLessThan(MAX_GROWTH_PER_STEP)
    }
  })
})
