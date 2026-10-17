/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import type { GitFileStatus } from "./types"
import { parseGitDiffNumstatZ } from "./parse-diff-numstat-z"

describe("parseGitDiffNumstatZ", () => {
  test("#given NUL-terminated entries #when parsing #then returns typed stats with statuses from the map", () => {
    const statusMap = new Map<string, GitFileStatus>([["src/b.ts", "added"]])
    const output = ["1\t2\tsrc/a.ts", "3\t0\tsrc/b.ts", ""].join("\0")

    expect(parseGitDiffNumstatZ(output, statusMap)).toEqual([
      { path: "src/a.ts", added: 1, removed: 2, status: "modified" },
      { path: "src/b.ts", added: 3, removed: 0, status: "added" },
    ])
  })

  test("#given a binary entry #when parsing #then counts are zero", () => {
    const output = "-\t-\tbin.dat\0"

    expect(parseGitDiffNumstatZ(output, new Map())).toEqual([
      { path: "bin.dat", added: 0, removed: 0, status: "modified" },
    ])
  })

  test("#given a rename entry #when parsing #then reports one stat under the destination with the real counts", () => {
    const statusMap = new Map<string, GitFileStatus>([["src/new.ts", "modified"]])
    const output = ["2\t1\t\0src/old.ts\0src/new.ts\0", "4\t0\tsrc/other.ts\0"].join("")

    expect(parseGitDiffNumstatZ(output, statusMap)).toEqual([
      { path: "src/new.ts", added: 2, removed: 1, status: "modified" },
      { path: "src/other.ts", added: 4, removed: 0, status: "modified" },
    ])
  })

  test("#given a binary rename entry #when parsing #then reports one stat under the destination with zero counts", () => {
    const statusMap = new Map<string, GitFileStatus>([["new.bin", "modified"]])
    const output = ["-\t-\t\0old.bin\0new.bin\0", "1\t0\tnext.ts\0"].join("")

    expect(parseGitDiffNumstatZ(output, statusMap)).toEqual([
      { path: "new.bin", added: 0, removed: 0, status: "modified" },
      { path: "next.ts", added: 1, removed: 0, status: "modified" },
    ])
  })

  test("#given paths with tabs and spaces #when parsing #then keeps them intact, including in a rename", () => {
    const output = ["1\t0\ttab\tname.ts\0", "0\t0\t\0old\tname.ts\0new\tname.ts\0", "2\t0\twith space.ts\0"].join("")

    expect(parseGitDiffNumstatZ(output, new Map())).toEqual([
      { path: "tab\tname.ts", added: 1, removed: 0, status: "modified" },
      { path: "new\tname.ts", added: 0, removed: 0, status: "modified" },
      { path: "with space.ts", added: 2, removed: 0, status: "modified" },
    ])
  })

  test("#given empty output #when parsing #then returns no stats", () => {
    expect(parseGitDiffNumstatZ("", new Map())).toEqual([])
  })

  test("#given a rename entry cut off before the destination #when parsing #then skips it", () => {
    expect(parseGitDiffNumstatZ("1\t1\t\0src/old.ts", new Map())).toEqual([])
  })
})
