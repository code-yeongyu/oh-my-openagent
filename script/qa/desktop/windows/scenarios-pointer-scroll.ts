// Foreground scroll scenarios (#9095): the engine's SendInput wheel must scroll the target's EDIT and
// nothing else, with the cursor parked elsewhere before each request. `foreground-scroll-moves-target`
// uses the covered layout; `foreground-scroll-same-rect` is #9062's shape, both hosts on one rect.
// The first visible line comes from the independent probe (EM_GETFIRSTVISIBLELINE), never from the
// engine.
import { eventAt, HOST_FIRST_VISIBLE_LINE, type PointerHost, type PointerProbe, pointerEvents, probeHostsUntil } from "./pointer-kit"
import {
  at,
  COVERED,
  framePoint,
  type Layout,
  outcome,
  POINT_TOLERANCE,
  replyFacts,
  restoreChecks,
  SAME_RECT,
  stage,
  stagingChecks,
} from "./pointer-stage"
import { type Scenario, withEngine } from "./scenario-kit"

/** Three wheel notches: scroll deltas are pixels, 40 per notch (#9101). */
const SCROLL_DELTA = 120

function firstLine(seen: PointerProbe, host: PointerHost): number {
  return seen.hosts[host.id]?.firstVisibleLine ?? -1
}

function foregroundScroll(name: string, layout: Layout): Scenario {
  return {
    name,
    run: (context) =>
      withEngine(context, async (engine) => {
        const state = await stage(context, engine, name, layout)
        const hosts = [state.target, state.front]
        const point = framePoint(state, 0.5, 0.5)
        const scroll = (dy: number) =>
          engine.exec("scroll", { ...at(state, point.frame), dx: 0, dy, opts: { deliveryMode: "foreground" } })
        const start = firstLine(state.before, state.target)
        const down = await scroll(SCROLL_DELTA)
        const middle = await probeHostsUntil(hosts, (seen) => firstLine(seen, state.target) !== start)
        const afterPositive = firstLine(middle, state.target)
        const up = await scroll(-SCROLL_DELTA)
        const after = await probeHostsUntil(hosts, (seen) => firstLine(seen, state.target) !== afterPositive)
        const afterNegative = firstLine(after, state.target)
        const wheels = pointerEvents(state.target, "wheel")
        return outcome(
          state,
          [
            ...stagingChecks(state, point.screen),
            ["document-opens-mid-content", start === HOST_FIRST_VISIBLE_LINE],
            ["positive-dy-succeeded", down.error === undefined],
            ["positive-dy-moves-target-toward-end", afterPositive > start],
            ["negative-dy-succeeded", up.error === undefined],
            ["negative-dy-returns-target-to-start", afterNegative === start],
            ["target-wheels-at-point", wheels.length === 2 && wheels.every((line) => eventAt(line, point.screen, POINT_TOLERANCE))],
            ["front-got-no-wheel", pointerEvents(state.front, "wheel").length === 0],
            ["front-document-unmoved", firstLine(after, state.front) === HOST_FIRST_VISIBLE_LINE],
            ...restoreChecks(state, after),
          ],
          {
            point: { ...point },
            firstVisibleLine: { before: start, afterPositiveDy: afterPositive, afterNegativeDy: afterNegative },
            ...replyFacts("positiveDy", down),
            ...replyFacts("negativeDy", up),
          },
          after,
        )
      }),
  }
}

export const foregroundScrollMovesTarget = foregroundScroll("foreground-scroll-moves-target", COVERED)
export const foregroundScrollSameRect = foregroundScroll("foreground-scroll-same-rect", SAME_RECT)
