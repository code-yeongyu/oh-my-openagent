/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentLogger } from "../../extension/types"
import { createAskQuestionComponent } from "./index"

interface QuestionTool {
  execute(
    toolCallId: string,
    params: {
      questions: Array<{
        question: string
        header: string
        options: Array<{ label: string; description: string }>
        multiSelect: boolean
      }>
    },
    signal: AbortSignal | undefined,
    onUpdate: undefined,
    ctx: {
      mode: "tui" | "rpc" | "print"
      hasUI: boolean
      ui: {
        select(title: string, options: string[]): Promise<string | undefined>
        input(title: string, placeholder?: string): Promise<string | undefined>
      }
    },
  ): Promise<{
    content: Array<{ type: "text"; text: string }>
    details: {
      answers: Record<string, string>
      cancelled: boolean
    }
  }>
}

function fakeContext() {
  const logger: ComponentLogger = {
    info() {},
    warn() {},
    error() {},
  }
  return {
    logger,
    config: { getFlag: () => undefined },
  }
}

function registeredTool(pi: FakeExtensionAPI): QuestionTool {
  return pi.tools.find((tool) => tool.name === "ask_question") as unknown as QuestionTool
}

describe("createAskQuestionComponent", () => {
  it("#given the component registers #then exposes the Claude-compatible ask_question contract", async () => {
    const pi = new FakeExtensionAPI()

    await createAskQuestionComponent().register(pi, fakeContext())

    expect(pi.tools).toHaveLength(1)
    expect(pi.tools[0]).toMatchObject({
      name: "ask_question",
      label: "Ask Question",
      executionMode: "sequential",
    })
    expect(pi.removedToolHints).toEqual(
      ["AskUserQuestion", "askForQuestion"].map((name) => ({
        name,
        hint: "Use ask_question instead; it supports both TUI and RPC dialog hosts.",
      })),
    )
  })

  it.each(["tui", "rpc"] as const)(
    "#given $mode dialog UI #when the user selects an option #then returns the answer",
    async (mode) => {
      const pi = new FakeExtensionAPI()
      await createAskQuestionComponent().register(pi, fakeContext())
      const selections: Array<{ title: string; options: string[] }> = []

      const result = await registeredTool(pi).execute(
        "call-1",
        {
          questions: [
            {
              question: "Which behavior should remain?",
              header: "Behavior",
              options: [
                { label: "Keep", description: "Preserve current behavior" },
                { label: "Replace", description: "Use the new behavior" },
              ],
              multiSelect: false,
            },
          ],
        },
        undefined,
        undefined,
        {
          mode,
          hasUI: true,
          ui: {
            async select(title, options) {
              selections.push({ title, options })
              return "Keep — Preserve current behavior"
            },
            async input() {
              return undefined
            },
          },
        },
      )

      expect(selections).toEqual([
        {
          title: "Behavior: Which behavior should remain?",
          options: [
            "Keep — Preserve current behavior",
            "Replace — Use the new behavior",
            "Type something.",
          ],
        },
      ])
      expect(result.details).toEqual({
        answers: { "Which behavior should remain?": "Keep" },
        cancelled: false,
      })
      expect(result.content[0]?.text).toContain("Which behavior should remain?: Keep")
    },
  )

  it("#given the user chooses custom input #when text is entered #then returns that text", async () => {
    const pi = new FakeExtensionAPI()
    await createAskQuestionComponent().register(pi, fakeContext())

    const result = await registeredTool(pi).execute(
      "call-2",
      {
        questions: [
          {
            question: "What should the command be called?",
            header: "Name",
            options: [
              { label: "ask_question", description: "Use snake case" },
              { label: "question", description: "Use a short name" },
            ],
            multiSelect: false,
          },
        ],
      },
      undefined,
      undefined,
      {
        mode: "rpc",
        hasUI: true,
        ui: {
          async select() {
            return "Type something."
          },
          async input() {
            return "ask_user"
          },
        },
      },
    )

    expect(result.details).toEqual({
      answers: { "What should the command be called?": "ask_user" },
      cancelled: false,
    })
  })

  it("#given a multi-select question #when choices are selected and submitted #then returns all labels", async () => {
    const pi = new FakeExtensionAPI()
    await createAskQuestionComponent().register(pi, fakeContext())
    const choices = ["Tests — Add regression coverage", "Docs — Update the guide", "Done"]

    const result = await registeredTool(pi).execute(
      "call-3",
      {
        questions: [
          {
            question: "Which changes should be included?",
            header: "Scope",
            options: [
              { label: "Tests", description: "Add regression coverage" },
              { label: "Docs", description: "Update the guide" },
            ],
            multiSelect: true,
          },
        ],
      },
      undefined,
      undefined,
      {
        mode: "tui",
        hasUI: true,
        ui: {
          async select() {
            return choices.shift()
          },
          async input() {
            return undefined
          },
        },
      },
    )

    expect(result.details).toEqual({
      answers: { "Which changes should be included?": "Tests, Docs" },
      cancelled: false,
    })
  })

  it("#given no dialog-capable UI #when executed #then fails without waiting", async () => {
    const pi = new FakeExtensionAPI()
    await createAskQuestionComponent().register(pi, fakeContext())

    const result = await registeredTool(pi).execute(
      "call-4",
      {
        questions: [
          {
            question: "Continue?",
            header: "Confirm",
            options: [
              { label: "Yes", description: "Continue" },
              { label: "No", description: "Stop" },
            ],
            multiSelect: false,
          },
        ],
      },
      undefined,
      undefined,
      {
        mode: "print",
        hasUI: false,
        ui: {
          async select() {
            throw new Error("select must not be called")
          },
          async input() {
            throw new Error("input must not be called")
          },
        },
      },
    )

    expect(result.details).toEqual({ answers: {}, cancelled: true })
    expect(result.content).toEqual([
      {
        type: "text",
        text: "Unable to ask the user: interactive UI is not available in print mode.",
      },
    ])
  })
})
