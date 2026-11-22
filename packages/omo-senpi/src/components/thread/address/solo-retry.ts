import { waitWithinCallBudget } from "../../call-budget/call-deadline"
import type { RemoteLookupOutcome, RemoteSessionsPort } from "../remote/ports"

export type ProbeAnswer = { readonly device: string; readonly answer: RemoteLookupOutcome }

/** One solo lookup's own bound: the client's cap on a single-probe locate (device-service.ts LOOKUP_CAP_MS). */
const SOLO_LOOKUP_MS = 3_500

/**
 * #14748: each device that stayed silent in the parallel round is asked again alone, as `<device>/<thread>` asks it.
 * Review M1: a capped lookup leaves its locate running on the device service, so each retry first waits for every locate
 * this port sent to finish; one that does not finish within a lookup's bound keeps the device's silent answer instead
 * of overlapping it. Review M2: a retry runs only while the call's budget still holds a lookup and the reserve the step
 * after the resolution needs; the devices it cannot ask keep their silent answer, so the refusal still names them.
 */
export async function askSilentAlone(
  sessions: Pick<RemoteSessionsPort, "lookup" | "lookupsIdle">,
  thread: string,
  answers: readonly ProbeAnswer[],
): Promise<readonly ProbeAnswer[]> {
  const probe = sessions.lookup
  if (probe === undefined) return answers
  const settled: ProbeAnswer[] = []
  for (const entry of answers)
    settled.push(
      entry.answer.kind === "silent" && (await quiet(sessions))
        ? { device: entry.device, answer: await probe(entry.device, thread) }
        : entry,
    )
  return settled
}

async function quiet(sessions: Pick<RemoteSessionsPort, "lookupsIdle">): Promise<boolean> {
  const room = waitWithinCallBudget(Number.POSITIVE_INFINITY)
  if (room < SOLO_LOOKUP_MS) return false
  if (sessions.lookupsIdle === undefined) return true
  const idle = await within(sessions.lookupsIdle(), Math.min(SOLO_LOOKUP_MS, room - SOLO_LOOKUP_MS))
  return idle && waitWithinCallBudget(Number.POSITIVE_INFINITY) >= SOLO_LOOKUP_MS
}

async function within(work: Promise<void>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), Math.max(0, ms))
    timer.unref?.()
  })
  try {
    return await Promise.race([work.then(() => true as const), expired])
  } finally {
    clearTimeout(timer)
  }
}
