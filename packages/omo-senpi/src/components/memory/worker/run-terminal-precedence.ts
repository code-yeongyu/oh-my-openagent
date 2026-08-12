import { existsSync } from "node:fs"
import { join } from "node:path"

import {
  readRunJson,
  runOutcomeMatchesLedger,
  type RunOutcome,
} from "./run-artifacts"
import { classifyRunProcess, type RunLivenessSeams } from "./run-liveness"
import { claimRunTerminal, runTerminalClaimMatches } from "./run-terminal-claim"
import {
  parseReservationRunLedger,
  type ReservationRunLedger,
} from "./reservation-run-ledger"

interface RunPublicationPending {
  readonly version: 1
  readonly runId: string
  readonly attempt: number
  readonly finishedAt: string
}

export type RunAbandonmentPrecedence =
  | { readonly decision: "finalize"; readonly ledger: ReservationRunLedger }
  | { readonly decision: "veto"; readonly ledger: ReservationRunLedger }
  | { readonly decision: "abandon"; readonly ledger: ReservationRunLedger }

async function readTerminalPublication(
  runDir: string,
  ledger: ReservationRunLedger,
): Promise<"finalize" | "veto" | undefined> {
  const outcomePath = join(runDir, "outcome.json")
  if (existsSync(outcomePath)) {
    const outcome = await readRunJson<RunOutcome>(outcomePath)
    if (runOutcomeMatchesLedger(ledger, outcome)) return "finalize"
  }
  const publishingPath = join(runDir, "publishing.json")
  if (!existsSync(publishingPath)) return undefined
  const publishing = await readRunJson<RunPublicationPending>(publishingPath)
  return publishing.version === 1
    && publishing.runId === ledger.runId
    && publishing.attempt === ledger.attempt
    ? "veto"
    : undefined
}

export async function checkRunAbandonmentPrecedence(
  runDir: string,
  runId: string,
  seams: RunLivenessSeams,
): Promise<RunAbandonmentPrecedence> {
  const ledger = parseReservationRunLedger(await readRunJson<unknown>(join(runDir, "ledger.json")))
  if (ledger.runId !== runId) throw new Error(`Finalization ledger mismatch: ${runId}`)

  const published = await readTerminalPublication(runDir, ledger)
  if (published !== undefined) return { decision: published, ledger }

  const [supervisor, child] = await Promise.all([
    classifyRunProcess(ledger.pid, ledger.processStart, seams),
    classifyRunProcess(ledger.childPid, ledger.childProcessStart, seams),
  ])
  if (supervisor === "alive" || child === "alive") return { decision: "veto", ledger }

  // Preserve the legacy marker veto, then make the terminal decision with one
  // filesystem-exclusive claim rather than another check followed by a write.
  const settled = await readTerminalPublication(runDir, ledger)
  if (settled !== undefined) return { decision: settled, ledger }
  const identity = { runId: ledger.runId, attempt: ledger.attempt ?? 1 }
  const claim = await claimRunTerminal(runDir, identity, "abandon", seams)
  return {
    decision: runTerminalClaimMatches(claim, identity, "abandon") ? "abandon" : "veto",
    ledger,
  }
}
