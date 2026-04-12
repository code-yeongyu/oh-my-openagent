import { describe, expect, test } from "bun:test"

import { resolvePluginPath, resolvePluginPaths } from "./plugin-path-resolver"

describe("resolvePluginPath", () => {
  test("#given a plugin root placeholder #when resolving the path #then it replaces the placeholder", () => {
    // given
    const path = "${CLAUDE_PLUGIN_ROOT}/dist/index.js"

    // when
    const result = resolvePluginPath(path, "/tmp/plugin-root")

    // then
    expect(result).toBe("/tmp/plugin-root/dist/index.js")
  })
})

describe("resolvePluginPaths", () => {
  test("#given a nested object #when resolving paths #then it rewrites every nested string path", () => {
    // given
    const value = {
      command: "node",
      args: ["${CLAUDE_PLUGIN_ROOT}/server.js"],
      nested: {
        config: "${CLAUDE_PLUGIN_ROOT}/config.json",
      },
    }

    // when
    const result = resolvePluginPaths(value, "/tmp/plugin-root")

    // then
    expect(result).toEqual({
      command: "node",
      args: ["/tmp/plugin-root/server.js"],
      nested: {
        config: "/tmp/plugin-root/config.json",
      },
    })
  })

  test("#given nullish input #when resolving paths #then it returns the same nullish value", () => {
    // given
    const nullValue = null
    const undefinedValue = undefined

    // when
    const nullResult = resolvePluginPaths(nullValue, "/tmp/plugin-root")
    const undefinedResult = resolvePluginPaths(undefinedValue, "/tmp/plugin-root")

    // then
    expect(nullResult).toBeNull()
    expect(undefinedResult).toBeUndefined()
  })
})
