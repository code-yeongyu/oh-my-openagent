import { createBeadsRuntimeContractError } from "./errors"

export type BeadsRuntimeReadCommandName = "ready" | "list-in-progress" | "show"

export type BeadsRuntimeIssueSummary = {
  id: string
  title: string
} & Record<string, unknown>

export type BeadsRuntimeReadyResult = BeadsRuntimeIssueSummary[]

export interface BeadsRuntimeListResult extends Record<string, unknown> {
  issues: BeadsRuntimeIssueSummary[]
  total: number
  limit: number
  offset: number
  has_more: boolean
}

export type BeadsRuntimeShowResult = BeadsRuntimeIssueSummary[]

export interface BeadsRuntimeCliContract<T> {
  name: BeadsRuntimeReadCommandName
  command: readonly string[]
  helpCommand: readonly string[]
  requiredFlags: readonly string[]
  requiredForRuntime: boolean
  parse(stdout: string): T
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseJson(stdout: string, name: BeadsRuntimeReadCommandName): unknown {
  try {
    return JSON.parse(stdout)
  } catch (error) {
    throw createBeadsRuntimeContractError({
      message: `beads runtime expected valid JSON from br ${name} --json`,
      details: {
        command: name,
        error: error instanceof Error ? error.message : String(error),
      },
    })
  }
}

function parseIssueSummary(
  value: unknown,
  name: BeadsRuntimeReadCommandName,
): BeadsRuntimeIssueSummary {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.title !== "string") {
    throw createBeadsRuntimeContractError({
      message: `beads runtime expected br ${name} --json items to include string id and title fields`,
      details: { command: name, received: value },
    })
  }

  return value as BeadsRuntimeIssueSummary
}

export function parseBeadsRuntimeReadyResult(
  stdout: string,
): BeadsRuntimeReadyResult {
  const parsed = parseJson(stdout, "ready")
  if (!Array.isArray(parsed)) {
    throw createBeadsRuntimeContractError({
      message: "beads runtime expected br ready --json to return a top-level array",
      details: { received: parsed },
    })
  }

  return parsed.map((item) => parseIssueSummary(item, "ready"))
}

export function parseBeadsRuntimeListResult(stdout: string): BeadsRuntimeListResult {
  const parsed = parseJson(stdout, "list-in-progress")
  if (!isRecord(parsed) || !Array.isArray(parsed.issues)) {
    throw createBeadsRuntimeContractError({
      message: "beads runtime expected br list --status in_progress --json to return an issues page",
      details: { received: parsed },
    })
  }

  if (
    typeof parsed.total !== "number"
    || typeof parsed.limit !== "number"
    || typeof parsed.offset !== "number"
    || typeof parsed.has_more !== "boolean"
  ) {
    throw createBeadsRuntimeContractError({
      message: "beads runtime expected br list --status in_progress --json to include total, limit, offset, and has_more",
      details: { received: parsed },
    })
  }

  return {
    ...parsed,
    issues: parsed.issues.map((item) => parseIssueSummary(item, "list-in-progress")),
    total: parsed.total,
    limit: parsed.limit,
    offset: parsed.offset,
    has_more: parsed.has_more,
  }
}

export function parseBeadsRuntimeShowResult(stdout: string): BeadsRuntimeShowResult {
  const parsed = parseJson(stdout, "show")
  if (!Array.isArray(parsed)) {
    throw createBeadsRuntimeContractError({
      message: "beads runtime expected br show <id> --json to return a detail array",
      details: { received: parsed },
    })
  }

  return parsed.map((item) => parseIssueSummary(item, "show"))
}

export const BEADS_RUNTIME_READY_CLI_CONTRACT: BeadsRuntimeCliContract<BeadsRuntimeReadyResult> = {
  name: "ready",
  command: ["br", "ready", "--json"],
  helpCommand: ["br", "ready", "--help"],
  requiredFlags: ["--json"],
  requiredForRuntime: true,
  parse: parseBeadsRuntimeReadyResult,
}

export const BEADS_RUNTIME_LIST_IN_PROGRESS_CLI_CONTRACT: BeadsRuntimeCliContract<BeadsRuntimeListResult> = {
  name: "list-in-progress",
  command: ["br", "list", "--status", "in_progress", "--json"],
  helpCommand: ["br", "list", "--help"],
  requiredFlags: ["--status", "--json"],
  requiredForRuntime: true,
  parse: parseBeadsRuntimeListResult,
}

export const BEADS_RUNTIME_SHOW_CLI_CONTRACT: BeadsRuntimeCliContract<BeadsRuntimeShowResult> = {
  name: "show",
  command: ["br", "show", "<bead-id>", "--json"],
  helpCommand: ["br", "show", "--help"],
  requiredFlags: ["--json"],
  requiredForRuntime: false,
  parse: parseBeadsRuntimeShowResult,
}

export const BEADS_RUNTIME_CLI_CONTRACTS: readonly BeadsRuntimeCliContract<unknown>[] = [
  BEADS_RUNTIME_READY_CLI_CONTRACT,
  BEADS_RUNTIME_LIST_IN_PROGRESS_CLI_CONTRACT,
  BEADS_RUNTIME_SHOW_CLI_CONTRACT,
]
