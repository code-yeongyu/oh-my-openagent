import { describe, expect, it } from "bun:test"
import { join } from "node:path"
import { resolveManagedPluginSandboxWorkspace } from "./plugin-sandbox"

describe("resolveManagedPluginSandboxWorkspace", () => {
  it("#given a bare legacy plugin entry #when resolving sandbox workspace #then it targets latest spec", () => {
    const result = resolveManagedPluginSandboxWorkspace("oh-my-opencode", "/cache/packages")

    expect(result).toEqual({
      packageName: "oh-my-opencode",
      spec: "oh-my-opencode@latest",
      workspaceDir: join("/cache/packages", "oh-my-opencode@latest"),
    })
  })

  it("#given a bare renamed plugin entry #when resolving sandbox workspace #then it preserves package name", () => {
    const result = resolveManagedPluginSandboxWorkspace("oh-my-openagent", "/cache/packages")

    expect(result).toEqual({
      packageName: "oh-my-openagent",
      spec: "oh-my-openagent@latest",
      workspaceDir: join("/cache/packages", "oh-my-openagent@latest"),
    })
  })

  it("#given an explicit safe dist tag #when resolving sandbox workspace #then it targets that sandbox", () => {
    const result = resolveManagedPluginSandboxWorkspace("oh-my-openagent@beta", "/cache/packages")

    expect(result).toEqual({
      packageName: "oh-my-openagent",
      spec: "oh-my-openagent@beta",
      workspaceDir: join("/cache/packages", "oh-my-openagent@beta"),
    })
  })

  for (const entry of [
    "oh-my-openagent@../evil",
    "oh-my-openagent@..\\evil",
    "oh-my-openagent@file:///tmp/evil",
    "oh-my-openagent@C:\\tmp\\evil",
    "oh-my-openagent@",
    "oh-my-openagent@bad\nversion",
  ]) {
    it(`#given unsafe entry ${JSON.stringify(entry)} #when resolving sandbox workspace #then it rejects it`, () => {
      const result = resolveManagedPluginSandboxWorkspace(entry, "/cache/packages")

      expect(result).toBeNull()
    })
  }
})
