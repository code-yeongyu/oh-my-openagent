import {
  combineRuns,
  type Facts,
  type Reading,
  type Verdict,
  verdictDisconnect,
  verdictElevated,
  verdictLock,
  verdictMixedDpi,
  verdictSecureDesktop,
} from "./windows-full-verdicts.ts"

export type LegId = "elevated" | "lock" | "disconnect" | "mixed-dpi" | "secure-desktop"
type Leg = {
  readonly leg: LegId
  readonly question: string
  readonly job: "host" | "session"
  readonly judge: (f: Facts) => Reading
}

export const LEGS: readonly Leg[] = [
  {
    leg: "elevated",
    question: "q1 can the engine run at medium integrity beside an elevated fixture",
    job: "host",
    judge: verdictElevated,
  },
  {
    leg: "lock",
    question: "q2 can the session be locked and unlocked from a scheduled task",
    job: "session",
    judge: verdictLock,
  },
  {
    leg: "disconnect",
    question: "q3 can the session be disconnected and reconnected",
    job: "session",
    judge: verdictDisconnect,
  },
  {
    leg: "mixed-dpi",
    question: "q4 can a second virtual monitor at 150 % scaling be added through an indirect display driver",
    job: "host",
    judge: verdictMixedDpi,
  },
  {
    leg: "secure-desktop",
    question: "q5 is the elevation prompt's secure desktop reachable for the refusal leg",
    job: "host",
    judge: verdictSecureDesktop,
  },
]

const VERDICTS: readonly Verdict[] = ["CONFIRMS", "CONTRADICTS", "UNMEASURED"]
const HEADER = "question\tleg\tverdict\tevidence\trerun\thost\tmeasured_at"
const PROBE = "script/qa/computer/probes/hosted-windows-live.ps1"

export function parseFacts(text: string): { readonly facts: readonly Facts[]; readonly rejected: number } {
  const facts: Facts[] = []
  let rejected = 0
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "") continue
    try {
      const v: unknown = JSON.parse(line)
      if (
        typeof v === "object" &&
        v !== null &&
        !Array.isArray(v) &&
        typeof Object.getOwnPropertyDescriptor(v, "leg")?.value === "string"
      )
        facts.push(Object.fromEntries(Object.entries(v)))
      else rejected += 1
    } catch {
      rejected += 1
    }
  }
  return { facts, rejected }
}

export type LedgerRow = {
  readonly question: string
  readonly leg: LegId
  readonly verdict: Verdict
  readonly evidence: string
  readonly rerun: string
  readonly host: string
  readonly measuredAt: string
}

export function ledgerRows(
  facts: readonly Facts[],
  at: { readonly host: string; readonly measuredAt: string },
): readonly LedgerRow[] {
  return LEGS.map((l) => {
    const r = combineRuns(facts.filter((f) => f["leg"] === l.leg).map(l.judge))
    const rerun = `powershell -NoProfile -ExecutionPolicy Bypass -File ${PROBE} -Leg ${l.leg} -Out facts.jsonl (job ${l.job} of computer-live-windows-full.yml)`
    return {
      question: l.question,
      leg: l.leg,
      verdict: r.verdict,
      evidence: r.evidence,
      rerun,
      host: at.host,
      measuredAt: at.measuredAt,
    }
  })
}

const cell = (s: string) => s.replace(/[\t\r\n]+/g, " ").trim()

export function ledgerTsv(rows: readonly LedgerRow[]): string {
  const lines = rows.map((r) =>
    [r.question, r.leg, r.verdict, r.evidence, r.rerun, r.host, r.measuredAt].map(cell).join("\t"),
  )
  return `${[HEADER, ...lines].join("\n")}\n`
}

const isVerdict = (v: string): v is Verdict => VERDICTS.some((x) => x === v)
const isLeg = (v: string): v is LegId => LEGS.some((l) => l.leg === v)

export function validateLedger(tsv: string): readonly string[] {
  const lines = tsv.split(/\r?\n/).filter((l) => l !== "")
  const errors: string[] = []
  if (lines[0] !== HEADER) errors.push(`header is not '${HEADER}'`)
  const seen: string[] = []
  for (const [i, line] of lines.slice(1).entries()) {
    const c = line.split("\t")
    const leg = c[1] ?? ""
    if (c.length !== 7) errors.push(`row ${i + 1}: ${c.length} columns, expected 7`)
    if (!isLeg(leg)) errors.push(`row ${i + 1}: unknown leg ${leg}`)
    if (!isVerdict(c[2] ?? "")) errors.push(`row ${i + 1}: verdict ${c[2] ?? ""} is not one of ${VERDICTS.join("|")}`)
    if ((c[3] ?? "").trim() === "") errors.push(`row ${i + 1}: empty evidence`)
    if (seen.includes(leg)) errors.push(`row ${i + 1}: duplicate leg ${leg}`)
    seen.push(leg)
  }
  for (const l of LEGS) if (!seen.includes(l.leg)) errors.push(`missing leg ${l.leg}`)
  return errors
}

export function ledgerVerdicts(tsv: string): Readonly<Record<LegId, Verdict>> {
  const out: Record<LegId, Verdict> = {
    elevated: "UNMEASURED",
    lock: "UNMEASURED",
    disconnect: "UNMEASURED",
    "mixed-dpi": "UNMEASURED",
    "secure-desktop": "UNMEASURED",
  }
  for (const line of tsv.split(/\r?\n/).slice(1)) {
    const [, leg = "", verdict = ""] = line.split("\t")
    if (isLeg(leg) && isVerdict(verdict)) out[leg] = verdict
  }
  return out
}

export type PlannedLeg =
  | { readonly leg: LegId; readonly tier: "hosted" | "guest" }
  | { readonly leg: LegId; readonly tier: "blocked"; readonly reason: "no_windows_host" }

export function planLegs(verdicts: Readonly<Record<LegId, Verdict>>, guestOn: boolean): readonly PlannedLeg[] {
  return LEGS.map(({ leg }): PlannedLeg => {
    if (verdicts[leg] === "CONFIRMS") return { leg, tier: "hosted" }
    return guestOn ? { leg, tier: "guest" } : { leg, tier: "blocked", reason: "no_windows_host" }
  })
}

export const planLine = (p: PlannedLeg): string =>
  p.tier === "blocked" ? `leg=${p.leg} tier=blocked reason=${p.reason}` : `leg=${p.leg} tier=${p.tier}`

export function decideTier(plan: readonly PlannedLeg[]): "hosted" | "guest" | "partial" {
  if (plan.every((p) => p.tier === "hosted")) return "hosted"
  return plan.some((p) => p.tier === "blocked") ? "partial" : "guest"
}
