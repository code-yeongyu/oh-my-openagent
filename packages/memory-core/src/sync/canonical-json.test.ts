import { describe, expect, test } from "bun:test"
import { canonicalizeJson, CanonicalJsonError, requireCanonicalJson } from "./canonical-json"

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

// RFC 8785 §3.2.2/§3.2.3 published examples: input is parsed, then the
// canonical form must equal the RFC's expected output byte for byte.
const RFC8785_EXAMPLES: { name: string; input: string; canonical: string }[] = [
  {
    name: "§3.2.2 primitives: numbers re-serialized, string escapes minimized",
    input: '{\n"numbers": [333333333.33333329, 1E30, 4.50,\n2e-3, 0.000000000000000000000000001],\n"string": "\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"/",\n"literals": [null, true, false]\n}',
    canonical: '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
  },
  {
    name: "§3.2.3 sorting: UTF-16 code unit order, not UTF-8",
    input: '{\n"\\u20ac": "Euro Sign",\n"\\r": "Carriage Return",\n"\\ufb33": "Hebrew Letter Dalet With Dagesh",\n"1": "One",\n"\\ud83d\\ude00": "Emoji: Grinning Face",\n"\\u0080": "Control",\n"\\u00f6": "Latin Small Letter O With Diaeresis"\n}',
    canonical: '{"\\r":"Carriage Return","1":"One","\u0080":"Control","ö":"Latin Small Letter O With Diaeresis","€":"Euro Sign","😀":"Emoji: Grinning Face","דּ":"Hebrew Letter Dalet With Dagesh"}',
  },
]

const enc = (s: string) => new TextEncoder().encode(s)

describe("canonical-json (RFC 8785)", () => {
  for (const { name, input, canonical } of RFC8785_EXAMPLES) {
    test(`published example: ${name}`, () => {
      const parsed = JSON.parse(input) as Json
      expect(Buffer.from(canonicalizeJson(parsed)).toString("utf8")).toBe(canonical)
      expect(() => requireCanonicalJson(enc(canonical))).not.toThrow()
    })
  }

  test("accepts a canonical record with a space inside a string value", () => {
    // A whitespace heuristic would refuse this; RFC 8785 keeps it.
    const canonical = '{"name":"My Mac","t":"omo-sync/v1/record"}'
    expect(() => requireCanonicalJson(enc(canonical))).not.toThrow()
  })

  test.each([
    ["whitespace between tokens", '{ "t":"omo-sync/v1/record" }', "whitespace"],
    ["unsorted keys", '{"z":1,"t":"omo-sync/v1/record","a":2}', "order"],
    ["duplicate key", '{"t":"omo-sync/v1/object-digest","t":"omo-sync/v1/record"}', "duplicate-key"],
    ["duplicate key nested", '{"t":"omo-sync/v1/record","o":{"a":1,"a":2}}', "duplicate-key"],
    ["non-canonical number 1.0", '{"n":1.0,"t":"omo-sync/v1/record"}', "number"],
    ["non-canonical number 1E30", '{"n":1E30,"t":"omo-sync/v1/record"}', "number"],
    ["non-canonical number 0.002 vs 2e-3 input", '{"n":2e-3,"t":"omo-sync/v1/record"}', "number"],
    ["overflowing number", '{"n":1e999,"t":"omo-sync/v1/record"}', "number"],
    ["non-minimal escape \\/", '{"t":"omo-sync\\/v1\\/record"}', "escape"],
    ["uppercase escape \\u000F", '{"t":"\\u000F"}', "escape"],
    ["not json", "{nope", "json"],
    ["trailing garbage", '{"t":"omo-sync/v1/record"}x', "json"],
  ] as const)("refuses %s with a typed violation", (_label, input, violation) => {
    let failure: unknown
    try {
      requireCanonicalJson(enc(input))
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(CanonicalJsonError)
    expect((failure as CanonicalJsonError).violation).toBe(violation)
  })

  test("refuses invalid UTF-8 and lone surrogates", () => {
    expect(() => requireCanonicalJson(new Uint8Array([0xff, 0xfe]))).toThrow(CanonicalJsonError)
    let failure: unknown
    try {
      requireCanonicalJson(enc('{"t":"\\ud83d"}'))
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(CanonicalJsonError)
    expect((failure as CanonicalJsonError).violation).toBe("encoding")
  })

  test("a canonical record with a __proto__ key is accepted and keeps it as an own property", () => {
    const parsed = requireCanonicalJson(enc('{"__proto__":{"x":1},"t":"omo-sync/v1/record"}')) as Record<string, unknown>
    expect(Object.keys(parsed)).toEqual(["__proto__", "t"])
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype)
  })

  test("nesting deeper than 64 is a typed json violation on parse and on serialize, never a RangeError", () => {
    const deep = (n: number) => "[".repeat(n) + "]".repeat(n)
    expect(requireCanonicalJson(enc(deep(64)))).toBeDefined()
    for (const n of [65, 200_000]) {
      let failure: unknown
      try {
        requireCanonicalJson(enc(deep(n)))
      } catch (error) {
        failure = error
      }
      expect(failure).toBeInstanceOf(CanonicalJsonError)
      expect((failure as CanonicalJsonError).violation).toBe("json")
    }
    let value: Json = []
    for (let i = 0; i < 64; i++) value = [value]
    expect(() => canonicalizeJson(value)).toThrow(CanonicalJsonError)
  })
})
