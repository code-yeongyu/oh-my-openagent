import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { PluginInput } from "@opencode-ai/plugin"

import { createMomusReviewPersistenceHook } from "./hook"

const OKAY_OUTPUT = "**[OKAY]**\n\n**Summary**: All references check out."
const REJECT_OUTPUT = "**[REJECT]**\n\n**Summary**: One reference is missing.\n\n**Blocking Issues**:\n1. `.omo/plans/demo.md:12` cites a file that does not exist."

function createProject(): string {
  const directory = mkdtempSync(join(tmpdir(), "momus-review-persistence-"))
  mkdirSync(join(directory, ".omo", "plans"), { recursive: true })
  writeFileSync(join(directory, ".omo", "plans", "demo.md"), "# Demo plan\n", "utf-8")
  return directory
}

function createCtx(directory: string, messages: unknown[] = []): PluginInput {
  return {
    directory,
    client: {
      session: {
        messages: async () => ({ data: messages }),
      },
    },
  } as unknown as PluginInput
}

function listReviews(directory: string): string[] {
  const reviewsDir = join(directory, ".omo", "plans", "demo.reviews")
  return existsSync(reviewsDir) ? readdirSync(reviewsDir).sort() : []
}

describe("createMomusReviewPersistenceHook", () => {
  test("persists a synchronous Momus OKAY verdict next to the plan", async () => {
    // given
    const directory = createProject()
    const hook = createMomusReviewPersistenceHook(createCtx(directory))
    const input = { tool: "task", sessionID: "ses_parent", callID: "call_1" }

    try {
      // when
      await hook["tool.execute.before"](input, { args: { subagent_type: "momus" } })
      await hook["tool.execute.after"](input, {
        title: "Review plan",
        output: OKAY_OUTPUT,
        metadata: {
          agent: "momus",
          prompt: ".omo/plans/demo.md",
          model: { providerID: "anthropic", modelID: "claude-opus-4-6" },
          sessionId: "ses_child",
        },
      })

      // then
      expect(listReviews(directory)).toEqual(["001-okay.md"])
      const content = readFileSync(join(directory, ".omo", "plans", "demo.reviews", "001-okay.md"), "utf-8")
      expect(content).toContain("Verdict: okay")
      expect(content).toContain("Model: anthropic/claude-opus-4-6")
      expect(content).toContain("Plan hash (sha256): ")
      expect(content).toContain("Reviewer session: ses_child")
      expect(content).toContain("**Summary**: All references check out.")
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("numbers a later REJECT review after the earlier one", async () => {
    // given
    const directory = createProject()
    const hook = createMomusReviewPersistenceHook(createCtx(directory))

    try {
      // when
      await hook["tool.execute.after"](
        { tool: "task", sessionID: "ses_parent", callID: "call_1", args: { subagent_type: "momus", prompt: ".omo/plans/demo.md" } },
        { title: "Review plan", output: OKAY_OUTPUT, metadata: {} },
      )
      await hook["tool.execute.after"](
        { tool: "task", sessionID: "ses_parent", callID: "call_2", args: { subagent_type: "momus", prompt: ".omo/plans/demo.md" } },
        { title: "Review plan again", output: REJECT_OUTPUT, metadata: {} },
      )

      // then
      expect(listReviews(directory)).toEqual(["001-okay.md", "002-reject.md"])
      const content = readFileSync(join(directory, ".omo", "plans", "demo.reviews", "002-reject.md"), "utf-8")
      expect(content).toContain("**Blocking Issues**")
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("ignores task results from other agents", async () => {
    // given
    const directory = createProject()
    const hook = createMomusReviewPersistenceHook(createCtx(directory))

    try {
      // when
      await hook["tool.execute.after"](
        { tool: "task", sessionID: "ses_parent", callID: "call_1" },
        { title: "Oracle review", output: OKAY_OUTPUT, metadata: { agent: "oracle", prompt: ".omo/plans/demo.md" } },
      )

      // then
      expect(listReviews(directory)).toEqual([])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("ignores Momus output without a verdict marker", async () => {
    // given
    const directory = createProject()
    const hook = createMomusReviewPersistenceHook(createCtx(directory))

    try {
      // when
      await hook["tool.execute.after"](
        { tool: "task", sessionID: "ses_parent", callID: "call_1" },
        { title: "Review plan", output: "Still reviewing, no verdict yet.", metadata: { agent: "momus", prompt: ".omo/plans/demo.md" } },
      )

      // then
      expect(listReviews(directory)).toEqual([])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("ignores prompts that reference more than one plan", async () => {
    // given
    const directory = createProject()
    const hook = createMomusReviewPersistenceHook(createCtx(directory))

    try {
      // when
      await hook["tool.execute.after"](
        { tool: "task", sessionID: "ses_parent", callID: "call_1" },
        {
          title: "Review plan",
          output: OKAY_OUTPUT,
          metadata: { agent: "momus", prompt: "Compare .omo/plans/demo.md with .omo/plans/other.md" },
        },
      )

      // then
      expect(listReviews(directory)).toEqual([])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("persists background Momus verdicts fetched through background_output", async () => {
    // given
    const directory = createProject()
    const messages = [
      {
        info: { role: "user", time: { created: 1_000 } },
        parts: [{ type: "text", text: ".omo/plans/demo.md" }],
      },
      {
        info: { role: "assistant", providerID: "openai", modelID: "gpt-5.5", time: { created: 2_000, completed: 61_000 } },
        parts: [{ type: "text", text: OKAY_OUTPUT }],
      },
    ]
    const hook = createMomusReviewPersistenceHook(createCtx(directory, messages))

    try {
      // when
      await hook["tool.execute.after"](
        { tool: "background_output", sessionID: "ses_parent", callID: "call_9", args: { task_id: "bg_1" } },
        { title: "Background task result", output: OKAY_OUTPUT, metadata: { agent: "momus", sessionId: "ses_bg_child" } },
      )

      // then
      expect(listReviews(directory)).toEqual(["001-okay.md"])
      const content = readFileSync(join(directory, ".omo", "plans", "demo.reviews", "001-okay.md"), "utf-8")
      expect(content).toContain("Model: openai/gpt-5.5")
      expect(content).toContain("Duration: 60.0s")
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("leaves the tool output untouched", async () => {
    // given
    const directory = createProject()
    const hook = createMomusReviewPersistenceHook(createCtx(directory))
    const output = { title: "Review plan", output: OKAY_OUTPUT, metadata: { agent: "momus", prompt: ".omo/plans/demo.md" } }

    try {
      // when
      await hook["tool.execute.after"]({ tool: "task", sessionID: "ses_parent", callID: "call_1" }, output)

      // then
      expect(output.output).toBe(OKAY_OUTPUT)
      expect(output.title).toBe("Review plan")
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
