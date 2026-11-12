import { realpathSync } from "node:fs"
import {
  countProbeRows,
  deleteProbeRows,
  designatedRequirementHex,
  dialogProcesses,
  insertProbeRows,
  restartTccd,
  short,
  until,
} from "./hosted-macos-live-host.ts"
import {
  type Answer,
  askAxTree,
  askCapture,
  askPidClick,
  askTap,
  askTrusted,
  disclaimedInvoke,
  type Probe,
} from "./hosted-macos-live-questions.ts"

const DIALOG_OWNERS = ["UserNotificationCenter", "universalAccessAuthWarn", "SecurityAgent"]

export type GrantAnswers = { readonly q6: Answer; readonly q7: Answer }

type Legs = Record<string, Answer>

async function subjectLegs(subject: Probe): Promise<Legs> {
  return {
    q1: askTrusted(subject),
    q2: await askAxTree(subject),
    q3: await askPidClick(subject),
    q4: askCapture(subject),
    q5: askTap(subject),
  }
}

function summarize(legs: Legs): string {
  return Object.entries(legs)
    .map(([question, leg]) => `${question}=${leg.verdict} (${leg.evidence.slice(0, 160)})`)
    .join("; ")
}

function combined(legs: Legs, route: string): Answer {
  const verdicts = Object.values(legs).map((leg) => leg.verdict)
  const verdict = verdicts.every((v) => v === "CONFIRMS")
    ? "CONFIRMS"
    : verdicts.includes("UNMEASURED")
      ? "UNMEASURED"
      : "CONTRADICTS"
  const notConfirmed = Object.entries(legs).filter(([, leg]) => leg.verdict !== "CONFIRMS")
  const onlyQ3 = verdict === "CONTRADICTS" && notConfirmed.length === 1 && notConfirmed[0]?.[0] === "q3"
  const inherited = onlyQ3
    ? "the grant took effect (q1, q2, q4 and q5 CONFIRMS as the subject itself); this row is CONTRADICTS only through its q3 sub-leg, inherited from q3; "
    : ""
  return { verdict, evidence: `${inherited}route: ${route}; ${summarize(legs)}` }
}

type GrantRoute = { readonly label: string; readonly csreqHex: string | null }

async function tryRoute(
  subject: Probe,
  subjectPath: string,
  route: GrantRoute,
): Promise<{ legs: Legs; note: string } | string> {
  const inserted = insertProbeRows(subjectPath, route.csreqHex)
  if (inserted.code !== 0) return `system TCC insert refused (${route.label}): ${inserted.stderr.slice(0, 200)}`
  const direct = await subjectLegs(subject)
  if (direct.q1?.verdict === "CONFIRMS") return { legs: direct, note: `${route.label}, no tccd restart` }
  const restart = restartTccd()
  const retried = await subjectLegs(subject)
  return { legs: retried, note: `${route.label}, then ${restart}; before the restart q1 read ${direct.q1?.verdict}` }
}

async function askGranted(subject: Probe, subjectPath: string): Promise<{ answer: Answer; restarted: boolean }> {
  const baseline = subject.invoke(["trusted"])
  const early = (evidence: string): { answer: Answer; restarted: boolean } => ({
    answer: { verdict: "UNMEASURED", evidence },
    restarted: false,
  })
  if (typeof baseline.helperError === "string") return early(`disclaimed spawn failed: ${baseline.helperError}`)
  if (baseline.responsiblePid !== baseline.pid)
    return early(`subject is not its own responsible process: ${short(baseline)}`)
  if (baseline.axTrusted === true) return early(`subject read trusted before any row existed: ${short(baseline)}`)
  const csreq = designatedRequirementHex(subjectPath, subject.scratch)
  const routes: GrantRoute[] = [
    ...(csreq === null
      ? []
      : [{ label: "sudo sqlite3 insert, client path + designated requirement", csreqHex: csreq }]),
    { label: "sudo sqlite3 insert, client path, NULL csreq", csreqHex: null },
  ]
  const history: string[] = [`baseline denied ${short(baseline)}`, `client ${subjectPath}`]
  let last: { legs: Legs; note: string } | undefined
  for (const route of routes) {
    const outcome = await tryRoute(subject, subjectPath, route)
    if (typeof outcome === "string") {
      history.push(outcome)
      continue
    }
    last = outcome
    if (outcome.legs.q1?.verdict === "CONFIRMS") break
    history.push(`${outcome.note}: q1 ${outcome.legs.q1?.verdict}`)
    deleteProbeRows(subjectPath)
  }
  if (last === undefined) return { answer: { verdict: "CONTRADICTS", evidence: history.join("; ") }, restarted: false }
  return {
    answer: combined(last.legs, `${last.note}; ${history.join("; ")}`),
    restarted: last.note.includes("restart system"),
  }
}

async function askRemoved(subject: Probe, subjectPath: string, restarted: boolean, granted: Answer): Promise<Answer> {
  const removed = deleteProbeRows(subjectPath)
  if (removed.code !== 0 || countProbeRows(subjectPath) !== 0)
    return { verdict: "UNMEASURED", evidence: `row removal failed: ${removed.stderr.slice(0, 200)}` }
  const restart = restarted ? restartTccd() : "no tccd restart"
  const detector = subject.control(["dialogs", "omo-probe"])
  if (!Array.isArray(detector.windows) || detector.windows.length === 0)
    return {
      verdict: "UNMEASURED",
      evidence: `control failed: the window detector did not see the fixture ${short(detector)}`,
    }
  const dialogWindows = (): string[] => {
    const read = subject.control(["dialogs", ...DIALOG_OWNERS])
    return Array.isArray(read.windows) ? read.windows.filter((name): name is string => typeof name === "string") : []
  }
  const newDialogProcesses = async (): Promise<string[]> => {
    const before = new Set(dialogProcesses())
    return until(
      () => dialogProcesses().filter((name) => !before.has(name)),
      (names) => names.length > 0,
      5_000,
    )
  }
  const baseline = await newDialogProcesses()
  const windowsBefore = dialogWindows()
  const callStarted = Date.now()
  const read = subject.invoke(["trusted"])
  const tap = subject.invoke(["tap-create"])
  const appeared = await until(
    () => dialogProcesses().filter((name) => !new Set(baseline).has(name)),
    (names) => names.length > 0,
    Math.max(0, 5_000 - (Date.now() - callStarted)),
  )
  const windowsAfter = dialogWindows()
  const newWindows = windowsAfter.length - windowsBefore.length
  const evidence = `rows removed, ${restart}; control window with no call: new dialog processes ${short(baseline)}; subject ${short(read)}; tap ${short(tap)}; new dialog processes within 5 s of the call ${short(appeared)}; dialog windows before ${short(windowsBefore)} after ${short(windowsAfter)}; control q6=${granted.verdict}`
  if (typeof read.helperError === "string" || typeof tap.helperError === "string")
    return { verdict: "UNMEASURED", evidence: `helper call failed; ${evidence}` }
  const denied = read.axTrusted === false && read.screenCapturePreflight === false && tap.created === false
  if (newWindows > 0) return { verdict: "CONTRADICTS", evidence: `a dialog window appeared; ${evidence}` }
  if (baseline.length > 0)
    return {
      verdict: "UNMEASURED",
      evidence: `dialog processes start without any probe call here, so a start is unattributable; ${evidence}`,
    }
  const quiet = appeared.length === 0
  return { verdict: denied && quiet ? "CONFIRMS" : "CONTRADICTS", evidence }
}

export async function askGrantRoute(probe: Probe, binary: string, subjectPath: string): Promise<GrantAnswers> {
  const realSubject = realpathSync(subjectPath)
  const subject: Probe = { ...probe, invoke: disclaimedInvoke(binary, realSubject) }
  const granted = await askGranted(subject, realSubject)
  const q7 = await askRemoved(subject, realSubject, granted.restarted, granted.answer)
  return { q6: granted.answer, q7 }
}
