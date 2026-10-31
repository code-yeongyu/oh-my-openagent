// listener-probe.mjs - dependency-free OpenCode plugin that samples the host
// process's EventEmitter state while the real oh-my-openagent plugin runs in
// the same process.
//
// Loaded by opencode alongside the real plugin (both listed in the sandbox
// opencode.jsonc `plugin` array). Every sample is one JSON line appended to
// $LISTENER_PROBE_OUT. Phase labels are read from $LISTENER_PROBE_OUT.phase so
// the driver can mark what it is doing (startup / sessions-active / ...).
//
// The probe itself adds exactly two process listeners: one `warning` listener
// (to capture MaxListenersExceededWarning) and one `exit` listener (final
// sample). Both are counted in the numbers it reports.
//
// Negative control: when LISTENER_PROBE_LEAK=N (default 0) the probe registers
// N no-op `SIGHUP` listeners at server-init and removes them in dispose. This
// proves the warning is observable by this probe at all, and that the raised
// cap is finite (N above the cap still warns).

import fs from "node:fs"

const OUT = process.env.LISTENER_PROBE_OUT
const PHASE_FILE = OUT ? `${OUT}.phase` : undefined
const WATCHED = [
  "exit",
  "beforeExit",
  "SIGINT",
  "SIGTERM",
  "SIGHUP",
  "uncaughtException",
  "unhandledRejection",
  "warning",
]
const SAMPLE_INTERVAL_MS = Number(process.env.LISTENER_PROBE_INTERVAL_MS ?? 500)
const LEAK = Number(process.env.LISTENER_PROBE_LEAK ?? 0)

let warnings = 0

function readPhase() {
  if (!PHASE_FILE) return "unknown"
  try {
    return fs.readFileSync(PHASE_FILE, "utf8").trim() || "unknown"
  } catch {
    return "unknown"
  }
}

function snapshot(kind, extra = {}) {
  if (!OUT) return
  const counts = {}
  for (const name of WATCHED) counts[name] = process.listenerCount(name)
  const record = {
    t: new Date().toISOString(),
    pid: process.pid,
    argv1: process.argv[1] ?? null,
    kind,
    phase: readPhase(),
    maxListeners: process.getMaxListeners(),
    eventNamesCount: process.eventNames().length,
    counts,
    warningsSoFar: warnings,
    ...extra,
  }
  try {
    fs.appendFileSync(OUT, `${JSON.stringify(record)}\n`)
  } catch {
    // never let the probe break the host
  }
}

process.on("warning", (w) => {
  const isMax = w && (w.name === "MaxListenersExceededWarning" || /MaxListenersExceeded/.test(String(w.message)))
  if (isMax) warnings += 1
  snapshot("process-warning", {
    warningName: w?.name ?? null,
    warningMessage: w?.message ?? String(w),
    isMaxListenersExceeded: Boolean(isMax),
  })
})

process.on("exit", (code) => {
  snapshot("process-exit", { exitCode: code })
})

// Taken when the module is evaluated, i.e. before any plugin's server() runs.
snapshot("module-import")

export default {
  id: "listener-probe",
  async server(input) {
    snapshot("server-init", { directory: input?.directory ?? null })
    const leaked = []
    if (LEAK > 0) {
      for (let i = 0; i < LEAK; i += 1) {
        const fn = () => {}
        leaked.push(fn)
        process.on("SIGHUP", fn)
      }
      // process.emitWarning delivers the 'warning' event on a later tick.
      await new Promise((resolve) => setTimeout(resolve, 50))
      snapshot("leak-injected", { leaked: leaked.length })
    }
    const timer = setInterval(() => snapshot("timer"), SAMPLE_INTERVAL_MS)
    if (typeof timer.unref === "function") timer.unref()
    return {
      event: async ({ event }) => {
        snapshot("event", { eventType: event?.type ?? null })
      },
      dispose: async () => {
        clearInterval(timer)
        for (const fn of leaked) process.removeListener("SIGHUP", fn)
        snapshot("dispose", { leakRemoved: leaked.length })
      },
    }
  },
}
