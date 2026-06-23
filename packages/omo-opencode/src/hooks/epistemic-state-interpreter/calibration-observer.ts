import type { EpistemicState } from "./types"
import { log } from "../../shared/logger"

interface CalibrationState {
  counts: Map<EpistemicState, number>
  totalObservations: number
  suggestionEmitted: boolean
}

const store = new Map<string, CalibrationState>()

const OBSERVATION_THRESHOLD = 100
const HIGH_FREQUENCY_THRESHOLD = 0.8
const LOW_FREQUENCY_THRESHOLD = 0.05

function createState(): CalibrationState {
  return { counts: new Map(), totalObservations: 0, suggestionEmitted: false }
}

export function observeCalibration(sessionId: string, state: EpistemicState): void {
  if (!store.has(sessionId)) store.set(sessionId, createState())
  const cal = store.get(sessionId)!
  cal.counts.set(state, (cal.counts.get(state) ?? 0) + 1)
  cal.totalObservations++

  if (cal.totalObservations >= OBSERVATION_THRESHOLD && !cal.suggestionEmitted) {
    for (const [s, count] of cal.counts) {
      const frequency = count / cal.totalObservations
      if (frequency > HIGH_FREQUENCY_THRESHOLD) {
        log(
          `[epistemic calibration] session ${sessionId}: state '${s}' at ${(frequency * 100).toFixed(1)}% frequency (>${HIGH_FREQUENCY_THRESHOLD * 100}%). Consider adjusting thresholds.`,
        )
        cal.suggestionEmitted = true
      }
      if (frequency < LOW_FREQUENCY_THRESHOLD && count > 0) {
        log(
          `[epistemic calibration] session ${sessionId}: state '${s}' at ${(frequency * 100).toFixed(1)}% frequency (<${LOW_FREQUENCY_THRESHOLD * 100}%). Consider adjusting thresholds.`,
        )
        cal.suggestionEmitted = true
      }
    }
  }
}

export function clearCalibration(sessionId: string): void {
  store.delete(sessionId)
}

export function _resetCalibrationForTesting(): void {
  store.clear()
}
