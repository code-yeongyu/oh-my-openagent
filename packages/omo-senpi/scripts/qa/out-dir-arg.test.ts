import { describe, expect, test } from "bun:test"

import { resolveOutDirArg } from "./out-dir-arg"

const FALLBACK = "/tmp/fallback-out"

describe("resolveOutDirArg", () => {
  test("#given no argument #when resolved #then the fallback directory is used", () => {
    expect(resolveOutDirArg([], FALLBACK)).toBe(FALLBACK)
  })

  test("#given a bare directory #when resolved #then that directory is used", () => {
    expect(resolveOutDirArg(["/tmp/qa-out"], FALLBACK)).toBe("/tmp/qa-out")
  })

  test("#given the --out-dir flag with a value #when resolved #then the value is used, not the flag name", () => {
    expect(resolveOutDirArg(["--out-dir", "/tmp/qa-out"], FALLBACK)).toBe("/tmp/qa-out")
  })

  test("#given the --out-dir flag without a value #when resolved #then it is refused", () => {
    expect(() => resolveOutDirArg(["--out-dir"], FALLBACK)).toThrow(/--out-dir requires a directory/)
  })

  test("#given the --out-dir flag followed by another flag #when resolved #then it is refused", () => {
    expect(() => resolveOutDirArg(["--out-dir", "--verbose"], FALLBACK)).toThrow(/--out-dir requires a directory/)
  })

  test("#given an unknown flag #when resolved #then it is refused instead of becoming a directory name", () => {
    expect(() => resolveOutDirArg(["--report-dir", "/tmp/qa-out"], FALLBACK)).toThrow(/unknown flag --report-dir/)
  })

  test("#given more than one directory #when resolved #then the extra arguments are refused", () => {
    expect(() => resolveOutDirArg(["/tmp/qa-out", "/tmp/second"], FALLBACK)).toThrow(/unexpected extra argument/)
  })
})
