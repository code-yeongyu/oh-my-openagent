/** cubic-bezier(x1, y1, x2, y2) as a function of progress, solved for x by Newton's method. */
export function bezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const at = (a: number, b: number, t: number): number =>
    ((1 - 3 * b + 3 * a) * t + (3 * b - 6 * a)) * t * t + 3 * a * t
  const slope = (a: number, b: number, t: number): number =>
    3 * (1 - 3 * b + 3 * a) * t * t + 2 * (3 * b - 6 * a) * t + 3 * a
  return (x) => {
    if (x <= 0 || x >= 1) return Math.min(Math.max(x, 0), 1)
    let t = x
    for (let i = 0; i < 6; i++) {
      const d = slope(x1, x2, t)
      if (Math.abs(d) < 1e-6) break
      t -= (at(x1, x2, t) - x) / d
    }
    return at(y1, y2, Math.min(Math.max(t, 0), 1))
  }
}

/** The motion-design house curves: the reverb for arrivals, Material standard for state, a move curve for packets. */
export const EASE_ENTER = bezier(0.1, 1, 0.1, 1)
export const EASE_STATE = bezier(0.2, 0, 0, 1)
export const EASE_MOVE = bezier(0.4, 0, 0, 1)

/** A value that eases from where it is toward a target over a duration. */
export class Tween {
  private from: number
  private to: number
  private start = 0
  private dur = 1
  private ease = EASE_STATE
  constructor(value: number) {
    this.from = value
    this.to = value
  }
  set(to: number, now: number, dur: number, ease = EASE_STATE): void {
    if (to === this.to) return
    this.from = this.value(now)
    this.to = to
    this.start = now
    this.dur = dur
    this.ease = ease
  }
  jump(to: number): void {
    this.from = to
    this.to = to
  }
  value(now: number): number {
    const p = Math.min(Math.max((now - this.start) / this.dur, 0), 1)
    return this.from + (this.to - this.from) * this.ease(p)
  }
}
