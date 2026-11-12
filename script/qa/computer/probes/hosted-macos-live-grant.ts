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

export type GrantAnswers = { readonly q6: Answer; readonly q7: Answer }

async function subjectLegs(subject: Probe): Promise<Record<string, Answer>> {
  return {
    q1: askTrusted(subject),
    q2: await askAxTree(subject),
    q3: await askPidClick(subject),
    q4: askCapture(subject),
    q5: askTap(subject),
  }
}

function summarize(legs: Record<string, Answer>): string {
  return Object.entries(legs)
    .map(([question, leg]) => `${question}=${leg.verdict} (${leg.evidence.slice(0, 160)})`)
    .join("; ")
}

function combined(legs: Record<string, Answer>, route: string): Answer {
  const verdicts = Object.values(legs).map((leg) => leg.verdict)
  const verdict = verdicts.every((v) => v === "CONFIRMS")
    ? "CONFIRMS"
    : verdicts.includes("UNMEASURED")
      ? "UNMEASURED"
      : "CONTRADICTS"
  return { verdict, evidence: `route: ${route}; ${summarize(legs)}` }
}

async function askGranted(subject: Probe, subjectPath: string): Promise<{ answer: Answer; restarted: boolean }> {
  const baseline = subject.invoke(["trusted"])
  if (typeof baseline.helperError === "string")
    return { answer: { verdict: "UNMEASURED", evidence: `disclaimed spawn failed: ${baseline.helperError}` }, restarted: false }
  if (baseline.responsiblePid !== baseline.pid)
    return { answer: { verdict: "UNMEASURED", evidence: `subject is not its own responsible process: ${short(baseline)}` }, restarted: false }
  if (baseline.axTrusted === true)
    return { answer: { verdict: "UNMEASURED", evidence: `subject read trusted before any row existed: ${short(baseline)}` }, restarted: false }
  const csreq = designatedRequirementHex(subjectPath, subject.scratch)
  const inserted = insertProbeRows(subjectPath, csreq)
  if (inserted.code !== 0)
    return { answer: { verdict: "CONTRADICTS", evidence: `system TCC insert refused: ${inserted.stderr.slice(0, 300)}` }, restarted: false }
  const binding = csreq === null ? "path only (no designated requirement)" : "path + designated requirement"
  const direct = await subjectLegs(subject)
  if (direct.q1?.verdict === "CONFIRMS")
    return { answer: combined(direct, `sudo sqlite3 insert, ${binding}, no tccd restart; baseline denied`), restarted: false }
  const restart = restartTccd()
  const retried = await subjectLegs(subject)
  return {
    answer: combined(retried, `sudo sqlite3 insert, ${binding}, then ${restart}; without restart q1 read ${direct.q1?.verdict}`),
    restarted: true,
  }
}

async function askRemoved(subject: Probe, subjectPath: string, restarted: boolean, granted: Answer): Promise<Answer> {
  const removed = deleteProbeRows(subjectPath)
  if (removed.code !== 0 || countProbeRows(subjectPath) !== 0)
    return { verdict: "UNMEASURED", evidence: `row removal failed: ${removed.stderr.slice(0, 200)}` }
  const restart = restarted ? restartTccd() : "no tccd restart"
  const detector = subject.control(["dialogs", "omo-probe"])
  if (!Array.isArray(detector.windows) || detector.windows.length === 0)
    return { verdict: "UNMEASURED", evidence: `control failed: the window detector did not see the fixture ${short(detector)}` }
  const before = new Set(dialogProcesses())
  const read = subject.invoke(["trusted"])
  const tap = subject.invoke(["tap-create"])
  const appeared = await until(() => dialogProcesses().filter((name) => !before.has(name)), (names) => names.length > 0, 5_000)
  const windows = subject.control(["dialogs", "UserNotificationCenter", "universalAccessAuthWarn", "SecurityAgent"])
  const dialogWindows = Array.isArray(windows.windows) ? windows.windows : []
  const evidence = `rows removed, ${restart}; subject ${short(read)}; tap ${short(tap)}; new dialog processes in 5 s ${short(appeared)}; dialog windows ${short(dialogWindows)}; control q6=${granted.verdict}`
  if (typeof read.helperError === "string" || typeof tap.helperError === "string")
    return { verdict: "UNMEASURED", evidence: `helper call failed; ${evidence}` }
  const denied = read.axTrusted === false && read.screenCapturePreflight === false && tap.created === false
  const quiet = appeared.length === 0 && dialogWindows.length === 0
  return { verdict: denied && quiet ? "CONFIRMS" : "CONTRADICTS", evidence }
}

export async function askGrantRoute(probe: Probe, binary: string, subjectPath: string): Promise<GrantAnswers> {
  const subject: Probe = { ...probe, invoke: disclaimedInvoke(binary, subjectPath) }
  const granted = await askGranted(subject, subjectPath)
  const q7 = await askRemoved(subject, subjectPath, granted.restarted, granted.answer)
  return { q6: granted.answer, q7 }
}
