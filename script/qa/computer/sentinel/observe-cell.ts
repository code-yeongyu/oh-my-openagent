import { type CellObservation, type DesktopSnapshot, observe } from "./observation.ts"
import type { SentinelEvent } from "./summary.ts"

type RecordingSession = {
  snapshot(): Promise<DesktopSnapshot>
  segment(act: () => Promise<void>, windowMs: number): Promise<SentinelEvent[]>
}

// Attaches the desktop observer to one cell: snapshot, record the cell's action, snapshot again. The cell's own
// oracle result comes back as `status`, apart from what the observer saw.
export async function observeCell<Status>(
  session: RecordingSession,
  act: () => Promise<Status>,
  windowMs: number,
): Promise<CellObservation<Status>> {
  const before = await session.snapshot()
  let status: { readonly value: Status } | undefined
  const events = await session.segment(async () => {
    status = { value: await act() }
  }, windowMs)
  const after = await session.snapshot()
  if (status === undefined) throw new Error("the cell's action never completed")
  return observe(status.value, before, after, events)
}
