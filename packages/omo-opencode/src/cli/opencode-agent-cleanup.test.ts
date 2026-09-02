import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  MANAGED_OPENCODE_AGENT_NAMES,
  removeManagedOpenCodeAgentDefinitions,
  type OpenCodeAgentCleanupOptions,
} from "./opencode-agent-cleanup"

function makeTempRoot(): string {
  return mkdtempSync(join(tmpdir(), "omo-opencode-agent-cleanup-"))
}

function writeAgentFile(agentDir: string, fileName: string, content = "---\nmode: primary\n---\n"): void {
  mkdirSync(agentDir, { recursive: true })
  writeFileSync(join(agentDir, fileName), content)
}

function runCleanup(options: OpenCodeAgentCleanupOptions) {
  return removeManagedOpenCodeAgentDefinitions(options)
}

describe("#removeManagedOpenCodeAgentDefinitions", () => {
  describe("#given a global config dir with leftover omo agent definitions", () => {
    test("#then removes every managed omo agent file and keeps user-owned agents", () => {
      const configDir = makeTempRoot()
      const agentDir = join(configDir, "agent")
      writeAgentFile(agentDir, "sisyphus.md")
      writeAgentFile(agentDir, "hephaestus.md")
      writeAgentFile(agentDir, "prometheus.md")
      writeAgentFile(agentDir, "my-own-agent.md")

      const result = runCleanup({ configDir })

      expect(result.removedPaths.sort()).toEqual(
        [join(agentDir, "hephaestus.md"), join(agentDir, "prometheus.md"), join(agentDir, "sisyphus.md")].sort(),
      )
      expect(existsSync(join(agentDir, "my-own-agent.md"))).toBe(true)
    })
  })

  describe("#given a project .opencode agent dir with leftovers", () => {
    test("#then removes managed definitions from the project scope too", () => {
      const project = makeTempRoot()
      const projectAgentDir = join(project, ".opencode", "agent")
      writeAgentFile(projectAgentDir, "atlas.md")
      writeAgentFile(projectAgentDir, "oracle.md")

      const result = runCleanup({ configDir: makeTempRoot(), project })

      expect(result.removedPaths.sort()).toEqual(
        [join(projectAgentDir, "atlas.md"), join(projectAgentDir, "oracle.md")].sort(),
      )
    })
  })

  describe("#given files that are not managed omo agent definitions", () => {
    test("#then near-miss names and non-markdown files are left untouched", () => {
      const configDir = makeTempRoot()
      const agentDir = join(configDir, "agent")
      writeAgentFile(agentDir, "sisyphus-pro.md")
      writeAgentFile(agentDir, "my-sisyphus.md")
      writeAgentFile(agentDir, "sisyphus.txt")
      writeAgentFile(agentDir, "prometheus.md.bak")

      const result = runCleanup({ configDir })

      expect(result.removedPaths).toEqual([])
      expect(existsSync(join(agentDir, "sisyphus-pro.md"))).toBe(true)
      expect(existsSync(join(agentDir, "my-sisyphus.md"))).toBe(true)
      expect(existsSync(join(agentDir, "sisyphus.txt"))).toBe(true)
      expect(existsSync(join(agentDir, "prometheus.md.bak"))).toBe(true)
    })
  })

  describe("#given legacy plural agents directory", () => {
    test("#then managed definitions are removed there as well", () => {
      const configDir = makeTempRoot()
      const agentsDir = join(configDir, "agents")
      writeAgentFile(agentsDir, "librarian.md")

      const result = runCleanup({ configDir })

      expect(result.removedPaths).toEqual([join(agentsDir, "librarian.md")])
    })
  })

  describe("#given directories that do not exist", () => {
    test("#then cleanup completes without throwing and reports nothing removed", () => {
      const configDir = join(makeTempRoot(), "missing")
      const project = join(makeTempRoot(), "also-missing")

      const result = runCleanup({ configDir, project })

      expect(result.removedPaths).toEqual([])
      expect(result.scannedDirs).toEqual([])
    })
  })

  describe("#given the managed name registry", () => {
    test("#then it covers the three agents reported in issue #6322", () => {
      expect(MANAGED_OPENCODE_AGENT_NAMES).toContain("sisyphus")
      expect(MANAGED_OPENCODE_AGENT_NAMES).toContain("hephaestus")
      expect(MANAGED_OPENCODE_AGENT_NAMES).toContain("prometheus")
    })
  })
})
