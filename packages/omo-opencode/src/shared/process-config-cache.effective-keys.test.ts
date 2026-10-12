/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  NO_PROJECT_SOURCES_FINGERPRINT,
  digestEnvironment,
  fingerprintAncestorSources,
  fingerprintClaudeMcpSources,
  fingerprintClaudePluginRoots,
  fingerprintFileReferences,
  fingerprintGlobalSources,
  fingerprintProjectSources,
  fingerprintTree,
  getProcessAgentSnapshotMap,
  rememberAgentSnapshot,
  resetProcessConfigCacheForTests,
  stableDigest,
} from "./process-config-cache"

// Local fix 31 (cross-review A M3/M4/M7): cache keys must cover every input.

describe("process-config-cache effective keys", () => {
  let tempRoot: string
  const savedClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR

  beforeEach(() => {
    resetProcessConfigCacheForTests()
    delete process.env.OMO_DISABLE_PROCESS_CONFIG_CACHE
    tempRoot = mkdtempSync(join(tmpdir(), "omo-keys-"))
  })

  afterEach(() => {
    if (savedClaudeConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = savedClaudeConfigDir
    rmSync(tempRoot, { recursive: true, force: true })
  })

  test("a tree fingerprint follows nested additions, in-place edits and removals", () => {
    const root = join(tempRoot, "tree")
    mkdirSync(join(root, "a", "b"), { recursive: true })
    writeFileSync(join(root, "a", "b", "one.md"), "one")
    const initial = fingerprintTree(root)
    expect(initial).toBe(fingerprintTree(root))

    writeFileSync(join(root, "a", "b", "two.md"), "two")
    const added = fingerprintTree(root)
    expect(added).not.toBe(initial)

    writeFileSync(join(root, "a", "b", "one.md"), "one, edited in place")
    const edited = fingerprintTree(root)
    expect(edited).not.toBe(added)

    rmSync(join(root, "a", "b", "two.md"))
    expect(fingerprintTree(root)).not.toBe(edited)
    expect(fingerprintTree(join(root, "missing"))).toBe("absent")
  })

  test("a tree with too many entries is reported as not fingerprintable", () => {
    const root = join(tempRoot, "huge")
    mkdirSync(root)
    for (let index = 0; index < 3001; index++) writeFileSync(join(root, `f${index}`), "")
    expect(fingerprintTree(root)).toBeUndefined()
    mkdirSync(join(tempRoot, "project", ".claude"), { recursive: true })
    for (let index = 0; index < 3001; index++) writeFileSync(join(tempRoot, "project", ".claude", `f${index}`), "")
    expect(fingerprintProjectSources(join(tempRoot, "project"))).toBeUndefined()
  })

  test("a memo serves repeated walks within one pass", () => {
    const root = join(tempRoot, "memo")
    mkdirSync(root)
    const memo = new Map<string, string | undefined>()
    const first = fingerprintTree(root, memo)
    writeFileSync(join(root, "late.md"), "late")
    expect(fingerprintTree(root, memo)).toBe(first)
    expect(fingerprintTree(root)).not.toBe(first)
  })

  test("adding a file below an existing project source directory changes the project fingerprint", () => {
    const folder = join(tempRoot, "project")
    mkdirSync(join(folder, ".claude", "agents"), { recursive: true })
    writeFileSync(join(folder, ".claude", "agents", "helper.md"), "agent")
    const before = fingerprintProjectSources(folder)

    // .claude and its listing are unchanged; only the nested directory gains an entry.
    writeFileSync(join(folder, ".claude", "agents", "new.md"), "another agent")
    const added = fingerprintProjectSources(folder)
    expect(added).not.toBe(before)

    writeFileSync(join(folder, ".claude", "agents", "helper.md"), "agent with a longer prompt")
    expect(fingerprintProjectSources(folder)).not.toBe(added)
  })

  test("sibling folders share ancestor sources; folders under different ancestors do not", () => {
    const parentA = join(tempRoot, "parent-a")
    const parentB = join(tempRoot, "parent-b")
    for (const parent of [parentA, parentB]) {
      mkdirSync(join(parent, "chat-1"), { recursive: true })
      mkdirSync(join(parent, "chat-2"), { recursive: true })
    }
    mkdirSync(join(parentA, ".claude", "skills", "only-a"), { recursive: true })
    writeFileSync(join(parentA, ".claude", "skills", "only-a", "SKILL.md"), "---\nname: only-a\n---\n")

    for (const folder of [join(parentA, "chat-1"), join(parentA, "chat-2"), join(parentB, "chat-1")]) {
      expect(fingerprintProjectSources(folder)).toBe(NO_PROJECT_SOURCES_FINGERPRINT)
    }
    const siblingOne = fingerprintAncestorSources(join(parentA, "chat-1"))
    expect(siblingOne).toBe(fingerprintAncestorSources(join(parentA, "chat-2")))
    expect(siblingOne).not.toBe(fingerprintAncestorSources(join(parentB, "chat-1")))

    writeFileSync(join(parentA, ".claude", "skills", "only-a", "SKILL.md"), "---\nname: only-a\ndescription: edited\n---\n")
    expect(fingerprintAncestorSources(join(parentA, "chat-1"))).not.toBe(siblingOne)
  })

  test("user-level skill, command and agent changes change the global fingerprint", () => {
    const claude = join(tempRoot, "claude-home")
    mkdirSync(claude)
    process.env.CLAUDE_CONFIG_DIR = claude
    const empty = fingerprintGlobalSources()

    mkdirSync(join(claude, "skills", "fresh"), { recursive: true })
    writeFileSync(join(claude, "skills", "fresh", "SKILL.md"), "---\nname: fresh\n---\n")
    const withSkill = fingerprintGlobalSources()
    expect(withSkill).not.toBe(empty)

    writeFileSync(join(claude, "skills", "fresh", "SKILL.md"), "---\nname: fresh\ndescription: edited\n---\n")
    const editedSkill = fingerprintGlobalSources()
    expect(editedSkill).not.toBe(withSkill)

    mkdirSync(join(claude, "commands"))
    writeFileSync(join(claude, "commands", "ship.md"), "ship it")
    const withCommand = fingerprintGlobalSources()
    expect(withCommand).not.toBe(editedSkill)

    mkdirSync(join(claude, "agents"))
    writeFileSync(join(claude, "agents", "reviewer.md"), "review")
    expect(fingerprintGlobalSources()).not.toBe(withCommand)
  })

  test("a plugin installation change changes the plugin-root fingerprint", () => {
    const claude = join(tempRoot, "claude-plugins")
    mkdirSync(join(claude, "plugins"), { recursive: true })
    process.env.CLAUDE_CONFIG_DIR = claude
    const before = fingerprintClaudePluginRoots()
    writeFileSync(join(claude, "plugins", "installed_plugins.json"), JSON.stringify({ plugins: { "a@b": [] } }))
    expect(fingerprintClaudePluginRoots()).not.toBe(before)
  })

  test("the MCP fingerprint covers all four loader files and the loader context", () => {
    const context = {
      cwd: join(tempRoot, "cwd"),
      homeDir: join(tempRoot, "home"),
      claudeConfigDir: join(tempRoot, "home", ".claude"),
    }
    mkdirSync(join(context.cwd, ".claude"), { recursive: true })
    mkdirSync(context.claudeConfigDir, { recursive: true })
    let last = fingerprintClaudeMcpSources(context)
    for (const file of [
      join(context.homeDir, ".claude.json"),
      join(context.claudeConfigDir, ".mcp.json"),
      join(context.cwd, ".mcp.json"),
      join(context.cwd, ".claude", ".mcp.json"),
    ]) {
      writeFileSync(file, JSON.stringify({ mcpServers: {} }))
      const next = fingerprintClaudeMcpSources(context)
      expect(next).not.toBe(last)
      last = next
    }
    expect(fingerprintClaudeMcpSources({ ...context, cwd: join(tempRoot, "other-cwd") })).not.toBe(last)
  })

  test("digests are stable under key order and sensitive to values", () => {
    expect(stableDigest({ a: 1, b: { c: [1, 2], d: "x" } })).toBe(stableDigest({ b: { d: "x", c: [1, 2] }, a: 1 }))
    expect(stableDigest({ disabled_agents: [] })).not.toBe(stableDigest({ disabled_agents: ["oracle"] }))
    expect(digestEnvironment({ A: "1", B: "2" })).toBe(digestEnvironment({ B: "2", A: "1" }))
    expect(digestEnvironment({ A: "1" })).not.toBe(digestEnvironment({ A: "2" }))
  })

  test("file:// prompt references are found and follow their target", () => {
    const folder = join(tempRoot, "prompts")
    mkdirSync(folder)
    const config = { agents: { oracle: { prompt_append: "file://./extra.md" } }, other: ["plain", "file://~/global.md"] }
    const missing = fingerprintFileReferences(config, folder)
    expect(missing.count).toBe(2)
    writeFileSync(join(folder, "extra.md"), "extra")
    expect(fingerprintFileReferences(config, folder).signature).not.toBe(missing.signature)
    expect(fingerprintFileReferences({ agents: {} }, folder)).toEqual({ count: 0, signature: "" })
  })

  test("the process snapshot map is bounded", () => {
    const map = getProcessAgentSnapshotMap()
    for (let index = 0; index < 80; index++) rememberAgentSnapshot(map, `key-${index}`, index)
    expect(map.size).toBe(64)
    expect(map.has("key-0")).toBe(false)
    expect(map.get("key-79")).toBe(79)
  })
})
