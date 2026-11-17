// The publish.yml job graph as data, for publish-release-tag-child-path.test.ts: which jobs wait for which, and which
// jobs publish. Kept apart from the test so its detector can also be run on synthetic workflows.

export interface Step {
  readonly name?: string
  readonly if?: string
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

export interface PreTagWriter {
  /** Why writing before tag-prepared-source is safe for this job. */
  readonly reason: string
  /** The condition, in the job's or each writing step's `if`, that keeps every write off the child run. */
  readonly guard: string
}

/**
 * Jobs that write outside the runner without waiting for tag-prepared-source. Every entry is a deliberate hole in
 * "nothing is published before the release tag is right"; its guard is asserted, so removing it fails the row.
 */
export const PRE_TAG_WRITERS: Readonly<Record<string, PreTagWriter>> = {
  "prepare-release-state": {
    reason: "pushes the release-state branch and opens its PR on the parent run only; a child run's generation sets needs_push=false",
    guard: "steps.prepare.outputs.needs_push == 'true'",
  },
  "dispatch-provenance-safe-publish": {
    reason: "runs on the parent run only; it creates the tag itself, then dispatches the child on it",
    guard: "inputs.prepared_release_sha == ''",
  },
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
const READ_FORMS: readonly RegExp[] = [/\bgh\s+release\s+(?:view|list|download)\b/, /\bgh\s+pr\s+(?:view|list|checks)\b/]

/** Anything that looks like it might publish; a command matching this and no form above is unclassified. */
const PUBLISH_LIKE = /\b(?:publish|dist-tag|push|upload|deploy)\b|\bgh\s+(?:release|pr|workflow|api)\b|\bcurl\b|\btwine\b/

/** The HTTP method a `-X`/`--method`/`--request` flag names, in any spelling: `-X PUT`, `-XPUT`, `--method=PUT`. */
function methodOf(command: string): string | undefined {
  return /(?:^|\s)(?:-X\s*|--method(?:\s+|=)|--request(?:\s+|=))([A-Za-z]+)/.exec(command)?.[1]?.toUpperCase()
}

/** A `gh api` call writes unless it says GET: an explicit non-GET method, or a field flag (gh then sends POST). */
function ghApiWrites(command: string): boolean | undefined {
  if (!/\bgh\s+api\b/.test(command)) return undefined
  const method = methodOf(command)
  if (method !== undefined) return method !== "GET"
  return /(?:^|\s)(?:-f|-F|--field|--raw-field|--input)(?:\s|=|$)/.test(command)
}

/** A `curl` call writes with a non-GET/HEAD method or any body flag, including clustered short flags (`-sd`). */
function curlWrites(command: string): boolean | undefined {
  if (!/\bcurl\b/.test(command)) return undefined
  const method = methodOf(command)
  if (method !== undefined && method !== "GET" && method !== "HEAD") return true
  return /(?:^|\s)(?:-[A-Za-z]*[dTF]|--data[\w-]*|--upload-file|--form[\w-]*|--json)(?:\s|=|$)/.test(command)
}

interface Command {
  /** The command as written. */
  readonly text: string
  /** The command with quoted text removed, so a message that mentions publishing is not read as a command. */
  readonly bare: string
}

/**
 * The simple commands of a `run:` script. It splits at newlines, `;`, `&`, `|` (so `&&` and `||`), backticks and `$(...)`
 * outside quotes, and a `$(...)` inside double quotes is a command of its own. Comments are dropped.
 */
function commandsOf(run: string): Command[] {
  const commands: Command[] = []
  const contexts: string[] = []
  let text = ""
  let bare = ""
  const flush = (): void => {
    if (text.trim() !== "") commands.push({ text: text.trim(), bare: bare.trim() })
    text = ""
    bare = ""
  }
  const source = run.replace(/\\\n/g, " ")
  for (let i = 0; i < source.length; i++) {
    const c = source.charAt(i)
    const context = contexts.at(-1)
    const opensSubstitution = c === "$" && source.charAt(i + 1) === "("
    if (context === "'") {
      if (c === "'") contexts.pop()
      text += c
    } else if (context === '"') {
      if (opensSubstitution) {
        flush()
        contexts.push("$(")
        i++
      } else if (c === "\\") {
        text += c + source.charAt(i + 1)
        i++
      } else {
        if (c === '"') contexts.pop()
        text += c
      }
    } else if (c === "\\") {
      text += c + source.charAt(i + 1)
      bare += c + source.charAt(i + 1)
      i++
    } else if (c === "#" && /(?:^|\s)$/.test(text)) {
      while (i + 1 < source.length && source.charAt(i + 1) !== "\n") i++
    } else if (c === "'" || c === '"') {
      contexts.push(c)
      text += c
    } else if (opensSubstitution) {
      flush()
      contexts.push("$(")
      i++
    } else if (c === ")" && context === "$(") {
      flush()
      contexts.pop()
    } else if (c === "\n" || c === ";" || c === "&" || c === "|" || c === "`") {
      flush()
    } else {
      text += c
      bare += c
    }
  }
  flush()
  return commands
}

/** A command that only prints: echo or printf, after any shell keywords and variable assignments. */
const PRINTS = /^(?:(?:if|then|else|elif|do|while|until|!|\{)\s+)*(?:\w+=\S*\s+)*(?:echo|printf)\b/

type StepVerdict = "publishes" | "reads" | { readonly unclassified: string }

function classifyCommand({ text, bare }: Command): StepVerdict {
  if (PRINTS.test(bare)) return "reads"
  const apiWrites = ghApiWrites(bare)
  if (apiWrites !== undefined) return apiWrites ? "publishes" : "reads"
  if (PUBLISH_FORMS.some((form) => form.test(bare))) return "publishes"
  if (curlWrites(bare) === true) return { unclassified: text }
  if (curlWrites(bare) === false || READ_FORMS.some((form) => form.test(bare)) || !PUBLISH_LIKE.test(bare)) return "reads"
  return { unclassified: text }
}

function classifyStep(step: Step): StepVerdict[] {
  if (step.uses !== undefined) return [RUNNER_ACTIONS.test(step.uses) ? "reads" : { unclassified: step.uses }]
  return commandsOf(step.run ?? "").map(classifyCommand)
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
