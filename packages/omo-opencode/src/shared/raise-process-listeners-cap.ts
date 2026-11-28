/** Raise the startup warning threshold while preserving an unlimited or higher cap. */
export function raiseProcessListenersCap(minimum: number): void {
  const current = process.getMaxListeners()
  if (current === 0) {
    return
  }
  if (current < minimum) {
    process.setMaxListeners(minimum)
  }
}

export const PROCESS_LISTENERS_CAP_DEFAULT = 128
