// Scroll-direction scenarios: the engine's semantic scroll contract (positive `dy` moves the view
// toward the end of the content, negative toward the start) on a real Win32 EDIT, for background
// (posted WM_MOUSEWHEEL) and foreground (SendInput) delivery. The EDIT's first visible line comes
// from the independent observer (EM_GETFIRSTVISIBLELINE), never from the engine. The front window is
// a second scroll host, so a wheel delivered to the wrong window shows up in its event log. The
// foreground scenario ends with a control: one SendInput wheel injected by the QA side itself, which
// tells an engine that delivered nothing apart from a desktop that takes no injected wheel.
import { execFile } from "node:child_process"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { asObject, type Engine, errorCode, type Reply } from "./engine"
import { SCROLL_DOCUMENT, type ScrollWindow } from "./fixtures"
import { firstVisibleLine, type Observation, observeUntil } from "./observer"
import { type Scenario, type ScenarioContext, verdict, withEngine } from "./scenario-kit"
import { bringToFront } from "./scenarios-delivery"
import { HANG_GUARD_MS } from "./until"

const WHEEL_CONTROL_SCRIPT = fileURLToPath(new URL("./wheel-control.ps1", import.meta.url))
/** One SendInput wheel of three notches toward the end of the content (WHEEL_DELTA is 120). */
const CONTROL_WHEEL_DELTA = -360

/** Scroll deltas are pixels on every OS; the win32 backend sends one notch per 40 px, so 3 notches. */
const SCROLL_DELTA = 120
/**
 * The distance the view may move for SCROLL_DELTA px. Three notches at Windows' default of three
 * lines per notch (SPI_GETWHEELSCROLLLINES) are 9 lines, about 117 px at the EDIT's 13 px default
 * font; 0.5x..2x admits other fonts, DPI and lines-per-notch settings, and still rejects the old
 * 100-units-per-notch rule (1 notch, about 39 px).
 */
const DISTANCE_BOUNDS = { min: SCROLL_DELTA / 2, max: SCROLL_DELTA * 2 } as const

type DeliveryMode = "background" | "foreground"

async function scrollBy(engine: Engine, at: Record<string, string | number | null>, dy: number, mode: DeliveryMode): Promise<Reply> {
  return engine.exec("scroll", { ...at, dx: 0, dy, opts: { deliveryMode: mode } })
}

function lineMoved(ids: readonly string[], document: string, from: number): Promise<Observation> {
  return observeUntil(ids, (seen) => firstVisibleLine(seen, document) !== from)
}

/** Runs wheel-control.ps1; its `sent <n>` line, or the failure. */
function injectWheel(x: number, y: number, delta: number): Promise<string> {
  const args = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", WHEEL_CONTROL_SCRIPT]
  args.push("-X", String(x), "-Y", String(y), "-Delta", String(delta))
  return new Promise((resolve) => {
    execFile("powershell.exe", args, { timeout: HANG_GUARD_MS, windowsHide: true }, (error, stdout, stderr) => {
      resolve(error === null ? stdout.trim() : `failed: ${error.message} ${stderr.trim()}`)
    })
  })
}

interface Control {
  readonly injected: string
  readonly before: number
  readonly after: number
}

/** Raises the target, injects the control wheel at its centre, then gives the front window back. */
async function controlWheel(engine: Engine, document: ScrollWindow, front: ScrollWindow): Promise<Control> {
  const raised = await bringToFront(engine, document, [front.id])
  const rect = raised.windows[document.id]?.rect
  const before = firstVisibleLine(raised, document.id)
  if (rect === undefined) return { injected: "skipped: no target rect", before, after: before }
  const x = Math.floor((rect.left + rect.right) / 2)
  const y = Math.floor((rect.top + rect.bottom) / 2)
  const injected = await injectWheel(x, y, CONTROL_WHEEL_DELTA)
  const after = firstVisibleLine(await lineMoved([document.id, front.id], document.id, before), document.id)
  await bringToFront(engine, front, [document.id])
  return { injected, before, after }
}

function hostEvents(window: ScrollWindow): string[] {
  return readFileSync(window.eventLog, "utf8")
    .split("\n")
    .filter((line) => line !== "")
}

/** The `lineHeight <px>` the scroll host measured on its own EDIT; 0 when it recorded none. */
function lineHeight(window: ScrollWindow): number {
  const recorded = hostEvents(window).find((event) => event.startsWith("lineHeight "))
  const pixels = Number(recorded?.slice("lineHeight ".length))
  return Number.isFinite(pixels) ? pixels : 0
}

function scrollDirection(mode: DeliveryMode): Scenario {
  return {
    name: `scroll-direction-${mode}`,
    run: (context: ScenarioContext) =>
      withEngine(context, async (engine) => {
        await engine.activate()
        const document = await context.workspace.scrollWindow(engine, mode)
        const front = await context.workspace.scrollWindow(engine, `${mode}-front`)
        const ids = [document.id, front.id]
        const frame = asObject(await engine.result("capture", { target: document.id }))
        const at = {
          target: document.id,
          x: Math.floor(Number(frame.width) / 2),
          y: Math.floor(Number(frame.height) / 2),
          frameId: typeof frame.frameId === "string" ? frame.frameId : null,
        }
        const before = await bringToFront(engine, front, [document.id])
        const start = firstVisibleLine(before, document.id)
        const down = await scrollBy(engine, at, SCROLL_DELTA, mode)
        const middle = await lineMoved(ids, document.id, start)
        const afterPositive = firstVisibleLine(middle, document.id)
        const up = await scrollBy(engine, at, -SCROLL_DELTA, mode)
        const after = await lineMoved(ids, document.id, afterPositive)
        const afterNegative = firstVisibleLine(after, document.id)
        const control = mode === "foreground" ? await controlWheel(engine, document, front) : undefined
        const frontEvents = hostEvents(front)
        const linePixels = lineHeight(document)
        const pixelsMoved = (afterPositive - start) * linePixels
        return verdict({
          checks: [
            ["front-raised-before", String(before.foreground) === front.id],
            ["document-opens-mid-content", start === SCROLL_DOCUMENT.firstVisibleLine],
            ["positive-dy-succeeded", down.error === undefined],
            ["positive-dy-moves-toward-end", afterPositive > start],
            ["line-height-measured", linePixels > 0],
            ["positive-dy-distance-within-bounds", pixelsMoved >= DISTANCE_BOUNDS.min && pixelsMoved <= DISTANCE_BOUNDS.max],
            ["negative-dy-succeeded", up.error === undefined],
            ["negative-dy-moves-toward-start", afterNegative >= 0 && afterNegative < afterPositive],
            ["negative-dy-returns-to-start", afterNegative === start],
            ["front-received-no-wheel", !frontEvents.some((event) => event.includes("wheel"))],
            [mode === "background" ? "foreground-unchanged" : "front-restored", after.foreground === before.foreground],
            ...(control === undefined
              ? []
              : [["control-sendinput-wheel-scrolls-target", control.after > control.before] as const]),
          ],
          facts: {
            target: document.id,
            targetClass: before.windows[document.id]?.class ?? null,
            front: front.id,
            deliveryMode: mode,
            delta: SCROLL_DELTA,
            lineHeight: linePixels,
            linesMoved: afterPositive - start,
            pixelsMoved,
            distanceBounds: DISTANCE_BOUNDS,
            point: { x: at.x, y: at.y },
            firstVisibleLine: { before: start, afterPositiveDy: afterPositive, afterNegativeDy: afterNegative },
            frontFirstVisibleLine: { before: firstVisibleLine(before, front.id), after: firstVisibleLine(after, front.id) },
            targetEvents: hostEvents(document),
            frontEvents,
            cursorAfterPositiveDy: middle.cursor,
            cursorWindowAfterPositiveDy: middle.raw.cursorWindow ?? null,
            control: control === undefined ? null : { ...control, delta: CONTROL_WHEEL_DELTA },
            positiveDyError: errorCode(down) ?? null,
            negativeDyError: errorCode(up) ?? null,
          },
          before,
          after,
        })
      }),
  }
}

export const scrollDirectionBackground = scrollDirection("background")
export const scrollDirectionForeground = scrollDirection("foreground")
