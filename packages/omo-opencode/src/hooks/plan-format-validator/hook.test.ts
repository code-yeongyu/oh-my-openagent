import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import type { PluginInput } from "@opencode-ai/plugin"

import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { createPlanFormatValidatorHook } from "./hook"

type PlanFormatValidatorHook = ReturnType<typeof createPlanFormatValidatorHook>
type ToolExecuteAfter = NonNullable<PlanFormatValidatorHook["tool.execute.after"]>
type HookInput = Parameters<ToolExecuteAfter>[0]
type HookOutput = Parameters<ToolExecuteAfter>[1]

type FixtureOptions = {
  readonly filePath?: string
  readonly initialOutput?: string
  readonly tool?: string
}

function createFixture(content: string, options: FixtureOptions = {}) {
  const directory = mkdtempSync(join(tmpdir(), "plan-format-validator-"))
  const filePath = options.filePath ?? ".omo/plans/plan.md"
  const resolvedPath = join(directory, filePath)
  mkdirSync(dirname(resolvedPath), { recursive: true })
  writeFileSync(resolvedPath, content, "utf-8")

  const hook = createPlanFormatValidatorHook(unsafeTestValue<PluginInput>({ directory }))
  const input: HookInput = {
    tool: options.tool ?? "Write",
    sessionID: "ses_plan-format-validator",
    callID: "call_plan-format-validator",
    args: { filePath },
  }
  const output: HookOutput = {
    title: "plan.md",
    output: options.initialOutput ?? "write complete",
    metadata: {},
  }

  return {
    output,
    async run(): Promise<void> {
      await hook["tool.execute.after"](input, output)
    },
    cleanup(): void {
      rmSync(directory, { recursive: true, force: true })
    },
  }
}

describe("plan-format-validator", () => {
  test("appends a warning when a recognized Todos section contains only prose", async () => {
    // given
    const fixture = createFixture(`# Plan\n\n## Todos\nDescribe the implementation work here.`)

    try {
      // when
      await fixture.run()

      // then
      expect(fixture.output.output).toContain("<plan-format-warning>")
    } finally {
      fixture.cleanup()
    }
  })

  test("appends a warning when a recognized Final Verification Wave contains only prose", async () => {
    // given
    const fixture = createFixture(`# Plan\n\n## Final Verification Wave\nDescribe the final checks here.`)

    try {
      // when
      await fixture.run()

      // then
      expect(fixture.output.output).toContain("<plan-format-warning>")
    } finally {
      fixture.cleanup()
    }
  })

  test("warns when a valid Todos section masks a prose-only final wave", async () => {
    // given
    const fixture = createFixture(`# Plan

## Todos
- [ ] 1. Implement the change

## Final Verification Wave
Describe the final checks here.
`)

    try {
      // when
      await fixture.run()

      // then
      expect(fixture.output.output).toContain("<plan-format-warning>")
    } finally {
      fixture.cleanup()
    }
  })

  test("preserves a valid structured plan", async () => {
    // given
    const fixture = createFixture(`# Plan

## Todos
- [ ] 1. Implement the change
- [x] 2. Review the change

## Final Verification Wave
- [ ] F1. Run the focused tests
`)
    const originalOutput = fixture.output.output

    try {
      // when
      await fixture.run()

      // then
      expect(fixture.output.output).toBe(originalOutput)
    } finally {
      fixture.cleanup()
    }
  })

  test("warns when a structured plan has malformed checkboxes", async () => {
    // given
    const fixture = createFixture(`# Plan\n\n## Todos\n- [ ] missing a numeric task label`)

    try {
      // when
      await fixture.run()

      // then
      expect(fixture.output.output).toContain("<plan-format-warning>")
    } finally {
      fixture.cleanup()
    }
  })

  test("does not append a duplicate warning", async () => {
    // given
    const initialOutput = "write complete\n<plan-format-warning>already emitted</plan-format-warning>"
    const fixture = createFixture(`# Plan\n\n## Todos\n- [ ] missing a numeric task label`, { initialOutput })

    try {
      // when
      await fixture.run()

      // then
      expect(fixture.output.output).toBe(initialOutput)
    } finally {
      fixture.cleanup()
    }
  })

  test("bypasses non-plan files", async () => {
    // given
    const fixture = createFixture(`# Notes\n- [ ] 1. This is not a plan`, { filePath: "notes.md" })
    const originalOutput = fixture.output.output

    try {
      // when
      await fixture.run()

      // then
      expect(fixture.output.output).toBe(originalOutput)
    } finally {
      fixture.cleanup()
    }
  })

  test("preserves legacy plans with no recognized structured headings", async () => {
    // given
    const fixture = createFixture(`# Legacy Plan\n- [ ] 1. Legacy task`)
    const originalOutput = fixture.output.output

    try {
      // when
      await fixture.run()

      // then
      expect(fixture.output.output).toBe(originalOutput)
    } finally {
      fixture.cleanup()
    }
  })

  test("warns when a four-backtick fence contains the only apparent task row", async () => {
    // given
    const fixture = createFixture(`# Plan

## Todos
\`\`\`\`md
\`\`\`ts
- [ ] 1. Fenced example
\`\`\`
\`\`\`\`
`)

    try {
      // when
      await fixture.run()

      // then
      expect(fixture.output.output).toContain("<plan-format-warning>")
    } finally {
      fixture.cleanup()
    }
  })
})
