// The publish.yml job graph as data, for publish-release-tag-child-path.test.ts: which jobs wait for which, and which
// jobs publish. Kept apart from the test so its detector can also be run on synthetic workflows.

export interface Step {
  readonly name?: string
  readonly run?: string
  readonly uses?: string
  readonly env?: Record<string, string>
}

export interface Job {
  readonly needs?: string | readonly string[]
  readonly if?: string
  readonly uses?: string
  readonly steps?: readonly Step[]
}

export interface Workflow {
  readonly jobs: Readonly<Record<string, Job>>
}

export function needsOf(workflow: Workflow, job: string): string[] {
  const needs = workflow.jobs[job]?.needs ?? []
  return typeof needs === "string" ? [needs] : [...needs]
}

/** Every job `job` waits for, directly or through another job. */
export function upstreamOf(workflow: Workflow, job: string): Set<string> {
  const seen = new Set<string>()
  const pending = needsOf(workflow, job)
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (seen.has(next)) continue
    seen.add(next)
    pending.push(...needsOf(workflow, next))
  }
  return seen
}

export interface Unclassified {
  readonly job: string
  readonly step: string
  readonly command: string
}

export interface Publishers {
  /** Jobs that write release content outside the runner. */
  readonly publishers: string[]
  /** Publish-like commands or actions the detector cannot place; any entry must fail the caller. */
  readonly unclassified: Unclassified[]
}

/**
 * Jobs that write outside the runner without waiting for tag-prepared-source, each with the reason that is safe.
 * Every entry is a deliberate hole in "nothing is published before the release tag is right"; keep it visible.
 */
export const PRE_TAG_WRITERS: Readonly<Record<string, string>> = {
  "prepare-release-state":
    "pushes the release-state branch and opens its PR on the parent run only; with prepared_release_sha set it exits first",
  "dispatch-provenance-safe-publish": "parent run only (prepared_release_sha == ''); it creates the tag itself, then dispatches",
}

/** Actions that only set up the runner or move artifacts inside the run. */
const RUNNER_ACTIONS = /^(?:actions\/(?:checkout|setup-node|download-artifact|upload-artifact|cache)|oven-sh\/setup-bun)@/

/** Every form publish.yml uses to write outside the runner. */
const PUBLISH_FORMS: readonly RegExp[] = [
  /\b(?:npm|pnpm|bun|yarn)\s+(?:npm\s+)?publish\b/,
  /\bnpm\s+dist-tag\s+(?:add|rm)\b/,
  /\bgh\s+release\s+(?:create|upload|edit|delete)\b/,
  /\bgit\s+push\b/,
  /\bgh\s+pr\s+(?:create|merge|edit|close)\b/,
  /\bgh\s+workflow\s+run\b/,
]

/** Publish-like forms that only read. */
const READ_FORMS: readonly RegExp[] = [
  /\bgh\s+release\s+(?:view|list|download)\b/,
  /\bgh\s+pr\s+(?:view|list|checks)\b/,
  /\bcurl\b(?!.*\s(?:-X|--request|-d|--data[\w-]*|-T|--upload-file|-F|--form)\b)/,
]

/** Anything that looks like it might publish; a line matching this and no form above is unclassified. */
const PUBLISH_LIKE = /\b(?:publish|dist-tag|push|upload|deploy)\b|\bgh\s+(?:release|pr|workflow|api)\b|\bcurl\b|\btwine\b/

/** A `gh api` call writes unless it says GET: an explicit non-GET method, or a field flag (gh then sends POST). */
function ghApiWrites(line: string): boolean | undefined {
  if (!/\bgh\s+api\b/.test(line)) return undefined
  const method = /(?:-X|--method)\s+(\w+)/.exec(line)?.[1]
  if (method !== undefined) return method.toUpperCase() !== "GET"
  return /\s(?:-f|-F|--field|--raw-field|--input)\s/.test(line)
}

/** Shell command lines of a `run:` script: continuations joined, comment and echo/printf lines dropped. */
function commandLines(run: string): string[] {
  return run
    .replace(/\\\n\s*/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#") && !/^(?:echo|printf)\b/.test(line))
}

/** The line without its quoted text, so a message that mentions publishing is not read as a command. */
function unquoted(line: string): string {
  return line.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'[^']*'/g, "''")
}

type StepVerdict = "publishes" | "reads" | { readonly unclassified: string }

function classifyStep(step: Step): StepVerdict[] {
  if (step.uses !== undefined) return [RUNNER_ACTIONS.test(step.uses) ? "reads" : { unclassified: step.uses }]
  return commandLines(step.run ?? "").flatMap((line): StepVerdict[] => {
    const apiWrites = ghApiWrites(line)
    if (apiWrites !== undefined) return [apiWrites ? "publishes" : "reads"]
    if (PUBLISH_FORMS.some((form) => form.test(line))) return ["publishes"]
    if (READ_FORMS.some((form) => form.test(line)) || !PUBLISH_LIKE.test(unquoted(line))) return ["reads"]
    return [{ unclassified: line }]
  })
}

export function publishersOf(workflow: Workflow): Publishers {
  const publishers: string[] = []
  const unclassified: Unclassified[] = []
  for (const [name, job] of Object.entries(workflow.jobs)) {
    // A reusable workflow call is a publisher whatever it does: its steps are not in this file.
    let publishes = job.uses !== undefined
    for (const step of job.steps ?? []) {
      for (const verdict of classifyStep(step)) {
        if (verdict === "publishes") publishes = true
        else if (verdict !== "reads") unclassified.push({ job: name, step: step.name ?? step.uses ?? "", command: verdict.unclassified })
      }
    }
    if (publishes) publishers.push(name)
  }
  return { publishers, unclassified }
}
