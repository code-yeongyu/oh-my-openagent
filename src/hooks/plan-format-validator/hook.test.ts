import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createPlanFormatValidatorHook } from "./hook"

function createMockCtx(directory: string) {
  return {
    directory,
    client: { tui: { showToast: () => Promise.resolve() } },
  } as never
}

function createInput(tool: string, filePath: string) {
  return {
    tool,
    sessionID: "test-session",
    callID: "test-call",
    args: { filePath },
  }
}

function createOutput(outputText = "File written successfully") {
  return {
    title: "Write",
    output: outputText,
    metadata: {},
  }
}

describe("createPlanFormatValidatorHook", () => {
  let testDir: string
  let plansDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `omo-plan-validator-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    plansDir = join(testDir, ".omo", "plans")
    mkdirSync(plansDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  describe("#given a Write tool writes a valid plan with correct task labels", () => {
    it("#then does not append a warning", async () => {
      // given
      const planContent = [
        "# My Plan",
        "",
        "## TODOs",
        "- [ ] 1. First task",
        "- [ ] 2. Second task",
        "",
        "## Final Verification Wave",
        "- [ ] F1. Verify first",
      ].join("\n")
      const planPath = join(plansDir, "test-plan.md")
      writeFileSync(planPath, planContent)

      const hook = createPlanFormatValidatorHook(createMockCtx(testDir))
      const input = createInput("Write", planPath)
      const output = createOutput()

      // when
      await hook["tool.execute.after"](input, output)

      // then
      expect(output.output).not.toContain("<plan-format-warning>")
    })
  })

  describe("#given a Write tool writes a plan with malformed task labels", () => {
    it("#then appends a plan-format-warning when some tasks are skipped", async () => {
      // given - "T1." is not a valid label format (should be "1.")
      const planContent = [
        "# My Plan",
        "",
        "## TODOs",
        "- [ ] T1. First task",
        "- [ ] T2. Second task",
        "- [ ] 3. Third task",
        "",
      ].join("\n")
      const planPath = join(plansDir, "test-plan.md")
      writeFileSync(planPath, planContent)

      const hook = createPlanFormatValidatorHook(createMockCtx(testDir))
      const input = createInput("Write", planPath)
      const output = createOutput()

      // when
      await hook["tool.execute.after"](input, output)

      // then
      expect(output.output).toContain("<plan-format-warning>")
      expect(output.output).toContain("only parsed **1**")
    })
  })

  describe("#given a Write tool writes a plan where all task labels are malformed", () => {
    it("#then appends a warning indicating 0 tasks parsed", async () => {
      // given
      const planContent = [
        "# My Plan",
        "",
        "## TODOs",
        "- [ ] Task-1. First task",
        "- [ ] Task-2. Second task",
        "",
      ].join("\n")
      const planPath = join(plansDir, "test-plan.md")
      writeFileSync(planPath, planContent)

      const hook = createPlanFormatValidatorHook(createMockCtx(testDir))
      const input = createInput("Write", planPath)
      const output = createOutput()

      // when
      await hook["tool.execute.after"](input, output)

      // then
      expect(output.output).toContain("<plan-format-warning>")
      expect(output.output).toContain("parsed **0**")
    })
  })

  describe("#given the tool is not a Write or Edit tool", () => {
    it("#then does not check the file", async () => {
      // given
      const planPath = join(plansDir, "test-plan.md")
      writeFileSync(planPath, "## TODOs\n- [ ] T1. Bad label\n")

      const hook = createPlanFormatValidatorHook(createMockCtx(testDir))
      const input = createInput("Read", planPath)
      const output = createOutput()

      // when
      await hook["tool.execute.after"](input, output)

      // then
      expect(output.output).not.toContain("<plan-format-warning>")
    })
  })

  describe("#given the file is not in .omo/plans/", () => {
    it("#then does not validate the file", async () => {
      // given
      const otherPath = join(testDir, "some-file.md")
      writeFileSync(otherPath, "## TODOs\n- [ ] T1. Bad label\n")

      const hook = createPlanFormatValidatorHook(createMockCtx(testDir))
      const input = createInput("Write", otherPath)
      const output = createOutput()

      // when
      await hook["tool.execute.after"](input, output)

      // then
      expect(output.output).not.toContain("<plan-format-warning>")
    })
  })

  describe("#given the file does not exist on disk", () => {
    it("#then does not append a warning", async () => {
      // given
      const planPath = join(plansDir, "nonexistent.md")

      const hook = createPlanFormatValidatorHook(createMockCtx(testDir))
      const input = createInput("Write", planPath)
      const output = createOutput()

      // when
      await hook["tool.execute.after"](input, output)

      // then
      expect(output.output).not.toContain("<plan-format-warning>")
    })
  })

  describe("#given the output already contains a plan-format-warning", () => {
    it("#then does not append a duplicate warning", async () => {
      // given
      const planContent = [
        "## TODOs",
        "- [ ] T1. Bad label",
      ].join("\n")
      const planPath = join(plansDir, "test-plan.md")
      writeFileSync(planPath, planContent)

      const hook = createPlanFormatValidatorHook(createMockCtx(testDir))
      const input = createInput("Write", planPath)
      const output = createOutput("File written\n<plan-format-warning>existing</plan-format-warning>")

      // when
      await hook["tool.execute.after"](input, output)

      // then - should still have only the original warning, not a second one
      const matches = output.output.match(/<plan-format-warning>/g)
      expect(matches?.length).toBe(1)
    })
  })

  describe("#given the plan has no checkboxes", () => {
    it("#then does not append a warning", async () => {
      // given
      const planContent = [
        "# My Plan",
        "",
        "## TODOs",
        "Just some text without checkboxes",
      ].join("\n")
      const planPath = join(plansDir, "test-plan.md")
      writeFileSync(planPath, planContent)

      const hook = createPlanFormatValidatorHook(createMockCtx(testDir))
      const input = createInput("Write", planPath)
      const output = createOutput()

      // when
      await hook["tool.execute.after"](input, output)

      // then
      expect(output.output).not.toContain("<plan-format-warning>")
    })
  })

  describe("#given the Edit tool writes a plan file", () => {
    it("#then validates the plan format", async () => {
      // given
      const planContent = [
        "## TODOs",
        "- [ ] Phase 1: Bad label",
        "- [ ] 1. Good label",
      ].join("\n")
      const planPath = join(plansDir, "edit-plan.md")
      writeFileSync(planPath, planContent)

      const hook = createPlanFormatValidatorHook(createMockCtx(testDir))
      const input = createInput("edit", planPath)
      const output = createOutput()

      // when
      await hook["tool.execute.after"](input, output)

      // then
      expect(output.output).toContain("<plan-format-warning>")
    })
  })

  describe("#given args is undefined", () => {
    it("#then does nothing", async () => {
      // given
      const hook = createPlanFormatValidatorHook(createMockCtx(testDir))
      const input = {
        tool: "Write",
        sessionID: "test-session",
        callID: "test-call",
        args: undefined,
      }
      const output = createOutput()

      // when
      await hook["tool.execute.after"](input as never, output)

      // then
      expect(output.output).not.toContain("<plan-format-warning>")
    })
  })

  describe("#given Final Verification Wave has malformed labels", () => {
    it("#then detects the mismatch", async () => {
      // given
      const planContent = [
        "## TODOs",
        "- [ ] 1. Good task",
        "",
        "## Final Verification Wave",
        "- [ ] T-F1. Bad final label",
        "- [ ] F1. Good final label",
      ].join("\n")
      const planPath = join(plansDir, "final-wave-plan.md")
      writeFileSync(planPath, planContent)

      const hook = createPlanFormatValidatorHook(createMockCtx(testDir))
      const input = createInput("Write", planPath)
      const output = createOutput()

      // when
      await hook["tool.execute.after"](input, output)

      // then
      expect(output.output).toContain("<plan-format-warning>")
    })
  })
})
