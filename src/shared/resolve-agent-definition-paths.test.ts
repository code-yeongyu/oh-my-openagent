import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import { tmpdir } from "os"

import { resolveAgentDefinitionPaths } from "./resolve-agent-definition-paths"

describe("resolveAgentDefinitionPaths", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "resolve-agent-def-paths-"))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe("#given relative paths", () => {
    test("#then they are resolved against baseDir", () => {
      const result = resolveAgentDefinitionPaths(
        ["agents/my-agent.md"],
        tempDir,
        null,
      )

      expect(result).toEqual([join(tempDir, "agents/my-agent.md")])
    })
  })

  describe("#given absolute paths", () => {
    test("#then they are returned as-is", () => {
      const absPath = join(tempDir, "absolute-agent.md")

      const result = resolveAgentDefinitionPaths(
        [absPath],
        "/some/other/base",
        null,
      )

      expect(result).toEqual([absPath])
    })
  })

  describe("#given tilde-prefixed paths", () => {
    test("#then ~ is expanded to homedir", () => {
      const result = resolveAgentDefinitionPaths(
        ["~/agents/test.md"],
        tempDir,
        null,
      )

      expect(result).toEqual([join(homedir(), "agents/test.md")])
    })
  })

  describe("#given containmentDir is set", () => {
    test("#then paths outside the boundary are rejected", () => {
      const projectDir = join(tempDir, "project")
      mkdirSync(projectDir, { recursive: true })

      const result = resolveAgentDefinitionPaths(
        ["/etc/passwd"],
        projectDir,
        projectDir,
      )

      expect(result).toEqual([])
    })

    test("#then paths inside the boundary are allowed", () => {
      const projectDir = join(tempDir, "project")
      const agentsDir = join(projectDir, "agents")
      mkdirSync(agentsDir, { recursive: true })
      writeFileSync(join(agentsDir, "a.md"), "test", "utf-8")

      const result = resolveAgentDefinitionPaths(
        ["agents/a.md"],
        projectDir,
        projectDir,
      )

      expect(result).toEqual([join(projectDir, "agents/a.md")])
    })
  })

  describe("#given containmentDir is null", () => {
    test("#then no boundary check is applied", () => {
      const result = resolveAgentDefinitionPaths(
        ["/some/outside/path/agent.md"],
        tempDir,
        null,
      )

      expect(result).toEqual(["/some/outside/path/agent.md"])
    })
  })

  describe("#given an empty paths array", () => {
    test("#then an empty array is returned", () => {
      const result = resolveAgentDefinitionPaths([], tempDir, null)

      expect(result).toEqual([])
    })
  })

  describe("#given mixed valid and invalid paths", () => {
    test("#then only valid paths within the boundary are returned", () => {
      const projectDir = join(tempDir, "project")
      mkdirSync(projectDir, { recursive: true })

      const result = resolveAgentDefinitionPaths(
        ["./valid.md", "/outside/boundary.md"],
        projectDir,
        projectDir,
      )

      expect(result).toEqual([join(projectDir, "valid.md")])
    })
  })
})
