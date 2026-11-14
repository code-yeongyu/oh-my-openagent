/** The engine emits auto_retry_start.delayMs before its backoff sleep. */
export function retryDelayMs(event: object, message = ""): number {
  const delay = Reflect.get(event, "delayMs")
  if (typeof delay === "number" && Number.isFinite(delay) && delay >= 0) return delay
  const milliseconds = /\bretry[-_ ]?after[-_ ]?ms[":=\s]+(\d+)/i.exec(message)
  if (milliseconds !== null) return Number(milliseconds[1])
  const seconds = /\bretry[-_ ]after[":=\s]+(\d+(?:\.\d+)?)/i.exec(message)
  return seconds === null ? 0 : Number(seconds[1]) * 1000
}
