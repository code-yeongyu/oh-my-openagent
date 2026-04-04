import { describe, expect, it } from "bun:test"
import { findPluginEntry } from "./system-plugin"

describe("findPluginEntry", () => {
  it("treats installer-managed node_modules file entries as non-local installs", () => {
    const result = findPluginEntry([
      "file:///tmp/opencode/node_modules/oh-my-opencode/dist/index.js",
    ])

    expect(result).toEqual({
      entry: "file:///tmp/opencode/node_modules/oh-my-opencode/dist/index.js",
      isLocalDev: false,
    })
  })

  it("treats repo file entries as local-dev installs", () => {
    const result = findPluginEntry([
      "file:///workspaces/oh-my-openagent/dist/index.js",
    ])

    expect(result).toEqual({
      entry: "file:///workspaces/oh-my-openagent/dist/index.js",
      isLocalDev: true,
    })
  })
})
