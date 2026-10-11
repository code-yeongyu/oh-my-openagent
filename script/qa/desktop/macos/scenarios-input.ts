import type { AgentSession } from "./agent"
import {
  closeKeySink, type KeySink, openKeySink, openTextEdit, quitTextEdit,
  settle, textEditSelection, textEditText,
} from "./fixtures"
import { focusSnapshot, type FocusSnapshot, jxa, sameJson, topmostAt } from "./observer"
import {
  clickCode, keyLands, onWindow, type RunOptions, type ScenarioResult, toolError, warmUp, withSession,
} from "./scenario"

async function withDesk<T>(docs: Readonly<Record<string, string>>, use: (sink: KeySink) => Promise<T>): Promise<T> {
  await quitTextEdit()
  for (const [name, text] of Object.entries(docs)) await openTextEdit(name, text)
  const sink = await openKeySink(Object.keys(docs).join("+"))
  try { return await use(sink) } finally {
    await closeKeySink(sink)
    await quitTextEdit()
  }
}

function focusIdentity(snapshot: FocusSnapshot) {
  const { frontmostApp, focusedWindow, cursor, zOrder } = snapshot
  return { frontmostApp, focusedWindow, cursor, frontWindow: zOrder[0] ?? null }
}

export async function backgroundClickKeepsFocus(options: RunOptions): Promise<ScenarioResult> {
  const doc = "qa-click.txt"
  const delivery = options.forceForeground ? "foreground" : "background"
  return withDesk({ [doc]: "omo qa click target\nsecond line\n" }, (sink) =>
    withSession(options, {}, async (session) => {
      const warm = await warmUp(session, doc)
      const before = await focusSnapshot()
      const selectionBefore = await textEditSelection(doc)
      const clicked = await session.call(clickCode(doc, delivery))
      const after = await focusSnapshot()
      const selectionAfter = await textEditSelection(doc)
      const keystroke = await keyLands(sink)
      const targetRankBefore = before.zOrder.findIndex((window) => window.startsWith("TextEdit#"))
      const targetWindow = before.zOrder[targetRankBefore]
      const targetRankAfter = targetWindow === undefined ? -1 : after.zOrder.indexOf(targetWindow)
      const focusUnchanged = sameJson(focusIdentity(before), focusIdentity(after))
        && targetRankBefore > 0 && targetRankAfter > 0
      const selectionChanged = !sameJson(selectionBefore, selectionAfter)
      return {
        scenario: "background-click-keeps-focus",
        pass: !warm.isError && !clicked.isError && focusUnchanged && selectionChanged && keystroke.landed,
        facts: {
          delivery, warmUpError: toolError(warm), clickError: toolError(clicked),
          observer: { before, after }, focusUnchanged, targetRankBefore, targetRankAfter,
          textEditSelection: { before: selectionBefore, after: selectionAfter },
          selectionChanged, keystroke,
        },
      }
    }),
  )
}

async function typeInto(session: AgentSession, doc: string, text: string, delivery: string) {
  const typed = await session.call(onWindow(doc, `await w.type(${JSON.stringify(text)}, { delivery: "${delivery}" });`))
  const textAfter = typed.isError ? await textEditText(doc)
    : await settle("typed text", () => textEditText(doc), (value) => value === text).catch(() => textEditText(doc))
  return { typed, textAfter }
}

export async function backgroundTypeSoleWindow(options: RunOptions): Promise<ScenarioResult> {
  const doc = "qa-type.txt"
  const text = "31415926535"
  return withDesk({ [doc]: "" }, (sink) =>
    withSession(options, {}, async (session) => {
      const warm = await warmUp(session, doc)
      const before = await focusSnapshot()
      const { typed, textAfter } = await typeInto(session, doc, text, "background")
      const after = await focusSnapshot()
      const keystroke = await keyLands(sink)
      const focusUnchanged = sameJson(focusIdentity(before), focusIdentity(after))
      return {
        scenario: "background-type-sole-window",
        pass: !warm.isError && !typed.isError && focusUnchanged && textAfter === text && keystroke.landed,
        facts: { warmUpError: toolError(warm), typeError: toolError(typed),
          observer: { before, after }, focusUnchanged, textEditText: textAfter, keystroke },
      }
    }),
  )
}

export async function backgroundTypeMultiwindowRefused(options: RunOptions): Promise<ScenarioResult> {
  const docs = { "qa-multi-a.txt": "alpha\n", "qa-multi-b.txt": "beta\n" }
  return withDesk(docs, () =>
    withSession(options, {}, async (session) => {
      const read = async () => ({
        a: await textEditText("qa-multi-a.txt"), b: await textEditText("qa-multi-b.txt"),
      })
      const before = await read()
      const typed = await session.call(onWindow("qa-multi-a.txt", 'await w.type("x", { delivery: "background" });'))
      const after = await read()
      const audit = session.auditLog().filter((record) => record.action === "typeText")
      const refused = typed.isError && audit.length === 1 && audit[0]?.code === "BackgroundUnavailable"
      return {
        scenario: "background-type-multiwindow-refused",
        pass: refused && sameJson(before, after),
        facts: { typeError: toolError(typed), auditTypeText: audit, refused, textEdit: { before, after } },
      }
    }),
  )
}

export async function foregroundRestores(options: RunOptions): Promise<ScenarioResult> {
  const doc = "qa-foreground.txt"
  const restored = async () => {
    const { frontmostApp, focusedWindow, cursor, zOrder } = await focusSnapshot()
    return { frontmostApp, focusedWindow, cursor, frontWindow: zOrder[0] ?? null }
  }
  return withDesk({ [doc]: "omo qa foreground target\nsecond line\n" }, (sink) =>
    withSession(options, {}, async (session) => {
      const before = await restored()
      const selectionBefore = await textEditSelection(doc)
      const topmostBefore = await topmostAt(doc, 0.5, 0.8)
      const clicked = await session.call(clickCode(doc, "foreground"))
      const after = await restored()
      const selectionAfter = await textEditSelection(doc)
      const keystroke = await keyLands(sink)
      const audit = session.auditLog().filter((record) => record.action === "click")
      const focusRestored = audit.length === 1 && audit[0]?.focusRestored === true
      const observerRestored = sameJson(before, after)
      const selectionChanged = !sameJson(selectionBefore, selectionAfter)
      return {
        scenario: "foreground-restores",
        pass: !clicked.isError && observerRestored && focusRestored && selectionChanged && keystroke.landed,
        facts: {
          clickError: toolError(clicked), topmostBefore, observer: { before, after }, observerRestored,
          auditClick: audit, focusRestored,
          textEditSelection: { before: selectionBefore, after: selectionAfter }, selectionChanged, keystroke,
        },
      }
    }),
  )
}

const SCROLL_DOC = "qa-scroll-once.txt"
const SCROLL_TEXT = Array.from({ length: 300 }, (_, i) => `line ${String(i + 1).padStart(3, "0")}`).join("\n") + "\n"
const firstVisible = async (): Promise<number> => {
  const range = await jxa(`const w = Application('System Events').processes.byName('TextEdit').windows.byName(${JSON.stringify(SCROLL_DOC)});
JSON.stringify(w.scrollAreas[0].textAreas[0].attributes.byName('AXVisibleCharacterRange').value())`)
  return Array.isArray(range) && typeof range[0] === "number" ? range[0] : Number.NaN
}

/** Lines one scroll of `dy` moves a freshly opened document, from its top. */
async function scrollOnce(session: AgentSession, delivery: string, dy: number): Promise<{ moved: number; error: string | null }> {
  await quitTextEdit(); await openTextEdit(SCROLL_DOC, SCROLL_TEXT)
  const before = await firstVisible()
  const result = await session.call(onWindow(SCROLL_DOC,
    `await w.scroll(Math.round(s.width / 2), Math.round(s.height / 2), { dy: ${dy}, delivery: "${delivery}" }); return "ok";`))
  const after = await settle("view moved", firstVisible, (value) => value !== before, 3_000).catch(() => firstVisible())
  // Each fixture line is 8 characters plus a newline.
  return { moved: Math.round((after - before) / 9), error: toolError(result) }
}

/** One background scroll moves the target exactly as far as one foreground scroll of the same delta (#9097). */
export async function backgroundScrollOnce(options: RunOptions): Promise<ScenarioResult> {
  return withSession(options, {}, async (session) => {
    // The sign that moves down from the top is whichever one moves the view; the scenario measures amount, not direction.
    let dy = 90
    let foreground = await scrollOnce(session, "foreground", dy)
    if (foreground.moved === 0) { dy = -90; foreground = await scrollOnce(session, "foreground", dy) }
    const frontBefore = (await focusSnapshot()).frontmostApp
    const background = await scrollOnce(session, "background", dy)
    const frontAfter = (await focusSnapshot()).frontmostApp
    await quitTextEdit()
    return {
      scenario: "background-scroll-once",
      pass: foreground.error === null && background.error === null && foreground.moved > 0
        && background.moved === foreground.moved && frontAfter === frontBefore,
      facts: { dy, foregroundLines: foreground.moved, backgroundLines: background.moved, foregroundError: foreground.error,
        backgroundError: background.error, frontBefore, frontAfter },
    }
  })
}
