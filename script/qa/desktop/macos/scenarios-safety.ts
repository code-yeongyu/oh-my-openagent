import { statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { isRecord, type Json, type ToolOutcome } from "./agent"
import { countCanaryDialogs, openTextEdit, quitTextEdit, settle, textEditText, workDir } from "./fixtures"
import { command, launcherPermissions } from "./observer"
import {
  clickCode, onWindow, type RunOptions, type ScenarioResult, toolError, warmUp, withSession,
} from "./scenario"

const recordOf = (value: unknown): Json => isRecord(value) ? value : {}
const EXPECTED = {
  capturePermission: "granted", inputPermission: "granted", axPermission: "granted",
  stopPath: "global", backgroundWindowInput: true,
} as const

export async function preflight(options: RunOptions): Promise<ScenarioResult> {
  const host = {
    productVersion: await command("/usr/bin/sw_vers", ["-productVersion"]),
    buildVersion: await command("/usr/bin/sw_vers", ["-buildVersion"]),
    arch: await command("/usr/bin/uname", ["-m"]),
    launchdSession: await command("/bin/launchctl", ["managername"]),
  }
  const probe = join(workDir, "probe.png")
  const screencapture = await command("/usr/sbin/screencapture", ["-x", probe])
    .then(() => statSync(probe).size > 0).catch(() => false)
  const launcher = await launcherPermissions()
  // Even preflight drives the packaged OmO component in an isolated real Senpi process.
  return withSession(options, {}, async (session) => {
    const result = await session.call({ action: "capabilities" })
    const capabilities = recordOf(result.details.value)
    const matches = Object.entries(EXPECTED).every(([key, value]) => capabilities[key] === value)
    return {
      scenario: "preflight",
      pass: !result.isError && matches && launcher.accessibilityTrusted &&
        launcher.screenCaptureAccess && !launcher.screenLocked && screencapture,
      facts: { host, capabilities, expected: EXPECTED, launcher, screencapture },
    }
  })
}

const STOP_CHORD = "ctrl+alt+cmd+escape"
const statusSuspended = (status: string): boolean | null => {
  const flag = /^stop: stopPath=\S+ suspended=(true|false)\b/m.exec(status)?.[1]
  return flag === undefined ? null : flag === "true"
}

async function kvmShot(options: RunOptions, jetkvm: string, name: string): Promise<string | null> {
  if (options.kvmShots === undefined) return null
  const output = join(options.kvmShots, name)
  await command(jetkvm, ["screenshot", "--output", output])
  return output
}

export async function killswitchRealHid(options: RunOptions): Promise<ScenarioResult> {
  if (options.jetkvm === undefined)
    return { scenario: "killswitch-real-hid", pass: false, facts: { error: "JETKVM is not set" } }
  const jetkvm = options.jetkvm
  const doc = "qa-killswitch.txt"
  const longText = "0123456789".repeat(200)
  await quitTextEdit()
  await openTextEdit(doc, "")
  try {
    return await withSession(options, {}, async (session) => {
      const typing = session.call(onWindow(doc,
        `await w.type(${JSON.stringify(longText)}, { delivery: "background" });`))
      await settle("typing started", () => textEditText(doc), (text) => text.length > 20)
      const before = await kvmShot(options, jetkvm, "killswitch-before.png")
      await command(jetkvm, ["key", "chord", STOP_CHORD])
      const typed = await typing
      const typedLength = (await textEditText(doc)).length
      const after = await kvmShot(options, jetkvm, "killswitch-after.png")
      const suspended = (action: string) =>
        session.auditLog().filter((item) => item.action === action && item.code === "Suspended").length
      const typeSuspended = suspended("typeText") === 1
      const blocked = await session.call(clickCode(doc, "background"))
      const clickSuspended = blocked.isError && suspended("click") === 1
      const status = await session.command("status")
      const resume = await session.command("resume")
      const statusAfterResume = await session.command("status")
      const resumed = await session.call(clickCode(doc, "background"))
      const resumeOk = !resumed.isError && /suspended=false/.test(resume) &&
        statusSuspended(statusAfterResume) === false
      return {
        scenario: "killswitch-real-hid",
        pass: typedLength < longText.length && typeSuspended && clickSuspended &&
          statusSuspended(status) === true && resumeOk,
        facts: {
          chord: STOP_CHORD, typeError: toolError(typed), typedLength, audit: session.auditLog(),
          auditTypeSuspended: typeSuspended, clickWhileSuspended: toolError(blocked),
          auditClickSuspended: clickSuspended, status, resume, statusAfterResume, resumeOk,
          resumedClickError: toolError(resumed), kvmScreenshots: [before, after],
        },
      }
    })
  } finally { await quitTextEdit() }
}

async function imageFacts(path: string): Promise<{ readonly format: string | null; readonly width: number | null }> {
  const text = await command("/usr/bin/sips", ["-g", "format", "-g", "pixelWidth", path])
  const width = /pixelWidth: (\d+)/.exec(text)?.[1]
  return { format: /format: (\w+)/.exec(text)?.[1] ?? null,
    width: width === undefined ? null : Number(width) }
}

async function budgetCapture(options: RunOptions, computer: Json, label: string) {
  return withSession(options, computer, async (session) => {
    const result = await session.call({ action: "call", chain: [{ method: "screenshot" }] })
    const frame = recordOf(result.details.value)
    const inline = result.images[0]
    const inlineFile = join(workDir, `${label}-inline.img`)
    if (inline !== undefined) writeFileSync(inlineFile, Buffer.from(inline.data, "base64"))
    const artifact = typeof frame.path === "string" ? frame.path : null
    return {
      settings: computer, error: toolError(result), inlineMimeType: inline?.mimeType ?? null,
      inlineBytes: inline === undefined ? null : Buffer.byteLength(inline.data, "base64"),
      inlineImage: inline === undefined ? null : await imageFacts(inlineFile),
      displayedWidth: frame.width ?? null, sourceWidth: frame.sourceWidth ?? null,
      artifactPath: artifact,
      artifactBytes: artifact === null ? null : statSync(artifact, { throwIfNoEntry: false })?.size ?? null,
      artifactImage: artifact === null ? null : await imageFacts(artifact),
    }
  })
}

export async function screenshotBudget(options: RunOptions): Promise<ScenarioResult> {
  const budget = 200_000
  const jpeg = await budgetCapture(options, {
    screenshot_max_bytes: budget, max_width: 1280, max_height: 720,
  }, "jpeg")
  const artifact = await budgetCapture(options, { screenshot_max_bytes: budget }, "artifact")
  const jpegOk = jpeg.inlineMimeType === "image/jpeg" && jpeg.inlineImage?.format === "jpeg" &&
    (jpeg.inlineBytes ?? Infinity) <= budget && typeof jpeg.sourceWidth === "number" &&
    jpeg.sourceWidth > (jpeg.inlineImage?.width ?? Infinity)
  const artifactOk = artifact.inlineMimeType === null && artifact.artifactBytes !== null &&
    artifact.artifactImage?.width === artifact.sourceWidth
  return { scenario: "screenshot-budget", pass: jpegOk && artifactOk,
    facts: { jpeg, artifact, jpegOk, artifactOk } }
}

export async function capabilitiesTruth(options: RunOptions): Promise<ScenarioResult> {
  const doc = "qa-capabilities.txt"
  await quitTextEdit()
  await openTextEdit(doc, "capabilities\n")
  try {
    const launcher = await launcherPermissions()
    return await withSession(options, {}, async (session) => {
      const warm = await warmUp(session, doc)
      const capabilities = recordOf((await session.call({ action: "capabilities" })).details.value)
      const expected = launcher.skylightSpi && launcher.accessibilityTrusted && !warm.isError
      return {
        scenario: "capabilities-truth",
        pass: capabilities.backgroundWindowInput === expected &&
          capabilities.screenLocked === false && !launcher.screenLocked,
        facts: { launcher, canaryWarmUpError: toolError(warm),
          expectedBackgroundWindowInput: expected, capabilities },
      }
    })
  } finally { await quitTextEdit() }
}

// `computer.macos_canary`: "session" shows the canary dialog exactly once per session, "off" never
// shows it. Either way both background inputs must still succeed. The dialog count comes from an
// independent System Events observer, not from the engine.
export async function canary(options: RunOptions, mode: "session" | "off"): Promise<ScenarioResult> {
  const doc = "qa-canary.txt"
  const expectedDialogs = mode === "session" ? 1 : 0
  await quitTextEdit()
  await openTextEdit(doc, "canary target\n")
  try {
    return await withSession(options, { macos_canary: mode }, async (session) => {
      const counter = await countCanaryDialogs()
      let first: ToolOutcome
      let second: ToolOutcome
      let dialogs: readonly number[]
      try {
        first = await warmUp(session, doc)
        second = await session.call(clickCode(doc, "background"))
      } finally {
        dialogs = await counter.stop()
      }
      return { scenario: mode === "session" ? "canary" : "canary-off",
        pass: !first.isError && !second.isError && dialogs.length === expectedDialogs,
        facts: { mode, expectedDialogs, firstError: toolError(first), secondError: toolError(second), canaryDialogPids: dialogs } }
    })
  } finally { await quitTextEdit() }
}
