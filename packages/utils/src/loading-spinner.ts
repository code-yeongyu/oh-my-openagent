export const LOADING_SPINNER_FRAME_MS = 90

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const

// The Unix epoch is the shared origin, so phase does not depend on when an operation starts.
export function loadingSpinnerFrame(now: number): string {
  const phase = Math.floor(now / LOADING_SPINNER_FRAME_MS) % FRAMES.length
  return FRAMES[phase < 0 ? phase + FRAMES.length : phase] ?? FRAMES[0]
}

export function delayToNextLoadingSpinnerFrame(now: number): number {
  const next = (Math.floor(now / LOADING_SPINNER_FRAME_MS) + 1) * LOADING_SPINNER_FRAME_MS
  return next - now
}
