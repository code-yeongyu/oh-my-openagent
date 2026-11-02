/**
 * Closed-form springs for the crafted MorphStage (DESIGN.md §6).
 *
 * A spring here is its step response: the position of a unit mass released at 0 toward 1.
 * A value whose target changes many times is the sum of one step per change, so a frame
 * depends only on the clock and a retarget never snaps.
 */

export interface Spring {
  /** Natural angular frequency in rad/s. */
  readonly omega: number
  /** Damping ratio: < 1 overshoots, 1 is critical, > 1 creeps. */
  readonly zeta: number
}

export const SPRING_LEAD: Spring = { omega: 10, zeta: 0.78 }
export const SPRING_TRAIL: Spring = { omega: 6.6, zeta: 0.95 }

export function springStep(t: number, spring: Spring): number {
  if (t <= 0) return 0
  const { omega, zeta } = spring
  if (zeta < 1) {
    const damped = omega * Math.sqrt(1 - zeta * zeta)
    const decay = Math.exp(-zeta * omega * t)
    return 1 - decay * (Math.cos(damped * t) + ((zeta * omega) / damped) * Math.sin(damped * t))
  }
  if (zeta === 1) return 1 - Math.exp(-omega * t) * (1 + omega * t)
  const root = Math.sqrt(zeta * zeta - 1)
  const fast = -omega * (zeta - root)
  const slow = -omega * (zeta + root)
  return 1 + (slow * Math.exp(fast * t) - fast * Math.exp(slow * t)) / (fast - slow)
}

/**
 * An upper bound on |1 − step(t)|: underdamped e^(−ζωt)/√(1−ζ²), critical (1+ωt)e^(−ωt),
 * overdamped ((a+b)/(b−a))·e^(−at) with a, b = ω(ζ ∓ √(ζ²−1)).
 */
export function residualBound(t: number, spring: Spring): number {
  const { omega, zeta } = spring
  if (zeta < 1) return Math.exp(-zeta * omega * t) / Math.sqrt(1 - zeta * zeta)
  if (zeta === 1) return (1 + omega * t) * Math.exp(-omega * t)
  const root = Math.sqrt(zeta * zeta - 1)
  const slow = omega * (zeta - root)
  const fast = omega * (zeta + root)
  return ((slow + fast) / (fast - slow)) * Math.exp(-slow * t)
}

/** A folded change moves the value by less than this, far below one device pixel. */
export const FOLD_EPSILON = 1e-3

function isFoldable(change: Change, t: number): boolean {
  const elapsed = t - change.at
  return (
    elapsed > 0 && Math.abs(change.delta) * residualBound(elapsed, change.spring) < FOLD_EPSILON
  )
}

interface Change {
  readonly at: number
  readonly delta: number
  readonly spring: Spring
}

/**
 * One animated scalar as base + Σ delta_i · step(t − at_i). `retarget` records a change.
 * `valueAt` folds settled changes into the base, so its `t` must never decrease.
 */
export class SpringTrack {
  private base: number
  private target: number
  private changes: Change[] = []

  constructor(initial: number) {
    this.base = initial
    this.target = initial
  }

  get settledTarget(): number {
    return this.target
  }

  retarget(to: number, at: number, spring: Spring): void {
    const delta = to - this.target
    if (delta === 0) return
    this.changes.push({ at, delta, spring })
    this.target = to
  }

  valueAt(t: number): number {
    let value = this.base
    const kept: Change[] = []
    for (const change of this.changes) {
      const elapsed = t - change.at
      if (isFoldable(change, t)) {
        this.base += change.delta
        value += change.delta
        continue
      }
      value += change.delta * springStep(elapsed, change.spring)
      kept.push(change)
    }
    this.changes = kept
    return value
  }

  isSettled(t: number): boolean {
    return this.changes.every((change) => isFoldable(change, t))
  }
}
