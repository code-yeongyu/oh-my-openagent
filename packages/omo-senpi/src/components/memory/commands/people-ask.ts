// Dialectic-lite: a quick child that answers one question about one person from
// the evidence the command already gathered (card, observations, /search hits).
//
// Read-only by construction: the child gets its evidence inline, runs with no
// tools, and its answer is rendered through the command's notify seam, so it
// never enters model context. Abstention is the default register: an honest
// "I don't know" outranks a guess.

import { spawn } from "node:child_process"

import type { OmoConfig } from "@oh-my-opencode/omo-config-core"
import type { SenpiModelPort, SenpiModelRegistryPort } from "@oh-my-opencode/senpi-task"

import { resolveSenpiLaunch } from "../worker/senpi-command"
import { resolveReflectionModel } from "../worker/resolve-model"

const QUICK_CATEGORY = "quick"
const DEFAULT_DEADLINE_MS = 120_000
const MAX_OUTPUT_BYTES = 32 * 1024

export const ABSTENTION_LINE = "I don't know: the memory holds no evidence that answers this."

export interface PeopleAskEvidence {
  readonly card: readonly string[]
  readonly observations: readonly string[]
  readonly searchHits: readonly string[]
}
export interface PeopleAskRequest {
  readonly slug: string
  readonly displayName: string
  readonly question: string
  readonly evidence: PeopleAskEvidence
}

export type PeopleAskRunner = (request: PeopleAskRequest) => Promise<string>

export interface PeopleAskOptions {
  readonly config: OmoConfig
  readonly registry: SenpiModelRegistryPort<SenpiModelPort> | undefined
  readonly env?: NodeJS.ProcessEnv
  readonly senpiCommand?: string
  readonly senpiPrefixArgs?: readonly string[]
  readonly deadlineMs?: number
}

/** True when nothing in the memory can support an answer, so the child is never launched. */
export function hasNoEvidence(evidence: PeopleAskEvidence): boolean {
  return evidence.card.length === 0 && evidence.observations.length === 0 && evidence.searchHits.length === 0
}

const PERSONA = [
  "You answer one question about one person using ONLY the evidence supplied below.",
  "A confident \"I don't know\" is always correct: when the evidence does not settle the question, say so plainly and stop.",
  "Never invent a fact, never infer a trait the evidence does not state, and never speculate about intent.",
  "Cite the evidence you relied on by quoting its line. Keep the answer under 120 words.",
  "Explicit observations are stated facts; deductive, inductive, and contradiction observations are weaker and MUST be labelled as such when used.",
].join("\n")

export function buildAskPrompt(request: PeopleAskRequest): string {
  const sections = [
    `Person: ${request.displayName} (${request.slug})`,
    `Question: ${request.question}`,
    "",
    "CARD",
    ...(request.evidence.card.length === 0 ? ["(none)"] : request.evidence.card),
    "",
    "OBSERVATIONS",
    ...(request.evidence.observations.length === 0 ? ["(none)"] : request.evidence.observations),
    "",
    "SEARCH HITS",
    ...(request.evidence.searchHits.length === 0 ? ["(none)"] : request.evidence.searchHits),
  ]
  return sections.join("\n")
}

/**
 * Production runner: a `senpi -p` quick child, deadline-bounded and tool-free.
 * Returns the abstention line when no quick model is available, because a
 * missing model is exactly a state in which nothing is known.
 */
export function createPeopleAskRunner(options: PeopleAskOptions): PeopleAskRunner {
  return async (request: PeopleAskRequest): Promise<string> => {
    const resolution = resolveReflectionModel(QUICK_CATEGORY, options.config, options.registry)
    if (resolution.kind !== "resolved") return ABSTENTION_LINE
    const env = options.env ?? process.env
    const args = [
      "-p",
      "--system-prompt", PERSONA,
      "--tools", "none",
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--no-context-files",
      "--model", resolution.model,
      ...(resolution.thinking === undefined ? [] : ["--thinking", resolution.thinking]),
      buildAskPrompt(request),
    ]
    const launch = options.senpiCommand === undefined
      ? resolveSenpiLaunch(env)
      : { command: options.senpiCommand, prefixArgs: options.senpiPrefixArgs ?? [] }
    const answer = await runChild(
      launch.command,
      [...launch.prefixArgs, ...args],
      env,
      options.deadlineMs ?? DEFAULT_DEADLINE_MS,
    )
    return answer.length === 0 ? ABSTENTION_LINE : answer
  }
}

function runChild(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  deadlineMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: env.HOME ?? process.cwd(),
      env: { ...env, SENPI_PTY_FORCE_PIPE: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    })
    let stdout = ""
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill("SIGKILL")
      resolve(ABSTENTION_LINE)
    }, deadlineMs)
    timer.unref?.()

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT_BYTES) stdout += chunk.toString("utf8")
    })
    child.on("error", (error: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    child.on("close", (code: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(code === 0 ? stdout.trim() : ABSTENTION_LINE)
    })
  })
}
