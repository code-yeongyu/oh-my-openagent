// Foreground click and drag scenarios (#9095): the engine's SendInput button presses must land in the
// target window at the requested point even when another window covers that point and the cursor
// starts parked over that other window. An engine that sends a button before the cursor reached the
// intended point delivers it to the front window, whose event log records it.
import { eventAt, pointerEvents, probeHostsUntil } from "./pointer-kit"
import {
  at,
  COVERED,
  framePoint,
  outcome,
  POINT_TOLERANCE,
  replyFacts,
  restoreChecks,
  stage,
  stagingChecks,
} from "./pointer-stage"
import { type Scenario, withEngine } from "./scenario-kit"

export const foregroundClickLandsInTarget: Scenario = {
  name: "foreground-click-lands-in-target",
  run: (context) =>
    withEngine(context, async (engine) => {
      const state = await stage(context, engine, "click", COVERED)
      const point = framePoint(state, 0.5, 0.5)
      const reply = await engine.exec("click", { ...at(state, point.frame), opts: { deliveryMode: "foreground" } })
      const after = await probeHostsUntil(
        [state.target, state.front],
        () => pointerEvents(state.target, "mouseup").length > 0 || pointerEvents(state.front, "mouseup").length > 0,
      )
      const down = pointerEvents(state.target, "mousedown")
      return outcome(
        state,
        [
          ...stagingChecks(state, point.screen),
          ["click-succeeded", reply.error === undefined],
          ["target-got-one-press-at-point", down.length === 1 && down.every((line) => eventAt(line, point.screen, POINT_TOLERANCE))],
          ["target-got-release", pointerEvents(state.target, "mouseup").length === 1],
          ["front-got-no-press", pointerEvents(state.front, "mousedown").length === 0],
          ...restoreChecks(state, after),
        ],
        { point: { ...point }, ...replyFacts("click", reply) },
        after,
      )
    }),
}

export const foregroundDragSelectsInTarget: Scenario = {
  name: "foreground-drag-selects-in-target",
  run: (context) =>
    withEngine(context, async (engine) => {
      const state = await stage(context, engine, "drag", COVERED)
      const from = framePoint(state, 0.55, 0.5)
      const to = framePoint(state, 0.9, 0.5)
      const path = [from.frame, framePoint(state, 0.7, 0.5).frame, to.frame]
      const reply = await engine.exec("drag", {
        target: state.target.id,
        path: path.map((point) => ({ x: point.x, y: point.y })),
        frameId: state.frame.id,
        opts: { deliveryMode: "foreground" },
      })
      const after = await probeHostsUntil(
        [state.target, state.front],
        () => pointerEvents(state.target, "mouseup").length > 0 || pointerEvents(state.front, "mouseup").length > 0,
      )
      const selection = after.hosts[state.target.id]?.selection ?? { start: -1, end: -1 }
      const frontSelection = after.hosts[state.front.id]?.selection ?? { start: -1, end: -1 }
      const down = pointerEvents(state.target, "mousedown")
      const up = pointerEvents(state.target, "mouseup")
      return outcome(
        state,
        [
          ...stagingChecks(state, from.screen),
          ["drag-succeeded", reply.error === undefined],
          ["target-press-at-path-start", down.length === 1 && down.every((line) => eventAt(line, from.screen, POINT_TOLERANCE))],
          ["target-release-at-path-end", up.length === 1 && up.every((line) => eventAt(line, to.screen, POINT_TOLERANCE))],
          ["target-text-selected", selection.end > selection.start && selection.start >= 0],
          ["front-got-no-press", pointerEvents(state.front, "mousedown").length === 0],
          ["front-selection-empty", frontSelection.start === frontSelection.end],
          ...restoreChecks(state, after),
        ],
        { from: { ...from }, to: { ...to }, selection: { ...selection }, ...replyFacts("drag", reply) },
        after,
      )
    }),
}
