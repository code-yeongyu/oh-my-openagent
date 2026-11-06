/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { parseGitStatusPorcelainZ } from "./parse-status-porcelain-z"

describe("parseGitStatusPorcelainZ", () => {
  test("#given NUL-terminated records #when parsing #then maps paths to statuses", () => {
    const output = [" M src/a.ts", "A  src/b.ts", "?? src/c.ts", "D  src/d.ts", ""].join("\0")

    const map = parseGitStatusPorcelainZ(output)

    expect(map.get("src/a.ts")).toBe("modified")
    expect(map.get("src/b.ts")).toBe("added")
    expect(map.get("src/c.ts")).toBe("added")
    expect(map.get("src/d.ts")).toBe("deleted")
  })

  test("#given a rename record #when parsing #then maps the destination as modified and consumes the source field", () => {
    const output = ["A  src/a.ts", "R  src/new.ts", "ab/src/a.ts", " M src/b.ts", ""].join("\0")

    const map = parseGitStatusPorcelainZ(output)

    expect(map).toEqual(
      new Map([
        ["src/a.ts", "added"],
        ["src/new.ts", "modified"],
        ["src/b.ts", "modified"],
      ]),
    )
  })

  test("#given a copy record #when parsing #then maps the destination as added and consumes the source field", () => {
    const output = ["D  src/c.ts", "C  src/copy.ts", "ab/src/c.ts", "?? src/d.ts", ""].join("\0")

    const map = parseGitStatusPorcelainZ(output)

    expect(map).toEqual(
      new Map([
        ["src/c.ts", "deleted"],
        ["src/copy.ts", "added"],
        ["src/d.ts", "added"],
      ]),
    )
  })

  test("#given R or C in either status column #when parsing #then renames are modified, copies are added, and each source field is consumed", () => {
    const output = [
      "RM dst/rm.ts", "xx/rm-src.ts",
      " R dst/wr.ts", "xx/wr-src.ts",
      "CM dst/cm.ts", "xx/cm-src.ts",
      " C dst/wc.ts", "xx/wc-src.ts",
      " M dst/after.ts",
      "",
    ].join("\0")

    const map = parseGitStatusPorcelainZ(output)

    expect(map).toEqual(
      new Map([
        ["dst/rm.ts", "modified"],
        ["dst/wr.ts", "modified"],
        ["dst/cm.ts", "added"],
        ["dst/wc.ts", "added"],
        ["dst/after.ts", "modified"],
      ]),
    )
  })

  test("#given paths with spaces and arrows #when parsing #then keeps them unquoted and intact", () => {
    const output = ["?? with space.ts", "R  a -> b.ts", "a.ts", ""].join("\0")

    const map = parseGitStatusPorcelainZ(output)

    expect(map).toEqual(
      new Map([
        ["with space.ts", "added"],
        ["a -> b.ts", "modified"],
      ]),
    )
  })

  test("#given empty output #when parsing #then returns an empty map", () => {
    expect(parseGitStatusPorcelainZ("").size).toBe(0)
  })
})
