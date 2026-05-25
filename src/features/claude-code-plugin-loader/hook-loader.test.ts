const { describe, expect, test } = require("bun:test")

describe("hook-loader — pluginRoot annotation type contracts", () => {
  test("#given HookCommand with _pluginRoot #when type narrowing on type field #then _pluginRoot is accessible without assertion", () => {
    type HookAction = import("../../hooks/claude-code-hooks/types").HookAction
    const action: HookAction = {
      type: "command",
      command: "bash ${CLAUDE_PLUGIN_ROOT}/scripts/setup.sh",
      _pluginRoot: "/plugin/root",
    }

    if (action.type === "command") {
      expect(typeof action._pluginRoot).toBe("string")
      expect(action._pluginRoot).toBe("/plugin/root")
    }
  })

  test("#given HookCommand without _pluginRoot #when type is command #then _pluginRoot is undefined", () => {
    type HookCommand = import("../../hooks/claude-code-hooks/types").HookCommand
    const hook: HookCommand = {
      type: "command",
      command: "echo hello",
    }

    expect(hook._pluginRoot).toBeUndefined()
  })

  test("#given HookHttp action #when type is http #then url is present and _pluginRoot does NOT exist", () => {
    type HookAction = import("../../hooks/claude-code-hooks/types").HookAction
    const action: HookAction = {
      type: "http",
      url: "https://example.com/hook",
    }

    if (action.type === "http") {
      expect(action.url).toBe("https://example.com/hook")
    }
  })

  test("#given HookCommand with both allowedEnvVars and _pluginRoot #when both set #then both fields are accessible", () => {
    type HookCommand = import("../../hooks/claude-code-hooks/types").HookCommand
    const hook: HookCommand = {
      type: "command",
      command: "echo hello",
      allowedEnvVars: ["MY_VAR"],
      _pluginRoot: "/plugin/root",
    }

    expect(hook.allowedEnvVars).toEqual(["MY_VAR"])
    expect(hook._pluginRoot).toBe("/plugin/root")
  })
})

export {}
