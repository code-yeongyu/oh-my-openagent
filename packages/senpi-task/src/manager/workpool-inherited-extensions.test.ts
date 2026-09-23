import { describe, expect, test } from "bun:test"

import { resolveInheritedExtensionList } from "../runners/rpc/parent-extensions"
import { workpoolProcessLaunch } from "./workpool-process-launch"

describe("workpool worker inherited extensions", () => {
  test("#given a session resolver that knows package providers #when a process worker launches #then the worker inherits them", async () => {
    // given: the worker used to read argv directly, so a settings-package provider that an ordinary
    // child received was missing from every workpool worker (#8492).
    const launch = await workpoolProcessLaunch("/state", "st_worker", () => [
      "/installed/omo/plugin",
      "/installed/provider/extensions/zcode.ts",
    ])

    // then
    expect(launch.extensions).toContain("/installed/provider/extensions/zcode.ts")
  })

  test("#given the same resolver #when a process worker launches #then the parent scheduler extensions are still excluded", async () => {
    // given: a worker must never load the parent's task engine, whatever the inherited list carries.
    const launch = await workpoolProcessLaunch("/state", "st_worker", () => [
      "/installed/omo/plugin/extensions/omo.js",
      "/installed/omo/plugin/extensions/omo-task.js",
      "/installed/provider/extensions/zcode.ts",
    ])

    // then
    expect(launch.extensions).not.toContain("/installed/omo/plugin/extensions/omo.js")
    expect(launch.extensions).not.toContain("/installed/omo/plugin/extensions/omo-task.js")
    expect(launch.extensions).toContain("/installed/provider/extensions/zcode.ts")
  })

  test("#given no resolver at all #when the inherited list is resolved #then it degrades to the parent argv entries", async () => {
    // given: a wiring with no package manager can only know argv, and that must keep working.
    const originalArgv = process.argv
    process.argv = ["bun", "omo", "-e", "/installed/omo/plugin"]
    try {
      expect(await resolveInheritedExtensionList(undefined)).toEqual(["/installed/omo/plugin"])
    } finally {
      process.argv = originalArgv
    }
  })

  test("#given a resolver that reports a different set on each call #when resolved twice #then each call sees the current set", async () => {
    // given: freshness is the contract - a package installed mid-session must reach the next child,
    // so nothing here may memoize the resolved list.
    let roots = ["/first.ts"]
    const resolver = () => roots
    expect(await resolveInheritedExtensionList(resolver)).toEqual(["/first.ts"])
    roots = ["/second.ts"]
    expect(await resolveInheritedExtensionList(resolver)).toEqual(["/second.ts"])
  })
})
