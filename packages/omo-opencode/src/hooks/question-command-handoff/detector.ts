import { NEGATION_PATTERNS, SLASH_COMMAND_TOKEN_REGEX } from "./constants"

const CURLY_APOSTROPHE_REGEX = /[‘’ʼ]/g

export interface AnsweredQuestionOption {
  label: string
  description?: string
}

export interface AnsweredQuestion {
  question: string
  options: ReadonlyArray<AnsweredQuestionOption>
  multiple?: boolean
}

export interface ResolveAnsweredCommandArgs {
  questions: ReadonlyArray<AnsweredQuestion>
  answers: ReadonlyArray<ReadonlyArray<string>>
  knownCommandNames: ReadonlySet<string>
}

function containsNegationMarker(text: string): boolean {
  const normalized = text.replace(CURLY_APOSTROPHE_REGEX, "'")
  return NEGATION_PATTERNS.some((pattern) => pattern.test(normalized))
}

// Resolves the registered command a single-question, single-choice answer
// points at. Scoped so multi-question forms, multi-select answers, and typed
// custom answers never dispatch, and unregistered slash tokens (URLs, prose
// like "and/or") never match.
export function resolveAnsweredCommandReference(
  args: ResolveAnsweredCommandArgs,
): string | null {
  const { questions, answers, knownCommandNames } = args

  if (questions.length !== 1) return null

  const selectedLabels = answers[0]
  if (!selectedLabels || selectedLabels.length !== 1) return null

  const selectedLabel = selectedLabels[0]
  if (!selectedLabel) return null

  const question = questions[0]
  if (!question || question.multiple) return null

  const option = question.options.find((candidate) => candidate.label === selectedLabel)
  if (!option) return null

  const optionText = `${option.label}\n${option.description ?? ""}`.toLowerCase()
  if (containsNegationMarker(optionText)) return null

  SLASH_COMMAND_TOKEN_REGEX.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = SLASH_COMMAND_TOKEN_REGEX.exec(optionText)) !== null) {
    const token = match[1]
    if (token && knownCommandNames.has(token)) {
      return token
    }
  }

  return null
}
