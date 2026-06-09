export type ContinuationMarkerSource = "todo" | "stop" | "background-task"

export type ContinuationMarkerState = "idle" | "active" | "stopped"

export interface ContinuationMarkerSourceEntry {
  state: ContinuationMarkerState
  reason?: string
  updatedAt: string
}

export interface ContinuationMarker {
  sessionID: string
  updatedAt: string
  sources: Partial<Record<ContinuationMarkerSource, ContinuationMarkerSourceEntry>>
}
