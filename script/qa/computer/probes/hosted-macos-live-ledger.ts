// Ledger rows of the hosted-macOS live probe.
//
// One row per question per runner image. A verdict says what the runner measured, never what we hoped:
//   CONFIRMS     the runner allowed the leg and an independent read proved its effect
//   CONTRADICTS  the leg ran and the runner refused it (or its effect did not show)
//   UNMEASURED   a precondition failed, so the leg could not be asked; the evidence names the precondition

export const QUESTIONS = ["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8"] as const
export type Question = (typeof QUESTIONS)[number]

export const IMAGES = ["macos-15", "macos-26"] as const

const VERDICTS = ["CONFIRMS", "CONTRADICTS", "UNMEASURED"] as const
export type Verdict = (typeof VERDICTS)[number]

export type LedgerRow = {
  readonly question: Question
  readonly image: string
  readonly verdict: Verdict
  readonly evidence: string
  readonly rerun: string
}

export const LEDGER_HEADER = "question\timage\tverdict\tevidence\trerun"

const LIVE_TIER_QUESTIONS: readonly Question[] = ["q2", "q3", "q4", "q6"]

function cell(text: string): string {
  return text.replace(/[\t\r\n]+/g, " ").trim()
}

export function rerunCommand(question: Question, image: string): string {
  return `bun script/qa/computer/probes/hosted-macos-live.ts --question ${question} (GitHub-hosted ${image} runner)`
}

export function formatRow(row: LedgerRow): string {
  return [row.question, row.image, row.verdict, row.evidence, row.rerun].map(cell).join("\t")
}

function isQuestion(value: string): value is Question {
  return (QUESTIONS as readonly string[]).includes(value)
}

function isVerdict(value: string): value is Verdict {
  return (VERDICTS as readonly string[]).includes(value)
}

export function parseLedger(text: string): LedgerRow[] {
  const lines = text.split("\n").filter((line) => line !== "")
  if (lines[0] !== LEDGER_HEADER) throw new Error(`ledger header must be "${LEDGER_HEADER}"`)
  return lines.slice(1).map((line, index) => {
    const cells = line.split("\t")
    const [question = "", image = "", verdict = "", evidence = "", rerun = ""] = cells
    const where = `ledger line ${index + 2}`
    if (cells.length !== 5) throw new Error(`${where}: expected 5 cells, got ${cells.length}`)
    if (!isQuestion(question)) throw new Error(`${where}: unknown question "${question}"`)
    if (!isVerdict(verdict)) throw new Error(`${where}: unknown verdict "${verdict}"`)
    if (image === "" || evidence === "" || rerun === "") throw new Error(`${where}: empty cell`)
    return { question, image, verdict, evidence, rerun }
  })
}

export function mergeLedgers(texts: readonly string[]): string {
  const rows = texts.flatMap(parseLedger)
  const seen = new Set<string>()
  for (const row of rows) {
    const key = `${row.question}@${row.image}`
    if (seen.has(key)) throw new Error(`duplicate ledger row ${key}`)
    seen.add(key)
  }
  rows.sort((a, b) => a.image.localeCompare(b.image) || QUESTIONS.indexOf(a.question) - QUESTIONS.indexOf(b.question))
  return `${[LEDGER_HEADER, ...rows.map(formatRow)].join("\n")}\n`
}

export function decideHostedMacosLive(rows: readonly LedgerRow[]): "yes" | "no" {
  const confirmed = (question: Question, image: string) =>
    rows.some((row) => row.question === question && row.image === image && row.verdict === "CONFIRMS")
  return IMAGES.every((image) => LIVE_TIER_QUESTIONS.every((question) => confirmed(question, image))) ? "yes" : "no"
}

export type HostFacts = {
  readonly platform: string
  readonly githubActions: string | undefined
  readonly runnerEnvironment: string | undefined
  readonly image: string | undefined
}

/**
 * The probe edits the system TCC database, so it refuses every host that is not a throwaway GitHub-hosted macOS
 * runner: a fleet Mac or a person's session must never run it. Returns the refusal reason, or null to proceed.
 */
export function unsupportedHostReason(facts: HostFacts): string | null {
  if (facts.platform !== "darwin") return `platform is ${facts.platform}, not darwin`
  if (facts.githubActions !== "true") return "GITHUB_ACTIONS is not true"
  if (facts.runnerEnvironment !== "github-hosted") return "RUNNER_ENVIRONMENT is not github-hosted"
  if (facts.image === undefined || !(IMAGES as readonly string[]).includes(facts.image))
    return `PROBE_IMAGE must be one of ${IMAGES.join(", ")}`
  return null
}
