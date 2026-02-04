import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { createGitOwnerAgent } from "./git-owner"
import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs"
import { resolve } from "path"
import { tmpdir } from "os"

describe("createGitOwnerAgent - knowledge file loading", () => {
  let testDir: string

  beforeEach(() => {
    // Create temporary directory for test files
    testDir = resolve(tmpdir(), `git-owner-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    // Clean up test files
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  describe("without knowledgePaths", () => {
    test("creates agent with default prompt when no knowledgePaths provided", () => {
      // given
      const model = "anthropic/claude-opus-4-5"
      const config = { model }

      // when
      const agent = createGitOwnerAgent(model, config)

      // then
      expect(agent.prompt).toBeDefined()
      expect(agent.prompt).toContain("Git & GitHub Owner")
      expect(agent.prompt).toContain("Responsibilities")
    })

    test("creates agent with owner and constraints when provided without knowledgePaths", () => {
      // given
      const ownerPath = resolve(testDir, "OWNER.md")
      const constraintsPath = resolve(testDir, "constraints.yaml")
      writeFileSync(ownerPath, "# Custom Owner\nCustom content")
      writeFileSync(constraintsPath, "domain: git\nowner: custom")

      const model = "anthropic/claude-opus-4-5"
      const config = {
        model,
        promptPath: ownerPath,
        constraintsPath,
      }

      // when
      const agent = createGitOwnerAgent(model, config)

      // then
      expect(agent.prompt).toContain("Custom Owner")
      expect(agent.prompt).toContain("Custom content")
      expect(agent.prompt).toContain("Constraints Reference")
      expect(agent.prompt).toContain("domain: git")
    })
  })

  describe("with knowledgePaths", () => {
    test("appends knowledge file content to system prompt", () => {
      // given
      const knowledgePath = resolve(testDir, "company-conventions.md")
      writeFileSync(knowledgePath, "# Company Conventions\n\nAll commits must be atomic.")

      const model = "anthropic/claude-opus-4-5"
      const config = {
        model,
        knowledgePaths: [knowledgePath],
      }

      // when
      const agent = createGitOwnerAgent(model, config)

      // then
      expect(agent.prompt).toContain("Git & GitHub Owner")
      expect(agent.prompt).toContain("Company Conventions")
      expect(agent.prompt).toContain("All commits must be atomic.")
    })

    test("appends multiple knowledge files in order", () => {
      // given
      const knowledge1Path = resolve(testDir, "conventions.md")
      const knowledge2Path = resolve(testDir, "guidelines.md")
      writeFileSync(knowledge1Path, "# Conventions\n\nFirst knowledge file")
      writeFileSync(knowledge2Path, "# Guidelines\n\nSecond knowledge file")

      const model = "anthropic/claude-opus-4-5"
      const config = {
        model,
        knowledgePaths: [knowledge1Path, knowledge2Path],
      }

      // when
      const agent = createGitOwnerAgent(model, config)

      // then
      expect(agent.prompt).toContain("Conventions")
      expect(agent.prompt).toContain("First knowledge file")
      expect(agent.prompt).toContain("Guidelines")
      expect(agent.prompt).toContain("Second knowledge file")

      // Verify order: first knowledge file should appear before second
      expect(agent.prompt).toBeDefined()
      if (agent.prompt) {
        const firstIndex = agent.prompt.indexOf("First knowledge file")
        const secondIndex = agent.prompt.indexOf("Second knowledge file")
        expect(firstIndex).toBeLessThan(secondIndex)
      }
    })

    test("handles missing knowledge file gracefully with warning", () => {
      // given
      const missingPath = resolve(testDir, "nonexistent.md")
      const model = "anthropic/claude-opus-4-5"
      const config = {
        model,
        knowledgePaths: [missingPath],
      }

      // when - should not throw
      const agent = createGitOwnerAgent(model, config)

      // then - should still create agent with default prompt
      expect(agent.prompt).toBeDefined()
      expect(agent.prompt).toContain("Git & GitHub Owner")
      // Missing file content should not be in prompt
      expect(agent.prompt).not.toContain("nonexistent")
    })

    test("combines owner, constraints, and knowledge files", () => {
      // given
      const ownerPath = resolve(testDir, "OWNER.md")
      const constraintsPath = resolve(testDir, "constraints.yaml")
      const knowledgePath = resolve(testDir, "conventions.md")

      writeFileSync(ownerPath, "# Custom Owner\nOwner content")
      writeFileSync(constraintsPath, "domain: git\nConstraints content")
      writeFileSync(knowledgePath, "# Company Conventions\nKnowledge content")

      const model = "anthropic/claude-opus-4-5"
      const config = {
        model,
        promptPath: ownerPath,
        constraintsPath,
        knowledgePaths: [knowledgePath],
      }

      // when
      const agent = createGitOwnerAgent(model, config)

      // then
      expect(agent.prompt).toContain("Custom Owner")
      expect(agent.prompt).toContain("Owner content")
      expect(agent.prompt).toContain("Constraints Reference")
      expect(agent.prompt).toContain("Constraints content")
      expect(agent.prompt).toContain("Company Conventions")
      expect(agent.prompt).toContain("Knowledge content")
    })

    test("includes section header for knowledge files", () => {
      // given
      const knowledgePath = resolve(testDir, "conventions.md")
      writeFileSync(knowledgePath, "Atomic commits required")

      const model = "anthropic/claude-opus-4-5"
      const config = {
        model,
        knowledgePaths: [knowledgePath],
      }

      // when
      const agent = createGitOwnerAgent(model, config)

      // then
      // Should have section separator and header
      expect(agent.prompt).toContain("---")
      expect(agent.prompt).toContain("## Company Conventions")
    })

    test("handles empty knowledgePaths array", () => {
      // given
      const model = "anthropic/claude-opus-4-5"
      const config = {
        model,
        knowledgePaths: [],
      }

      // when
      const agent = createGitOwnerAgent(model, config)

      // then
      expect(agent.prompt).toBeDefined()
      expect(agent.prompt).toContain("Git & GitHub Owner")
    })

    test("handles knowledge file with special characters and formatting", () => {
      // given
      const knowledgePath = resolve(testDir, "conventions.md")
      const content = `# Company Conventions

## Commit Format
- Type: feat, fix, refactor
- Scope: optional
- Subject: imperative mood

## Examples
\`\`\`
feat(auth): add JWT validation
fix(parser): handle null values
\`\`\`

**Important**: Always follow atomic commit principle.`

      writeFileSync(knowledgePath, content)

      const model = "anthropic/claude-opus-4-5"
      const config = {
        model,
        knowledgePaths: [knowledgePath],
      }

      // when
      const agent = createGitOwnerAgent(model, config)

      // then
      expect(agent.prompt).toContain("Commit Format")
      expect(agent.prompt).toContain("feat(auth): add JWT validation")
      expect(agent.prompt).toContain("Always follow atomic commit principle")
    })

    test("preserves knowledge file content exactly", () => {
      // given
      const knowledgePath = resolve(testDir, "conventions.md")
      const originalContent = "Line 1\nLine 2\nLine 3"
      writeFileSync(knowledgePath, originalContent)

      const model = "anthropic/claude-opus-4-5"
      const config = {
        model,
        knowledgePaths: [knowledgePath],
      }

      // when
      const agent = createGitOwnerAgent(model, config)

      // then
      expect(agent.prompt).toContain(originalContent)
    })
  })

  describe("path resolution", () => {
    test("resolves tilde paths correctly", () => {
      // given - create a file in a subdirectory to simulate domain-owners structure
      const subDir = resolve(testDir, "domain-owners", "git-owner")
      mkdirSync(subDir, { recursive: true })
      const knowledgePath = resolve(subDir, "conventions.md")
      writeFileSync(knowledgePath, "# Conventions\nContent")

      const model = "anthropic/claude-opus-4-5"
      // Use absolute path (tilde resolution happens in safeReadFile)
      const config = {
        model,
        knowledgePaths: [knowledgePath],
      }

      // when
      const agent = createGitOwnerAgent(model, config)

      // then
      expect(agent.prompt).toContain("Conventions")
      expect(agent.prompt).toContain("Content")
    })
  })

  describe("agent configuration", () => {
    test("preserves agent model and temperature", () => {
      // given
      const knowledgePath = resolve(testDir, "conventions.md")
      writeFileSync(knowledgePath, "# Conventions")

      const model = "anthropic/claude-opus-4-5"
      const config = {
        model,
        knowledgePaths: [knowledgePath],
      }

      // when
      const agent = createGitOwnerAgent(model, config)

      // then
      expect(agent.model).toBe(model)
      expect(agent.temperature).toBe(0.1)
      expect(agent.mode).toBe("subagent")
    })

    test("includes proper description", () => {
      // given
      const model = "anthropic/claude-opus-4-5"
      const config = { model }

      // when
      const agent = createGitOwnerAgent(model, config)

      // then
      expect(agent.description).toContain("git and GitHub operations")
      expect(agent.description).toContain("Git Owner")
    })
  })
})
