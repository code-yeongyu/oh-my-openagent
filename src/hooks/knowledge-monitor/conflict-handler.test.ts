import { describe, test, expect, beforeEach } from "bun:test"
import { ConflictHandler } from "./conflict-handler"
import type { KnowledgeCommit, Constraint } from "../../features/knowledge-repo/types"

function createTestCommit(overrides: Partial<KnowledgeCommit> = {}): KnowledgeCommit {
  return {
    id: "test-commit-1",
    type: "policy",
    title: "Test Policy",
    summary: "A test policy for unit tests",
    content: "Test content",
    layer: "project",
    severity: "warn",
    constraints: [],
    author: { id: "test", name: "Test Author" },
    createdAt: new Date().toISOString(),
    tags: [],
    triggerKeywords: [],
    ...overrides,
  }
}

function createTestConstraint(overrides: Partial<Constraint> = {}): Constraint {
  return {
    id: "constraint-1",
    operator: "must_not_use",
    target: "code",
    pattern: "console\\.log",
    severity: "warn",
    ...overrides,
  }
}

describe("ConflictHandler", () => {
  let handler: ConflictHandler

  beforeEach(() => {
    handler = new ConflictHandler("/tmp/test-project")
  })

  describe("setActiveKnowledge", () => {
    test("should store knowledge commits", () => {
      // #given
      const commits = [createTestCommit()]

      // #when
      handler.setActiveKnowledge(commits)

      // #then
      expect(handler.getActiveKnowledge()).toEqual(commits)
    })

    test("should replace existing knowledge", () => {
      // #given
      const commits1 = [createTestCommit({ id: "commit-1" })]
      const commits2 = [createTestCommit({ id: "commit-2" })]

      // #when
      handler.setActiveKnowledge(commits1)
      handler.setActiveKnowledge(commits2)

      // #then
      expect(handler.getActiveKnowledge()).toEqual(commits2)
    })
  })

  describe("checkFileEdit", () => {
    test("should detect must_not_use violation in new content", async () => {
      // #given
      const constraint = createTestConstraint({
        operator: "must_not_use",
        target: "code",
        pattern: "console\\.log",
        severity: "block",
        message: "Do not use console.log",
      })
      const commit = createTestCommit({ constraints: [constraint] })
      handler.setActiveKnowledge([commit])

      // #when
      const result = await handler.checkFileEdit(
        "/tmp/test-project/src/file.ts",
        "// some code",
        "console.log('debug')",
        { projectRoot: "/tmp/test-project", sessionId: "test", toolName: "edit", callId: "1" }
      )

      // #then
      expect(result).not.toBeNull()
      expect(result!.shouldBlock).toBe(true)
      expect(result!.violations).toHaveLength(1)
      expect(result!.violations[0].message).toBe("Do not use console.log")
    })

    test("should not flag violation if pattern already exists in old content", async () => {
      // #given
      const constraint = createTestConstraint({
        operator: "must_not_use",
        target: "code",
        pattern: "console\\.log",
      })
      const commit = createTestCommit({ constraints: [constraint] })
      handler.setActiveKnowledge([commit])

      // #when
      const result = await handler.checkFileEdit(
        "/tmp/test-project/src/file.ts",
        "console.log('old')",
        "console.log('still there')",
        { projectRoot: "/tmp/test-project", sessionId: "test", toolName: "edit", callId: "1" }
      )

      // #then - pattern was already there, no new violation
      expect(result).toBeNull()
    })

    test("should return null when no knowledge is active", async () => {
      // #given - no knowledge set

      // #when
      const result = await handler.checkFileEdit(
        "/tmp/test-project/src/file.ts",
        "old",
        "console.log('new')",
        { projectRoot: "/tmp/test-project", sessionId: "test", toolName: "edit", callId: "1" }
      )

      // #then
      expect(result).toBeNull()
    })
  })

  describe("checkBashCommand", () => {
    test("should detect forbidden command patterns", async () => {
      // #given
      const constraint = createTestConstraint({
        operator: "must_not_use",
        target: "code",
        pattern: "rm -rf",
        severity: "block",
        message: "Dangerous command forbidden",
      })
      const commit = createTestCommit({ constraints: [constraint] })
      handler.setActiveKnowledge([commit])

      // #when
      const result = await handler.checkBashCommand(
        "rm -rf /important/data",
        { projectRoot: "/tmp/test-project", sessionId: "test", toolName: "bash", callId: "1" }
      )

      // #then
      expect(result).not.toBeNull()
      expect(result!.shouldBlock).toBe(true)
      expect(result!.violations[0].message).toBe("Dangerous command forbidden")
    })

    test("should return null for allowed commands", async () => {
      // #given
      const constraint = createTestConstraint({
        operator: "must_not_use",
        target: "code",
        pattern: "rm -rf",
      })
      const commit = createTestCommit({ constraints: [constraint] })
      handler.setActiveKnowledge([commit])

      // #when
      const result = await handler.checkBashCommand(
        "ls -la",
        { projectRoot: "/tmp/test-project", sessionId: "test", toolName: "bash", callId: "1" }
      )

      // #then
      expect(result).toBeNull()
    })
  })

  describe("violation report", () => {
    test("should group violations by severity", async () => {
      // #given
      const blockConstraint = createTestConstraint({
        id: "c1",
        pattern: "BLOCK_PATTERN",
        severity: "block",
      })
      const warnConstraint = createTestConstraint({
        id: "c2",
        pattern: "WARN_PATTERN",
        severity: "warn",
      })
      const commit = createTestCommit({ constraints: [blockConstraint, warnConstraint] })
      handler.setActiveKnowledge([commit])

      // #when
      const result = await handler.checkFileEdit(
        "/tmp/test-project/src/file.ts",
        "",
        "BLOCK_PATTERN WARN_PATTERN",
        { projectRoot: "/tmp/test-project", sessionId: "test", toolName: "edit", callId: "1" }
      )

      // #then
      expect(result).not.toBeNull()
      expect(result!.violations).toHaveLength(2)
      expect(result!.highestSeverity).toBe("block")
      expect(result!.shouldBlock).toBe(true)
    })

    test("should include related knowledge in report", async () => {
      // #given
      const constraint = createTestConstraint({ pattern: "TEST_PATTERN" })
      const commit = createTestCommit({
        id: "related-commit",
        constraints: [constraint],
      })
      handler.setActiveKnowledge([commit])

      // #when
      const result = await handler.checkFileEdit(
        "/tmp/test-project/src/file.ts",
        "",
        "TEST_PATTERN",
        { projectRoot: "/tmp/test-project", sessionId: "test", toolName: "edit", callId: "1" }
      )

      // #then
      expect(result).not.toBeNull()
      expect(result!.relatedKnowledge).toHaveLength(1)
      expect(result!.relatedKnowledge[0].id).toBe("related-commit")
    })
  })
})
