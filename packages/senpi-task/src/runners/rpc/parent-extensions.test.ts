import { describe, expect, test } from "bun:test"

import { parseExtensionEntries } from "./parent-extensions"
import * as parentExtensions from "./parent-extensions"

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

describe("selectPackageExtensionPaths", () => {
  test("#given loaded package extensions and argv directories #when selecting #then only uncovered package paths survive in load order", () => {
    const select = Reflect.get(parentExtensions, "selectPackageExtensionPaths")
    expect(select).toBeFunction()
    const argv = ["/installed/omo/plugin", "/installed/provider/explicit.ts"]
    const loaded = [
      "<builtin:foo>",
      "<inline:bar>",
      "/installed/omo/plugin/extensions/omo.js",
      "/agent/extensions/local.ts",
      "/project/.senpi/extensions/local.ts",
      "/installed/provider/explicit.ts",
      "/installed/provider/extensions/zcode.ts",
      "/installed/provider-extra/extensions/not-a-package.ts",
      "/installed/commandcode/extensions/index.ts",
      "/installed/provider/extensions/zcode.ts",
      "/installed/omo/plugin-extra/provider.ts",
    ]
    expect(select(argv, loaded, ["/installed/omo", "/installed/provider/", "/installed/commandcode"])).toEqual([
      "/installed/provider/extensions/zcode.ts",
      "/installed/commandcode/extensions/index.ts",
      "/installed/omo/plugin-extra/provider.ts",
    ])
    expect(argv).toEqual(["/installed/omo/plugin", "/installed/provider/explicit.ts"])
  })

  test("#given absent loaded paths or installed roots #when selecting #then no package paths are forwarded", () => {
    const select = Reflect.get(parentExtensions, "selectPackageExtensionPaths")
    expect(select).toBeFunction()
    expect(select([], [], ["/installed/provider"])).toEqual([])
    expect(select([], ["/installed/provider/index.ts"], [])).toEqual([])
  })
})
