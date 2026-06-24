import { setContinuationMarkerSource } from "../run-continuation-state"

export const BACKGROUND_COMPLETION_WAKE_PENDING_REASON = "background completion wake pending"

export type BackgroundTaskMarkerInput = {
  readonly directory: string
  readonly parentSessionID: string
  readonly activeTaskCount: number
  readonly hasUndeliveredParentWake: boolean
}

export function writeBackgroundTaskMarker(input: BackgroundTaskMarkerInput): void {
  if (input.activeTaskCount > 0) {
    setContinuationMarkerSource(
      input.directory,
      input.parentSessionID,
      "background-task",
      "active",
      `${input.activeTaskCount} background task(s) active`,
    )
    return
  }

  if (input.hasUndeliveredParentWake) {
    setContinuationMarkerSource(
      input.directory,
      input.parentSessionID,
      "background-task",
      "active",
      BACKGROUND_COMPLETION_WAKE_PENDING_REASON,
    )
    return
  }

  setContinuationMarkerSource(
    input.directory,
    input.parentSessionID,
    "background-task",
    "idle",
  )
}
