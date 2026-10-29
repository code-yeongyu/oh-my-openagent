/** The turn stop is independent of the global physical chord and engine lifetime. */
export function createEscapeStopGate(readStops: () => Promise<number> = async () => 0) {
  let observedStops = 0
  let controller = new AbortController()
  const userInputs = new Set<string>()

  function stop(stops: number): void {
    if (stops <= observedStops) return
    observedStops = stops
    controller.abort()
  }

  return {
    stop,
    get signal(): AbortSignal {
      return controller.signal
    },
    /** No activation or engine query is needed to refuse a latched turn. */
    async admit(): Promise<boolean> {
      if (controller.signal.aborted) return false
      stop(await readStops())
      return !controller.signal.aborted
    },
    /** Attribution is supplied by the host, not inferred from input source. */
    userInput(event: unknown): void {
      if (typeof event !== "object" || event === null || !("inputId" in event) ||
          typeof event.inputId !== "string") return
      if ("attribution" in event && event.attribution === "user" &&
          !("synthetic" in event && event.synthetic === true)) {
        userInputs.add(event.inputId)
      } else {
        userInputs.delete(event.inputId)
      }
    },
    inputStarted(inputId: string): void {
      if (userInputs.delete(inputId) && controller.signal.aborted) controller = new AbortController()
    },
    inputDiscarded(inputId: string): void {
      userInputs.delete(inputId)
    },
  }
}
