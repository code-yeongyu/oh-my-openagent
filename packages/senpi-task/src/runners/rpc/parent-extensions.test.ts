import { describe, expect, test } from "bun:test"

import { parseExtensionEntries } from "./parent-extensions"

describe("parseExtensionEntries", () => {
  test("#given an argv with -e and --extension pairs #when parsing #then every entry value is collected in order", () => {
    // given
    const argv = ["node", "senpi", "-e", "/tmp/a.ts", "--mode", "json", "--extension", "/tmp/b.ts", "-p", "go"]
    // when
    const entries = parseExtensionEntries(argv)
    // then
    expect(entries).toEqual(["/tmp/a.ts", "/tmp/b.ts"])
  })

  test("#given an argv with no extension flags #when parsing #then the result is empty", () => {
    // when
    const entries = parseExtensionEntries(["node", "senpi", "--mode", "rpc"])
    // then
    expect(entries).toEqual([])
  })

  test("#given a dangling -e with no value #when parsing #then it is ignored rather than pushing undefined", () => {
    // when
    const entries = parseExtensionEntries(["node", "senpi", "-e"])
    // then
    expect(entries).toEqual([])
  })
})
