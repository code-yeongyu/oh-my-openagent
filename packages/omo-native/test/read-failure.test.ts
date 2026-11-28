// #10983: the describer's branches that setup-read-failure.test.ts's real scans do not reach. Each
// error carries a synthetic token in its message; the description must keep only the fixed kind.
import { describe, expect, test } from "bun:test"
import { describeReadFailure } from "../bin/lib/read-failure.js"

const TOKEN = "sk-test-SYNTHETIC-describe"

function withCode(code: string, path?: string): Error {
  return Object.assign(new Error(`${code}: open '${TOKEN}'`), path === undefined ? { code } : { code, path })
}

describe("describeReadFailure", () => {
  test.each([
    [
      "a V8 parse error with line and column",
      new SyntaxError(`Bad "${TOKEN}" in JSON at position 7 (line 1 column 8)`),
      "not valid JSON at line 1 column 8",
    ],
    [
      "a V8 parse error with a position only",
      new SyntaxError(`Bad "${TOKEN}" in JSON at position 12`),
      "not valid JSON at position 12",
    ],
    [
      "a parse error quoting the source",
      new SyntaxError(`Unexpected token 's', "${TOKEN}" is not valid JSON`),
      "not valid JSON",
    ],
    ["a filesystem error", withCode("EACCES"), "EACCES"],
    ["a filesystem error with its path", withCode("EISDIR", "/tmp/omo.jsonc"), "EISDIR (/tmp/omo.jsonc)"],
    ["a non-filesystem code", withCode("ERR_SOMETHING"), "an unexpected error"],
    ["an arbitrary error", new Error(`failed near ${TOKEN}`), "an unexpected error"],
    ["a thrown non-error", TOKEN, "an unexpected error"],
  ])("#given %s #then only the fixed kind is described", (_name, error, expected) => {
    expect(describeReadFailure(error)).toBe(expected)
  })
})
