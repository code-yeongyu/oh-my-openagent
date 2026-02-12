import { describe, expect, test } from "bun:test"
import { formatCouncilResultsForSynthesis } from "./synthesis-formatter"
import type { CouncilExecutionResult } from "./types"

function createResult(overrides?: Partial<CouncilExecutionResult>): CouncilExecutionResult {
  const responses: CouncilExecutionResult["responses"] = [
    {
      member: { model: "openai/gpt-5.3-codex", name: "OpenAI" },
      status: "completed",
      response: "Finding A from OpenAI",
      taskId: "task-1",
      durationMs: 120,
    },
    {
      member: { model: "anthropic/claude-sonnet-4-5", name: "Claude" },
      status: "completed",
      response: "Finding B from Claude",
      taskId: "task-2",
      durationMs: 240,
    },
    {
      member: { model: "google/gemini-3-pro", name: "Gemini" },
      status: "completed",
      response: "Finding C from Gemini",
      taskId: "task-3",
      durationMs: 360,
    },
  ]

  return {
    question: "What reliability risks exist?",
    responses,
    totalMembers: 3,
    completedCount: 3,
    failedCount: 0,
    ...overrides,
  }
}

describe("formatCouncilResultsForSynthesis", () => {
  //#given a CouncilExecutionResult with 3 completed members
  //#when formatCouncilResultsForSynthesis is called
  //#then output contains each member's model name as a header
  //#then output contains each member's raw response text
  //#then output contains member status and duration
  test("formats all completed members with provenance and response text", () => {
    const result = createResult()

    const output = formatCouncilResultsForSynthesis(result)

    expect(output).toContain("openai/gpt-5.3-codex")
    expect(output).toContain("anthropic/claude-sonnet-4-5")
    expect(output).toContain("google/gemini-3-pro")

    expect(output).toContain("Finding A from OpenAI")
    expect(output).toContain("Finding B from Claude")
    expect(output).toContain("Finding C from Gemini")

    expect(output).toContain("Status: completed")
    expect(output).toContain("Duration: 120ms")
    expect(output).toContain("Duration: 240ms")
    expect(output).toContain("Duration: 360ms")
  })

  //#given a CouncilExecutionResult with 1 completed and 1 failed member
  //#when formatCouncilResultsForSynthesis is called
  //#then completed member's response is included
  //#then failed member shows error status and error message
  //#then failed member does NOT have a response section
  test("includes completed response and failed error without response section", () => {
    const result = createResult({
      responses: [
        {
          member: { model: "openai/gpt-5.3-codex" },
          status: "completed",
          response: "Primary finding",
          taskId: "task-1",
          durationMs: 80,
        },
        {
          member: { model: "xai/grok-code-fast-1" },
          status: "error",
          error: "Timeout from provider",
          taskId: "task-2",
          durationMs: 500,
        },
      ],
      totalMembers: 2,
      completedCount: 1,
      failedCount: 1,
    })

    const output = formatCouncilResultsForSynthesis(result)

    expect(output).toContain("Primary finding")
    expect(output).toContain("xai/grok-code-fast-1")
    expect(output).toContain("Status: error")
    expect(output).toContain("Error: Timeout from provider")
    expect(output).not.toContain("Response:\nTimeout from provider")
  })

  //#given a CouncilExecutionResult with 0 completed members
  //#when formatCouncilResultsForSynthesis is called
  //#then output contains a "no successful responses" message
  test("shows no successful responses message when all members fail", () => {
    const result = createResult({
      responses: [
        {
          member: { model: "openai/gpt-5.3-codex" },
          status: "error",
          error: "No output",
          taskId: "task-1",
          durationMs: 200,
        },
      ],
      totalMembers: 1,
      completedCount: 0,
      failedCount: 1,
    })

    const output = formatCouncilResultsForSynthesis(result)

    expect(output).toContain("No successful responses")
  })

  //#given members with custom names
  //#when formatCouncilResultsForSynthesis is called
  //#then output uses member.name if provided, falls back to member.model
  test("prefers custom member name and falls back to model", () => {
    const result = createResult({
      responses: [
        {
          member: { model: "openai/gpt-5.3-codex", name: "Council Alpha" },
          status: "completed",
          response: "Custom member response",
          taskId: "task-1",
          durationMs: 10,
        },
        {
          member: { model: "google/gemini-3-pro" },
          status: "completed",
          response: "Default member response",
          taskId: "task-2",
          durationMs: 11,
        },
      ],
      totalMembers: 2,
      completedCount: 2,
      failedCount: 0,
    })

    const output = formatCouncilResultsForSynthesis(result)

    expect(output).toContain("Council Alpha")
    expect(output).toContain("google/gemini-3-pro")
  })
})
