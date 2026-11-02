// Delivery scenarios: foreground typing restores the previous front window; background typing lands
// in Notepad's document without a focus change, and is refused with BackgroundUnavailable for a WPF
// window (WPF ignores posted keyboard input). The target text and the foreground come from the
// independent observer.
import { type Engine, errorCode } from "./engine"
import type { QaWindow } from "./fixtures"
import { type Observation, observe, observeUntil, windowText } from "./observer"
import { marker, type Scenario, type ScenarioContext, verdict, withEngine } from "./scenario-kit"

export async function bringToFront(engine: Engine, front: QaWindow, others: readonly string[]): Promise<Observation> {
  await engine.exec("raiseWindow", { windowId: front.id })
  return observeUntil([...others, front.id], (observation) => String(observation.foreground) === front.id)
}

interface Stage {
  readonly target: QaWindow
  readonly front: QaWindow
  readonly before: Observation
}

async function notepadBehindNotepad(context: ScenarioContext, engine: Engine, tag: string): Promise<Stage> {
  await engine.activate()
  const target = await context.workspace.notepad(engine, `${tag}-target`)
  const front = await context.workspace.notepad(engine, `${tag}-front`)
  return { target, front, before: await bringToFront(engine, front, [target.id]) }
}

function cursorUnchanged(before: Observation, after: Observation): boolean {
  return after.cursor.x === before.cursor.x && after.cursor.y === before.cursor.y
}

export const foregroundTypeRestoresFront: Scenario = {
  name: "foreground-type-notepad-restores-front",
  run: (context) =>
    withEngine(context, async (engine) => {
      const { target, front, before } = await notepadBehindNotepad(context, engine, "fg")
      const text = marker("fg")
      const reply = await engine.exec("typeText", { target: target.id, text, opts: { deliveryMode: "foreground" } })
      const after = await observeUntil([target.id, front.id], (seen) => windowText(seen, target.id).includes(text))
      return verdict({
        checks: [
          ["front-raised-before", String(before.foreground) === front.id],
          ["type-succeeded", reply.error === undefined],
          ["text-absent-before", !windowText(before, target.id).includes(text)],
          ["text-landed", windowText(after, target.id).includes(text)],
          ["front-restored", String(after.foreground) === front.id],
          ["cursor-unchanged", cursorUnchanged(before, after)],
        ],
        facts: { target: target.id, front: front.id, marker: text, typeError: errorCode(reply) ?? null },
        before,
        after,
      })
    }),
}

export const backgroundPostMessageNotepad: Scenario = {
  name: "background-post-message-notepad",
  run: (context) =>
    withEngine(context, async (engine) => {
      const { target, front, before } = await notepadBehindNotepad(context, engine, "bg")
      const text = marker("bg")
      const reply = await engine.exec("typeText", { target: target.id, text, opts: { deliveryMode: "background" } })
      const after = await observeUntil([target.id, front.id], (seen) => windowText(seen, target.id).includes(text))
      const landed = windowText(after, target.id).includes(text)
      return verdict({
        checks: [
          ["front-raised-before", String(before.foreground) === front.id],
          ["type-succeeded", reply.error === undefined],
          ["text-absent-before", !windowText(before, target.id).includes(text)],
          // An accepted post that never reaches the document is a silent drop.
          ["text-landed-in-document", landed],
          ["foreground-unchanged", after.foreground === before.foreground],
          ["cursor-unchanged", cursorUnchanged(before, after)],
        ],
        facts: {
          target: target.id,
          targetClass: before.windows[target.id]?.class ?? null,
          typeError: errorCode(reply) ?? null,
          message: reply.error?.message ?? null,
          acceptedAndLanded: reply.error === undefined && landed,
          acceptedAndDropped: reply.error === undefined && !landed,
        },
        before,
        after,
      })
    }),
}

export const backgroundPostMessageWpf: Scenario = {
  name: "background-post-message-wpf",
  run: (context) =>
    withEngine(context, async (engine) => {
      await engine.activate()
      const wpf = await context.workspace.wpfWindow(engine, "bg")
      const front = await context.workspace.notepad(engine, "wpf-front")
      const before = await bringToFront(engine, front, [wpf.id])
      const text = marker("wpf")
      const reply = await engine.exec("typeText", { target: wpf.id, text, opts: { deliveryMode: "background" } })
      const after = await observe([wpf.id, front.id])
      const wpfClass = before.windows[wpf.id]?.class ?? ""
      const message = reply.error?.message ?? ""
      return verdict({
        checks: [
          ["wpf-class", wpfClass.startsWith("HwndWrapper[")],
          ["front-raised-before", String(before.foreground) === front.id],
          ["refused-background-unavailable", errorCode(reply) === "BackgroundUnavailable"],
          ["refusal-names-wpf", message.includes("WPF") && message.includes(wpfClass)],
          ["text-unchanged", windowText(after, wpf.id) === windowText(before, wpf.id)],
          ["foreground-unchanged", after.foreground === before.foreground],
        ],
        facts: {
          target: wpf.id,
          targetClass: wpfClass,
          front: front.id,
          typeError: errorCode(reply) ?? null,
          message: reply.error?.message ?? null,
        },
        before,
        after,
      })
    }),
}
