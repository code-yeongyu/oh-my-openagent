import type { ExtensionContext, ToolDefinition } from "@code-yeongyu/senpi"
import { Type, type Static } from "typebox"

import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"

const CUSTOM_OPTION = "Type something."
const DONE_OPTION = "Done"

const QuestionOptionSchema = Type.Object({
  label: Type.String({
    minLength: 1,
    description: "Short option label displayed to the user",
  }),
  description: Type.String({
    description: "Explanation of the option's effect or trade-off",
  }),
})

const QuestionSchema = Type.Object({
  question: Type.String({
    minLength: 1,
    description: "Complete question ending with a question mark",
  }),
  header: Type.String({
    minLength: 1,
    maxLength: 12,
    description: "Short category label shown before the question",
  }),
  options: Type.Array(QuestionOptionSchema, {
    minItems: 2,
    maxItems: 4,
    description: "Two to four concrete choices",
  }),
  multiSelect: Type.Boolean({
    description: "Whether the user may choose more than one answer",
  }),
})

const AskQuestionParams = Type.Object({
  questions: Type.Array(QuestionSchema, {
    minItems: 1,
    maxItems: 4,
    description: "One to four questions to present in order",
  }),
})

type AskQuestionParams = Static<typeof AskQuestionParams>
type Question = AskQuestionParams["questions"][number]

interface QuestionResult {
  answers: Record<string, string>
  cancelled: boolean
}

type DialogContext = Pick<ExtensionContext, "mode" | "hasUI" | "ui">

export function createAskQuestionComponent(): OmoSenpiComponent {
  return {
    name: "ask-question",
    register(pi: SenpiExtensionAPI, _ctx: ComponentContext): void {
      pi.registerRemovedToolHint?.(
        "AskUserQuestion",
        "Use ask_question instead; it supports both TUI and RPC dialog hosts.",
      )
      pi.registerRemovedToolHint?.(
        "askForQuestion",
        "Use ask_question instead; it supports both TUI and RPC dialog hosts.",
      )
      pi.registerTool(askQuestionTool)
    },
  }
}

const askQuestionTool = {
  name: "ask_question",
  label: "Ask Question",
  description:
    "Ask the user one to four clarifying questions and wait for their answers. " +
    "Use this instead of Claude Code's AskUserQuestion tool. " +
    "Each question supports two to four described options and optional free-text input.",
  promptSnippet: "Ask the user structured clarifying questions through the interactive UI",
  parameters: AskQuestionParams,
  executionMode: "sequential",
  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    if (!ctx.hasUI) {
      return result(
        `Unable to ask the user: interactive UI is not available in ${ctx.mode} mode.`,
        {},
        true,
      )
    }

    const answers: Record<string, string> = {}
    for (const question of params.questions) {
      const answer = question.multiSelect
        ? await askMultiple(ctx, question)
        : await askSingle(ctx, question)
      if (answer === undefined) return result("Question cancelled by the user.", answers, true)
      answers[question.question] = answer
    }

    return result(formatAnswers(answers), answers, false)
  },
} satisfies ToolDefinition<typeof AskQuestionParams, QuestionResult>

async function askSingle(ctx: DialogContext, question: Question): Promise<string | undefined> {
  const choices = question.options.map(formatOption)
  const selected = await ctx.ui.select(questionTitle(question), [...choices, CUSTOM_OPTION])
  if (selected === undefined) return undefined
  if (selected === CUSTOM_OPTION) return askCustom(ctx, question)

  return question.options.find((option) => formatOption(option) === selected)?.label
}

async function askMultiple(ctx: DialogContext, question: Question): Promise<string | undefined> {
  const selected: string[] = []
  const remaining = [...question.options]

  while (true) {
    const choices = remaining.map(formatOption)
    const doneLabel = selected.length === 0 ? `${DONE_OPTION} (select at least one)` : DONE_OPTION
    const choice = await ctx.ui.select(questionTitle(question), [...choices, CUSTOM_OPTION, doneLabel])
    if (choice === undefined) return undefined
    if (choice === DONE_OPTION) return selected.join(", ")
    if (choice === doneLabel) continue

    if (choice === CUSTOM_OPTION) {
      const custom = await askCustom(ctx, question)
      if (custom === undefined) return undefined
      selected.push(custom)
      continue
    }

    const index = remaining.findIndex((option) => formatOption(option) === choice)
    if (index < 0) return undefined
    const [option] = remaining.splice(index, 1)
    if (option !== undefined) selected.push(option.label)
  }
}

async function askCustom(ctx: DialogContext, question: Question): Promise<string | undefined> {
  const answer = await ctx.ui.input(questionTitle(question), "Type your answer")
  const trimmed = answer?.trim()
  return trimmed ? trimmed : undefined
}

function questionTitle(question: Question): string {
  return `${question.header}: ${question.question}`
}

function formatOption(option: Question["options"][number]): string {
  return option.description ? `${option.label} — ${option.description}` : option.label
}

function formatAnswers(answers: Record<string, string>): string {
  return Object.entries(answers)
    .map(([question, answer]) => `${question}: ${answer}`)
    .join("\n")
}

function result(text: string, answers: Record<string, string>, cancelled: boolean) {
  return {
    content: [{ type: "text" as const, text }],
    details: { answers, cancelled } satisfies QuestionResult,
  }
}
