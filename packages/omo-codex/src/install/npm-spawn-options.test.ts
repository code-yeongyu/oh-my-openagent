import { spawnSync } from "node:child_process"

import { describe, expect, it } from "bun:test"

import { npmSpawnOptions } from "./npm-spawn-options"

function spawnNpmUnderNode(options: { readonly shell?: true }): number | null {
  const source = [
    'const { spawnSync } = require("node:child_process");',
    `const result = spawnSync("npm", ["--version"], ${JSON.stringify(options)});`,
    'process.exit(result.error ? 3 : result.status);',
  ].join("")
  return spawnSync("node", ["-e", source], { stdio: "ignore" }).status
}

describe("npm spawn options", () => {
  it("#given node spawning npm #when the installer's options are applied #then npm runs where a bare spawn would not", () => {
    // given
    const bare = spawnNpmUnderNode({})

    // when
    const withOptions = spawnNpmUnderNode(npmSpawnOptions())

    // then
    expect(withOptions).toBe(0)
    if (process.platform === "win32") {
      expect(bare).toBe(3)
    }
  })

  it("#given a non-Windows platform #when the options are built #then no shell is requested", () => {
    // given / when / then
    expect(npmSpawnOptions("darwin")).toEqual({})
    expect(npmSpawnOptions("linux")).toEqual({})
  })

  it("#given Windows #when the options are built #then a shell is requested", () => {
    // given / when / then
    expect(npmSpawnOptions("win32")).toEqual({ shell: true })
  })
})
