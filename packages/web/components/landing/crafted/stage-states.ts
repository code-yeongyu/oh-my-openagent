export type StageStateId =
  "code-mode" | "absorption" | "correction" | "team" | "monitor" | "goal" | "reload"

export interface StageRect {
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
}

export interface StageState {
  readonly id: StageStateId
  readonly rect: StageRect
  readonly liveAtSeconds?: number
}

export const STAGE_STATES: readonly StageState[] = [
  { id: "code-mode", rect: { x0: 0.06, y0: 0.2, x1: 0.94, y1: 0.8 } },
  { id: "absorption", rect: { x0: 0.26, y0: 0.08, x1: 0.74, y1: 0.92 } },
  { id: "correction", rect: { x0: 0.1, y0: 0.24, x1: 0.9, y1: 0.76 } },
  { id: "team", rect: { x0: 0.04, y0: 0.08, x1: 0.96, y1: 0.92 } },
  { id: "monitor", rect: { x0: 0.24, y0: 0.3, x1: 0.76, y1: 0.7 }, liveAtSeconds: 1.1 },
  { id: "goal", rect: { x0: 0.14, y0: 0.14, x1: 0.86, y1: 0.86 } },
  { id: "reload", rect: { x0: 0.08, y0: 0.36, x1: 0.92, y1: 0.64 }, liveAtSeconds: 0.7 },
]

export const STAGE_DWELL_SECONDS = 2.8
export const CURSOR_LEAD_SECONDS = 0.62
export const USER_HOLD_SECONDS = 6

export function stageState(index: number): StageState {
  const state =
    STAGE_STATES[((index % STAGE_STATES.length) + STAGE_STATES.length) % STAGE_STATES.length]
  if (!state) throw new Error(`stage state ${index} out of range`)
  return state
}

export function nextIndex(index: number): number {
  return (index + 1) % STAGE_STATES.length
}

export interface PixelRect {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

export function toPixels(rect: StageRect, width: number, height: number): PixelRect {
  return {
    left: rect.x0 * width,
    top: rect.y0 * height,
    right: rect.x1 * width,
    bottom: rect.y1 * height,
  }
}

export function cursorClickPoint(
  rect: StageRect,
  width: number,
  height: number,
): { x: number; y: number } {
  return {
    x: (rect.x0 + (rect.x1 - rect.x0) * 0.72) * width,
    y: (rect.y0 + (rect.y1 - rect.y0) * 0.7) * height,
  }
}
