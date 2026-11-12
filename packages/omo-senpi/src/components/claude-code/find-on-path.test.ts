/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { chmodSync, realpathSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { testTempDir } from "../../../test-support/temp-dir"
import { findOnPath } from "./find-on-path"

describe.skipIf(process.platform === "win32")("findOnPath relative PATH entries", () => {
  function plantedTool(): { readonly dir: string; readonly name: string } {
    const dir = realpathSync(testTempDir("omo-find-on-path-"))
    const name = "omo-find-on-path-probe"
    writeFileSync(join(dir, name), "#!/bin/sh\n")
    chmodSync(join(dir, name), 0o755)
    return { dir, name }
  }

  function inside<T>(dir: string, body: () => T): T {
    const previous = process.cwd()
    process.chdir(dir)
    try {
      return body()
    } finally {
      process.chdir(previous)
    }
  }

  test("#given a tool only reachable through a relative PATH entry #when it is looked up with absoluteOnly #then the relative entry is skipped and an absolute one is still used", () => {
    const { dir, name } = plantedTool()

    expect(inside(dir, () => findOnPath(name, { PATH: "." }, "linux", { absoluteOnly: true }))).toBeNull()
    expect(inside(dir, () => findOnPath(name, { PATH: `.:${dir}` }, "linux", { absoluteOnly: true }))).toBe(
      join(dir, name),
    )
  })

  test("#given a tool only reachable through a relative PATH entry #when it is looked up without options #then it is found as before", () => {
    const { dir, name } = plantedTool()

    expect(inside(dir, () => findOnPath(name, { PATH: "." }, "linux"))).toBe(name)
  })
})
