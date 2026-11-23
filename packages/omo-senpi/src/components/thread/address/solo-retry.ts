import { waitWithinCallBudget } from "../../call-budget/call-deadline"
import type { RemoteLookupOutcome, RemoteSessionsPort } from "../remote/ports"

export type ProbeAnswer = { readonly device: string; readonly answer: RemoteLookupOutcome }

/** One solo lookup's own bound: the client's cap on a single-probe locate (device-service.ts LOOKUP_CAP_MS). */
const SOLO_LOOKUP_MS = 3_500

/**
 * #14748: each device that stayed silent in the parallel round is asked again alone, as `<device>/<thread>` asks it.
 * Review M1/M3: the port sends it only while no other locate of the port is in flight and holds every other lookup back
 * meanwhile (`lookupAlone`, remote/port/lookup-gate.ts), so concurrent calls never overlap their retries. Review M2: a
 * retry is asked only while the call's budget still holds its wait, a lookup and the reserve the step after the
 * resolution needs. A device it could not ask alone keeps its silent answer, so the refusal still names it.
 */
export async function askSilentAlone(
  sessions: Pick<RemoteSessionsPort, "lookupAlone">,
  thread: string,
  answers: readonly ProbeAnswer[],
): Promise<readonly ProbeAnswer[]> {
  const settled: ProbeAnswer[] = []
  for (const entry of answers) {
    const again = entry.answer.kind === "silent" ? await alone(sessions, entry.device, thread) : undefined
    // A retry the port could not make (`unavailable`) says nothing about the device: its silent answer stands.
    settled.push(again === undefined || again.kind === "unavailable" ? entry : { device: entry.device, answer: again })
  }
  return settled
}

async function alone(
  sessions: Pick<RemoteSessionsPort, "lookupAlone">,
  device: string,
  thread: string,
): Promise<RemoteLookupOutcome | undefined> {
  const room = waitWithinCallBudget(Number.POSITIVE_INFINITY)
  if (sessions.lookupAlone === undefined || room < SOLO_LOOKUP_MS) return undefined
  return await sessions.lookupAlone(device, thread, Math.min(SOLO_LOOKUP_MS, room - SOLO_LOOKUP_MS))
}
