// Guard scenarios: input into a window above the engine's integrity level is refused (UIPI), and the
// RegisterHotKey stop chord latches the engine until the host resumes it.
import {
  asObject,
  DEFAULT_STOP_CHORD,
  type Engine,
  type EngineNotification,
  errorCode,
  type JsonObject,
} from "./engine"
import { listWindows } from "./fixtures"
import { integrityLabel, observe, observeUntil, windowText } from "./observer"
import { marker, type Scenario, type ScenarioContext, verdict, withEngine } from "./scenario-kit"

const SYSTEM_PROCESSES = new Set(["csrss", "winlogon", "logonui"])
export const INVALID_STOP_CHORD = "ctrl+alt+shift+nonexistentkey"

async function runnerIntegrityFacts(context: ScenarioContext): Promise<JsonObject> {
  return withEngine(context, async (engine) => {
    await engine.activate()
    const capabilities = asObject(await engine.result("capabilities"))
    const windows = await listWindows(engine)
    const observation = await observe(windows.map((window) => window.id))
    const system = windows.filter((window) => {
      const name = observation.windows[window.id]?.processName?.toLowerCase() ?? ""
      return SYSTEM_PROCESSES.has(name)
    })
    return {
      engineIntegrity: capabilities.integrityLevel ?? null,
      runnerIntegrity: observation.runnerIntegrity,
      systemWindows: system.map((window) => ({ id: window.id, elevated: window.elevated })),
    }
  })
}

export const elevatedWindowRefused: Scenario = {
  name: "elevated-window-refused",
  run: async (context) => {
    const runner = await runnerIntegrityFacts(context)
    const systemWindows = Array.isArray(runner.systemWindows) ? runner.systemWindows.map(asObject) : []
    const lowBinary = context.workspace.lowIntegrityEngine(context.binary)
    return withEngine(
      context,
      async (low) => {
        await low.activate()
        const lowIntegrity = asObject(await low.result("capabilities")).integrityLevel ?? null
        const notepad = await context.workspace.notepad(low, "uipi")
        const before = await observe([notepad.id], low.pid)
        const capture = await low.call("capture", { target: notepad.id })
        const frameId = capture.result === undefined ? null : asObject(capture.result).frameId
        const point = { target: notepad.id, x: 20, y: 20, ...(typeof frameId === "string" ? { frameId } : {}) }
        const click = await low.exec("click", point)
        const typed = await low.exec("typeText", { target: notepad.id, text: marker("uipi") })
        const after = await observe([notepad.id])
        return verdict({
          checks: [
            ["engine-integrity-matches-whoami", runner.engineIntegrity === runner.runnerIntegrity],
            ["system-windows-flagged-elevated", systemWindows.every((window) => window.elevated === true)],
            ["low-engine-reports-low", lowIntegrity === "low"],
            ["observer-reads-low-engine-low", integrityLabel(before.integrityRid) === "low"],
            ["window-flagged-elevated", notepad.elevated === true],
            ["click-refused-permission-denied", errorCode(click) === "PermissionDenied"],
            ["type-refused-permission-denied", errorCode(typed) === "PermissionDenied"],
            ["text-unchanged", windowText(after, notepad.id) === windowText(before, notepad.id)],
            ["foreground-unchanged", after.foreground === before.foreground],
          ],
          facts: {
            ...runner,
            lowEngineIntegrity: lowIntegrity,
            observerLowEngineRid: before.integrityRid ?? null,
            target: notepad.id,
            targetElevated: notepad.elevated,
            captureError: errorCode(capture) ?? null,
            clickError: errorCode(click) ?? null,
            clickMessage: click.error?.message ?? null,
            typeError: errorCode(typed) ?? null,
          },
          before,
          after,
        })
      },
      lowBinary,
    )
  },
}

function announcesSuspended(notification: EngineNotification): boolean {
  if (notification.method !== "stopPath.changed") return false
  const params = notification.params
  return params !== null && typeof params === "object" && !Array.isArray(params) && params.suspended === true
}

// The latch is observed as the engine's `stopPath.changed` announcement, which leaves the engine
// behind a heartbeat reply while the host heartbeats.
async function waitForLatch(engine: Engine): Promise<JsonObject> {
  const stopHeartbeat = engine.hostHeartbeat()
  try {
    await engine.waitForNotification(announcesSuspended)
  } finally {
    stopHeartbeat()
  }
  return asObject(await engine.result("stopPath.status"))
}

export const hotkeyLatches: Scenario = {
  name: "hotkey-latches",
  run: (context) =>
    withEngine(context, async (engine) => {
      const chord = context.sabotage === "invalid-chord" ? INVALID_STOP_CHORD : DEFAULT_STOP_CHORD
      const started = await engine.activate({}, chord)
      const capabilities = asObject(await engine.result("capabilities"))
      const notepad = await context.workspace.notepad(engine, "hotkey")
      const before = await observe([notepad.id])
      const trigger = await engine.exec("keyChord", { target: "desktop", keys: chord.split("+") })
      // The chord may latch before the keyChord's closing gate check, which then reports Suspended.
      const triggerCode = errorCode(trigger)
      const triggered = triggerCode === undefined || triggerCode === "Suspended"
      const latched = triggered ? await waitForLatch(engine) : asObject(await engine.result("stopPath.status"))
      const blockedText = marker("blocked")
      const foreground = { deliveryMode: "foreground" }
      const blocked = await engine.exec("typeText", { target: notepad.id, text: blockedText, opts: foreground })
      const resumed = await engine.call("stopPath.resume", { token: engine.resumeToken })
      const resumedStatus = resumed.result === undefined ? {} : asObject(resumed.result)
      // The stop revoked the foreground grant and resume never restores it (#9651 B5): the human
      // confirms again, so the host re-grants before foreground input lands.
      const controlAfterResume = asObject(await engine.result("control.state"))
      await engine.grant()
      const liveText = marker("resumed")
      const live = await engine.exec("typeText", { target: notepad.id, text: liveText, opts: foreground })
      const after = await observeUntil([notepad.id], (seen) => windowText(seen, notepad.id).includes(liveText))
      return verdict({
        checks: [
          [triggered ? "chord-posted" : (triggerCode ?? "chord-posted"), triggered],
          ["global-listener-live", started.globalLive === true],
          ["latched-suspended", latched.suspended === true],
          ["suspended-input-refused", errorCode(blocked) === "Suspended"],
          ["suspended-text-never-landed", !windowText(after, notepad.id).includes(blockedText)],
          ["resume-unsuspends", resumed.error === undefined && resumedStatus.suspended === false],
          ["resume-does-not-restore-the-grant", controlAfterResume.active === false],
          ["resumed-input-lands", live.error === undefined && windowText(after, notepad.id).includes(liveText)],
        ],
        facts: {
          chord,
          startStatus: started,
          stopPath: capabilities.stopPath ?? null,
          stopReason: capabilities.stopReason ?? null,
          triggerError: triggerCode ?? null,
          triggerMessage: trigger.error?.message ?? null,
          latchedStatus: latched,
          blockedError: errorCode(blocked) ?? null,
          resumeError: errorCode(resumed) ?? null,
          liveError: errorCode(live) ?? null,
          controlAfterResume,
        },
        before,
        after,
      })
    }),
}
