export const SEED_HANDOFF_CHAR_LIMIT = 60_000
export const SEED_OPEN_TAG = "<omo-context-handoff-seed>"
export const CONTEXT_HANDOFF_REQUEST_OPEN_TAG = "<omo-context-handoff>"
// Second line of a seed; the number counts the chained handoffs that led to the seeded session.
export const SEED_GENERATION_PREFIX = "handoff-generation: "
const FALLBACK_MESSAGE_CHAR_LIMIT = 4_000

export type CompactionFailureKind =
  | "compaction_error"
  | "compaction_rejected"
  | "over_limit_after_compaction"
  | "repeated_compaction"
  | "context_overflow"

export interface CompactionFailure {
  readonly kind: CompactionFailureKind
  readonly detail: string
}

export interface HandoffRequestInput {
  readonly failure: CompactionFailure
  readonly handoffPath: string
}

export function buildHandoffRequest(input: HandoffRequestInput): string {
  return [
    CONTEXT_HANDOFF_REQUEST_OPEN_TAG,
    `Context compaction failed (${input.failure.kind}: ${input.failure.detail}). omo will continue this work in a FRESH session seeded with a handoff you write now.`,
    "Do not start anything new. Finish or cleanly pause the current step, then write a complete Markdown handoff to:",
    input.handoffPath,
    "It must let a new session with no memory of this conversation continue without asking anything:",
    "1. Your role, the task, and how you report progress.",
    "2. Every standing rule and constraint the user gave, including what you were told not to do.",
    "3. Hosts, paths, branches, commands, and versions in use.",
    "4. Every open or queued item with its exact state and next step, in order.",
    "5. The active goal objective verbatim and its success criteria, if a goal is set.",
    "6. Every persistent monitor or background process with the exact command to re-arm it.",
    "Write the file with your file-writing tool, reply with one line `HANDOFF_WRITTEN <path>`, and end your turn. omo then starts the fresh session automatically.",
    "</omo-context-handoff>",
  ].join("\n")
}

export interface FallbackHandoffInput {
  readonly failure: CompactionFailure
  readonly agentError: string | undefined
  readonly previousSessionFile: string | undefined
  readonly recentUserMessages: readonly string[]
}

export function buildFallbackHandoff(input: FallbackHandoffInput): string {
  return [
    "# Automatic handoff (written by omo)",
    "",
    `The previous session's context compaction failed (${input.failure.kind}: ${input.failure.detail}) and the agent could not write its own handoff${input.agentError === undefined ? "" : ` (${input.agentError})`}.`,
    input.previousSessionFile === undefined
      ? "The previous session file is unknown."
      : `Read the previous session transcript for full detail: ${input.previousSessionFile}`,
    "",
    "## Most recent user messages (oldest first)",
    "",
    ...input.recentUserMessages.flatMap((message, index) => [
      `### ${index + 1}`,
      "",
      message.length > FALLBACK_MESSAGE_CHAR_LIMIT ? `${message.slice(0, FALLBACK_MESSAGE_CHAR_LIMIT)}\n[truncated]` : message,
      "",
    ]),
  ].join("\n")
}

export interface FreshSessionSeedInput {
  readonly handoff: string
  readonly handoffPath: string
  readonly previousSessionFile: string | undefined
  readonly failure: CompactionFailure | undefined
  readonly goalObjective: string | undefined
  readonly generation: number
}

export function buildFreshSessionSeed(input: FreshSessionSeedInput): string {
  const truncated = input.handoff.length > SEED_HANDOFF_CHAR_LIMIT
  const body = truncated ? input.handoff.slice(0, SEED_HANDOFF_CHAR_LIMIT) : input.handoff
  const why = input.failure === undefined
    ? "The previous session was replaced on request"
    : `The previous session was replaced because its context compaction failed (${input.failure.kind}: ${input.failure.detail})`
  return [
    SEED_OPEN_TAG,
    `${SEED_GENERATION_PREFIX}${input.generation}`,
    `This is a fresh session that continues a previous session in the same working directory. ${why}; it wrote the handoff below.`,
    `Handoff file: ${input.handoffPath}`,
    ...(input.previousSessionFile === undefined ? [] : [`Previous session file: ${input.previousSessionFile}`]),
    ...(input.goalObjective === undefined
      ? []
      : ["The previous session had this active goal; register it again with the goal tool before continuing:", input.goalObjective]),
    "Read the handoff, re-arm any persistent monitors it lists, then continue the open items in the order given. Do not redo finished work.",
    ...(truncated ? [`The handoff is longer than ${SEED_HANDOFF_CHAR_LIMIT} characters; read the rest from the handoff file.`] : []),
    "<handoff>",
    body,
    "</handoff>",
    "</omo-context-handoff-seed>",
  ].join("\n")
}
