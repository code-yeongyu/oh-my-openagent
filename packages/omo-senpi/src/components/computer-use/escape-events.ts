import type { createEscapeStopGate } from "./escape-stop-gate"

/** Input arrival records attribution; only actual delivery lifts the turn stop. */
export function wireComputerEscapeEvents(
  pi: { on(event: string, handler: (payload: unknown) => unknown | Promise<unknown>): void },
  runtime: { started(): Promise<{ escapeStopGate: ReturnType<typeof createEscapeStopGate> }> | undefined } | undefined,
): void {
  if (runtime === undefined) return
  pi.on("input", async (payload) => {
    const started = runtime.started()
    if (started !== undefined) (await started).escapeStopGate.userInput(payload)
  })
  pi.on("input_disposition", async (payload) => {
    if (typeof payload !== "object" || payload === null || !("inputId" in payload) ||
        typeof payload.inputId !== "string" || !("disposition" in payload)) return
    const started = runtime.started()
    if (started === undefined) return
    const gate = (await started).escapeStopGate
    if (payload.disposition === "started") gate.inputStarted(payload.inputId)
    else if (payload.disposition === "handled" || payload.disposition === "rejected") gate.inputDiscarded(payload.inputId)
  })
}
