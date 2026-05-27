import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { readCurrentTopLevelTask } from "./top-level-task"

const TEST_DIR = join(tmpdir(), `boulder-top-level-task-test-${Date.now()}`)

function setupTestDir() {
  mkdirSync(TEST_DIR, { recursive: true })
}

function writePlan(content: string): string {
  const planPath = join(TEST_DIR, "plan.md")
  writeFileSync(planPath, content, "utf-8")
  return planPath
}

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true })
})

describe("readCurrentTopLevelTask", () => {
  describe("#given a non-existent plan file", () => {
    test("#then it returns null", () => {
      const result = readCurrentTopLevelTask("/non/existent/path/plan.md")
      expect(result).toBeNull()
    })
  })

  describe("#given an empty plan file", () => {
    test("#then it returns null", () => {
      setupTestDir()
      const planPath = writePlan("")
      const result = readCurrentTopLevelTask(planPath)
      expect(result).toBeNull()
    })
  })

  describe("#given a plan with no unchecked tasks", () => {
    test("#then it returns null when all tasks are checked", () => {
      setupTestDir()
      const planPath = writePlan(
        [
          "## TODOs",
          "- [x] 1. Implement feature A",
          "- [x] 2. Implement feature B",
        ].join("\n"),
      )
      const result = readCurrentTopLevelTask(planPath)
      expect(result).toBeNull()
    })
  })

  describe("#given a plan with unchecked todo tasks", () => {
    test("#then it returns the first unchecked task in the TODOs section", () => {
      setupTestDir()
      const planPath = writePlan(
        [
          "## TODOs",
          "- [x] 1. Implement feature A",
          "- [ ] 2. Implement feature B",
          "- [ ] 3. Implement feature C",
        ].join("\n"),
      )
      const result = readCurrentTopLevelTask(planPath)
      expect(result).not.toBeNull()
      expect(result!.key).toBe("todo:2")
      expect(result!.section).toBe("todo")
      expect(result!.label).toBe("2")
      expect(result!.title).toBe("Implement feature B")
    })

    test("#then it skips indented checkboxes (sub-tasks)", () => {
      setupTestDir()
      const planPath = writePlan(
        [
          "## TODOs",
          "- [x] 1. Implement feature A",
          "  - [ ] Sub-task that should be skipped",
          "- [ ] 2. Next top-level task",
        ].join("\n"),
      )
      const result = readCurrentTopLevelTask(planPath)
      expect(result).not.toBeNull()
      expect(result!.key).toBe("todo:2")
      expect(result!.title).toBe("Next top-level task")
    })
  })

  describe("#given a plan with Final Verification Wave section", () => {
    test("#then it returns the first unchecked task in final-wave section", () => {
      setupTestDir()
      const planPath = writePlan(
        [
          "## TODOs",
          "- [x] 1. All done here",
          "",
          "## Final Verification Wave",
          "- [ ] F1. Run full test suite",
          "- [ ] F2. Check coverage",
        ].join("\n"),
      )
      const result = readCurrentTopLevelTask(planPath)
      expect(result).not.toBeNull()
      expect(result!.key).toBe("final-wave:f1")
      expect(result!.section).toBe("final-wave")
      expect(result!.label).toBe("F1")
      expect(result!.title).toBe("Run full test suite")
    })
  })

  describe("#given a plan with tasks in non-todo sections", () => {
    test("#then it ignores unchecked tasks outside TODOs and Final Verification Wave", () => {
      setupTestDir()
      const planPath = writePlan(
        [
          "## Overview",
          "- [ ] 1. This should be ignored",
          "",
          "## Notes",
          "- [ ] 2. This too",
        ].join("\n"),
      )
      const result = readCurrentTopLevelTask(planPath)
      expect(result).toBeNull()
    })
  })

  describe("#given a plan where TODOs section has non-matching checkbox text", () => {
    test("#then it returns null when checkbox text does not match task pattern", () => {
      setupTestDir()
      const planPath = writePlan(
        [
          "## TODOs",
          "- [ ] Some random text without a number prefix",
          "- [ ] Another line without pattern",
        ].join("\n"),
      )
      const result = readCurrentTopLevelTask(planPath)
      expect(result).toBeNull()
    })
  })

  describe("#given a plan with mixed sections", () => {
    test("#then it prefers the first unchecked task encountered in document order", () => {
      setupTestDir()
      const planPath = writePlan(
        [
          "## TODOs",
          "- [ ] 1. First todo task",
          "",
          "## Final Verification Wave",
          "- [ ] F1. First final wave task",
        ].join("\n"),
      )
      const result = readCurrentTopLevelTask(planPath)
      expect(result).not.toBeNull()
      expect(result!.key).toBe("todo:1")
      expect(result!.section).toBe("todo")
    })
  })

  describe("#given section heading variations", () => {
    test("#then it matches case-insensitive TODOs heading", () => {
      setupTestDir()
      const planPath = writePlan(
        ["## todos", "- [ ] 1. Case insensitive match"].join("\n"),
      )
      const result = readCurrentTopLevelTask(planPath)
      expect(result).not.toBeNull()
      expect(result!.key).toBe("todo:1")
      expect(result!.title).toBe("Case insensitive match")
    })
  })

  describe("#given Windows-style line endings", () => {
    test("#then it handles CRLF correctly", () => {
      setupTestDir()
      const planPath = writePlan(
        ["## TODOs", "- [ ] 1. Windows line ending task"].join("\r\n"),
      )
      const result = readCurrentTopLevelTask(planPath)
      expect(result).not.toBeNull()
      expect(result!.key).toBe("todo:1")
      expect(result!.title).toBe("Windows line ending task")
    })
  })
})
