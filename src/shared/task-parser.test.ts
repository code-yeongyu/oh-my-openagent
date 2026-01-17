import { describe, test, expect } from "bun:test"
import {
  parseRiskTier,
  parseDependsOn,
  parseTaskType,
  parseAgent,
  parseFilesSection,
  parseAcceptance,
  parseTddNotes,
  splitIntoTaskBlocks,
  parseTaskBlock,
  detectFileConflicts,
  parseTasksMd,
  formatWavePreview,
  type ParsedTask,
  type ParsedTaskFiles,
} from "./task-parser"

describe("task-parser", () => {
  describe("parseRiskTier", () => {
    test("parses Tier-0", () => {
      expect(parseRiskTier("### Task 1.1: Do something <!-- Risk: Tier-0 -->")).toBe(0)
    })

    test("parses Tier-2 without hyphen", () => {
      expect(parseRiskTier("### Task 1.1: Do something <!-- Risk: Tier2 -->")).toBe(2)
    })

    test("parses Tier-3", () => {
      expect(parseRiskTier("### Task 1.1: Do something <!-- Risk: Tier-3 -->")).toBe(3)
    })

    test("defaults to Tier-2 when not specified", () => {
      expect(parseRiskTier("### Task 1.1: Do something")).toBe(2)
    })
  })

  describe("parseDependsOn", () => {
    test("parses single dependency", () => {
      expect(parseDependsOn("<!-- depends_on: 1.1 -->")).toEqual(["1.1"])
    })

    test("parses multiple dependencies", () => {
      expect(parseDependsOn("<!-- depends_on: 1.1, 1.2, 2.1 -->")).toEqual(["1.1", "1.2", "2.1"])
    })

    test("handles none", () => {
      expect(parseDependsOn("<!-- depends_on: none -->")).toEqual([])
    })

    test("returns empty array when not specified", () => {
      expect(parseDependsOn("### Task 1.1: Do something")).toEqual([])
    })

    test("handles whitespace", () => {
      expect(parseDependsOn("<!--  depends_on:  1.1 ,  2.1  -->")).toEqual(["1.1", "2.1"])
    })
  })

  describe("parseTaskType", () => {
    test("parses code type", () => {
      expect(parseTaskType("<!-- type: code -->")).toBe("code")
    })

    test("parses frontend type", () => {
      expect(parseTaskType("<!-- type: frontend -->")).toBe("frontend")
    })

    test("parses docs type", () => {
      expect(parseTaskType("<!-- type: docs -->")).toBe("docs")
    })

    test("defaults to code when not specified", () => {
      expect(parseTaskType("### Task 1.1: Do something")).toBe("code")
    })
  })

  describe("parseAgent", () => {
    test("parses implementer", () => {
      expect(parseAgent("<!-- agent: implementer -->")).toBe("implementer")
    })

    test("parses frontend-ui-ux-engineer", () => {
      expect(parseAgent("<!-- agent: frontend-ui-ux-engineer -->")).toBe("frontend-ui-ux-engineer")
    })

    test("parses document-writer", () => {
      expect(parseAgent("<!-- agent: document-writer -->")).toBe("document-writer")
    })

    test("defaults to implementer when not specified", () => {
      expect(parseAgent("### Task 1.1: Do something")).toBe("implementer")
    })
  })

  describe("parseFilesSection", () => {
    test("parses create files", () => {
      const content = `
**Files:**
- Create: \`src/core/base.ts\`
- Create: \`src/core/types.ts\`
`
      const files = parseFilesSection(content)
      expect(files.create).toEqual(["src/core/base.ts", "src/core/types.ts"])
    })

    test("parses modify files with warning emoji", () => {
      const content = `
**Files:**
- Modify: \`src/core/index.ts\` ⚠️ (shared file)
`
      const files = parseFilesSection(content)
      expect(files.modify).toEqual(["src/core/index.ts"])
    })

    test("parses test files", () => {
      const content = `
**Files:**
- Test: \`tests/core/base.test.ts\`
`
      const files = parseFilesSection(content)
      expect(files.test).toEqual(["tests/core/base.test.ts"])
    })

    test("parses mixed files", () => {
      const content = `
**Files:**
- Create: \`src/new.ts\`
- Modify: \`src/existing.ts\`
- Test: \`tests/new.test.ts\`
`
      const files = parseFilesSection(content)
      expect(files.create).toEqual(["src/new.ts"])
      expect(files.modify).toEqual(["src/existing.ts"])
      expect(files.test).toEqual(["tests/new.test.ts"])
    })

    test("returns empty arrays when no files", () => {
      const files = parseFilesSection("No files here")
      expect(files.create).toEqual([])
      expect(files.modify).toEqual([])
      expect(files.test).toEqual([])
    })
  })

  describe("parseAcceptance", () => {
    test("parses acceptance criteria", () => {
      const content = `
**Acceptance:**
- [ ] Base class implemented with all methods
- [ ] Types exported correctly
- [ ] Tests cover happy path
`
      const criteria = parseAcceptance(content)
      expect(criteria).toEqual([
        "Base class implemented with all methods",
        "Types exported correctly",
        "Tests cover happy path",
      ])
    })

    test("handles checked items", () => {
      const content = `
**Acceptance:**
- [x] Already done
- [ ] Still pending
`
      const criteria = parseAcceptance(content)
      expect(criteria).toEqual(["Already done", "Still pending"])
    })

    test("returns empty array when no acceptance section", () => {
      expect(parseAcceptance("No acceptance here")).toEqual([])
    })
  })

  describe("parseTddNotes", () => {
    test("parses TDD notes", () => {
      const content = `
**TDD Notes:**
- Test: \`new Base().process()\` → returns processed result
- Test: \`new Base().validate()\` → throws on invalid input
`
      const notes = parseTddNotes(content)
      expect(notes).toEqual([
        "`new Base().process()` → returns processed result",
        "`new Base().validate()` → throws on invalid input",
      ])
    })

    test("returns empty array when no TDD section", () => {
      expect(parseTddNotes("No TDD here")).toEqual([])
    })
  })

  describe("splitIntoTaskBlocks", () => {
    test("splits multiple tasks", () => {
      const content = `
# Tasks: feature

## Phase 1

### Task 1.1: First task <!-- Risk: Tier-2 -->

Body of first task

### Task 1.2: Second task <!-- Risk: Tier-1 -->

Body of second task
`
      const blocks = splitIntoTaskBlocks(content)
      expect(blocks.length).toBe(2)
      expect(blocks[0].headerLine).toContain("Task 1.1")
      expect(blocks[1].headerLine).toContain("Task 1.2")
    })

    test("handles single task", () => {
      const content = `
### Task 1.1: Only task

Body here
`
      const blocks = splitIntoTaskBlocks(content)
      expect(blocks.length).toBe(1)
    })
  })

  describe("parseTaskBlock", () => {
    test("parses complete task block", () => {
      const header = "### Task 1.1: Implement base module <!-- Risk: Tier-2 --> <!-- type: code --> <!-- agent: implementer --> <!-- depends_on: none -->"
      const body = `
**Files:**
- Create: \`src/core/base.ts\`
- Test: \`tests/core/base.test.ts\`

**Acceptance:**
- [ ] Base class implemented

**TDD Notes:**
- Test: \`new Base()\` works
`
      const task = parseTaskBlock(header, body)
      expect(task).not.toBeNull()
      expect(task!.id).toBe("1.1")
      expect(task!.name).toBe("Implement base module")
      expect(task!.riskTier).toBe(2)
      expect(task!.taskType).toBe("code")
      expect(task!.agent).toBe("implementer")
      expect(task!.files.create).toEqual(["src/core/base.ts"])
      expect(task!.acceptance.length).toBe(1)
      expect(task!.tddNotes.length).toBe(1)
    })

    test("returns null for non-task header", () => {
      expect(parseTaskBlock("## Phase 1", "body")).toBeNull()
    })
  })

  describe("detectFileConflicts", () => {
    test("detects conflicts when multiple tasks modify same file", () => {
      const tasks: ParsedTask[] = [
        {
          id: "1.1",
          name: "Task 1",
          riskTier: 2,
          dependsOn: [],
          taskType: "code",
          agent: "implementer",
          files: { create: [], modify: ["src/index.ts"], test: [] },
          acceptance: [],
          tddNotes: [],
        },
        {
          id: "2.1",
          name: "Task 2",
          riskTier: 2,
          dependsOn: [],
          taskType: "code",
          agent: "implementer",
          files: { create: [], modify: ["src/index.ts"], test: [] },
          acceptance: [],
          tddNotes: [],
        },
      ]

      const conflicts = detectFileConflicts(tasks)
      expect(conflicts.length).toBe(1)
      expect(conflicts[0].file).toBe("src/index.ts")
      expect(conflicts[0].taskIds).toEqual(["1.1", "2.1"])
    })

    test("returns empty when no conflicts", () => {
      const tasks: ParsedTask[] = [
        {
          id: "1.1",
          name: "Task 1",
          riskTier: 2,
          dependsOn: [],
          taskType: "code",
          agent: "implementer",
          files: { create: ["src/a.ts"], modify: [], test: [] },
          acceptance: [],
          tddNotes: [],
        },
        {
          id: "1.2",
          name: "Task 2",
          riskTier: 2,
          dependsOn: [],
          taskType: "code",
          agent: "implementer",
          files: { create: ["src/b.ts"], modify: [], test: [] },
          acceptance: [],
          tddNotes: [],
        },
      ]

      const conflicts = detectFileConflicts(tasks)
      expect(conflicts.length).toBe(0)
    })
  })

  describe("parseTasksMd", () => {
    test("parses complete tasks.md", () => {
      const content = `# Tasks: my-feature

## Phase 1

### Task 1.1: First task <!-- Risk: Tier-2 --> <!-- type: code --> <!-- agent: implementer --> <!-- depends_on: none -->

**Files:**
- Create: \`src/first.ts\`
- Test: \`tests/first.test.ts\`

**Acceptance:**
- [ ] First task done

---

### Task 1.2: Second task <!-- Risk: Tier-1 --> <!-- type: code --> <!-- agent: implementer --> <!-- depends_on: 1.1 -->

**Files:**
- Create: \`src/second.ts\`

**Acceptance:**
- [ ] Second task done
`
      const result = parseTasksMd(content)
      expect(result.featureName).toBe("my-feature")
      expect(result.tasks.length).toBe(2)
      expect(result.tasks[0].id).toBe("1.1")
      expect(result.tasks[1].id).toBe("1.2")
      expect(result.tasks[1].dependsOn).toEqual(["1.1"])
      expect(result.waveResult.waves.length).toBe(2)
    })

    test("handles unknown feature name", () => {
      const content = `### Task 1.1: Only task`
      const result = parseTasksMd(content)
      expect(result.featureName).toBe("unknown")
    })
  })

  describe("formatWavePreview", () => {
    test("formats wave preview table", () => {
      const content = `# Tasks: test-feature

### Task 1.1: Task A <!-- depends_on: none -->

**Files:**
- Create: \`src/a.ts\`

### Task 1.2: Task B <!-- depends_on: none -->

**Files:**
- Create: \`src/b.ts\`

### Task 2.1: Task C <!-- depends_on: 1.1, 1.2 -->

**Files:**
- Create: \`src/c.ts\`
`
      const result = parseTasksMd(content)
      const preview = formatWavePreview(result)

      expect(preview).toContain("## Wave Preview")
      expect(preview).toContain("Wave 0")
      expect(preview).toContain("Wave 1")
      expect(preview).toContain("1.1")
      expect(preview).toContain("1.2")
      expect(preview).toContain("2.1")
    })

    test("includes file conflicts section", () => {
      const content = `# Tasks: conflict-feature

### Task 1.1: Task A <!-- depends_on: none -->

**Files:**
- Modify: \`src/shared.ts\`

### Task 1.2: Task B <!-- depends_on: none -->

**Files:**
- Modify: \`src/shared.ts\`
`
      const result = parseTasksMd(content)
      const preview = formatWavePreview(result)

      expect(preview).toContain("## File Conflicts")
      expect(preview).toContain("src/shared.ts")
    })
  })
})
