// Read-only scenarios: the primary-display capture and the UI Automation snapshot of Notepad, each
// cross-checked against the independent observer.
import { asObject, errorCode, type JsonObject } from "./engine"
import { observe, windowText } from "./observer"
import { type Scenario, type ScenarioContext, verdict, withEngine } from "./scenario-kit"

const PNG_SIGNATURE = "89504e470d0a1a0a"

function pngSize(base64: string): { signature: boolean; width: number; height: number } {
  const bytes = Buffer.from(base64, "base64")
  if (bytes.length < 24) return { signature: false, width: 0, height: 0 }
  return {
    signature: bytes.subarray(0, 8).toString("hex") === PNG_SIGNATURE,
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  }
}

async function primaryDisplay(context: ScenarioContext): Promise<JsonObject | undefined> {
  return withEngine(context, async (engine) => {
    await engine.activate()
    const displays = await engine.result("displays")
    if (!Array.isArray(displays)) throw new Error(`displays() is not an array: ${JSON.stringify(displays)}`)
    return displays.map(asObject).find((display) => display.isPrimary === true)
  })
}

export const capturePrimary: Scenario = {
  name: "capture-primary",
  run: async (context) => {
    const primary = await primaryDisplay(context)
    if (primary === undefined) {
      return verdict({ checks: [["primary-display-listed", false]], facts: {}, before: null, after: null })
    }
    return withEngine(context, async (engine) => {
      await engine.activate({ display: String(primary.id) })
      const before = await observe([])
      const reply = await engine.call("capture", { target: "desktop", caps: { maxBytes: 200_000_000 } })
      const after = await observe([])
      const result = reply.result === undefined ? {} : asObject(reply.result)
      const png = typeof result.data === "string" ? pngSize(result.data) : { signature: false, width: 0, height: 0 }
      const pixel = { width: Number(primary.pixelWidth), height: Number(primary.pixelHeight) }
      const source = { width: Number(result.sourceWidth), height: Number(result.sourceHeight) }
      const image = { width: Number(result.width), height: Number(result.height) }
      return verdict({
        checks: [
          ["capture-succeeded", reply.error === undefined],
          ["inline-png", result.mode === "inline-png" && result.mimeType === "image/png" && png.signature],
          ["png-is-reported-size", png.width === image.width && png.height === image.height],
          ["source-is-primary-pixels", source.width === pixel.width && source.height === pixel.height],
          [
            "observer-primary-screen-matches",
            after.primaryScreen.width === pixel.width && after.primaryScreen.height === pixel.height,
          ],
        ],
        facts: {
          displayId: String(primary.id),
          scale: primary.scale ?? null,
          primaryPixels: pixel,
          captureError: errorCode(reply) ?? null,
          mode: result.mode ?? null,
          mimeType: result.mimeType ?? null,
          source,
          image,
          png: { width: png.width, height: png.height },
          observerDpiAware: after.raw.dpiAware ?? null,
          observerPrimaryScreen: after.primaryScreen,
        },
        before,
        after,
      })
    })
  },
}

function documentLine(text: string): string | undefined {
  return text
    .split("\n")
    .map((line) => line.trimStart())
    .find((line) => (line.startsWith("- textfield") || line.startsWith("- textarea")) && line.includes("[ref=e"))
}

const EDITABLE_CONTROL = /^(ControlType\.(Edit|Document)|Win32\.(Edit|RichEdit\w*))$/

export const uiaSnapshotNotepad: Scenario = {
  name: "uia-snapshot-notepad",
  run: (context) =>
    withEngine(context, async (engine) => {
      await engine.activate()
      const notepad = await context.workspace.notepad(engine, "uia")
      const before = await observe([notepad.id])
      const reply = await engine.call("ax.snapshot", { target: notepad.id })
      const after = await observe([notepad.id])
      const snapshot = reply.result === undefined ? {} : asObject(reply.result)
      const text = typeof snapshot.text === "string" ? snapshot.text : ""
      const line = documentLine(text)
      const observed = before.windows[notepad.id]
      return verdict({
        checks: [
          ["snapshot-succeeded", reply.error === undefined],
          ["document-line-with-ref", line !== undefined],
          ["observer-sees-edit-or-document", EDITABLE_CONTROL.test(observed?.controlType ?? "")],
          ["observer-reads-file-content", windowText(before, notepad.id).includes(notepad.content)],
          ["snapshot-carries-file-content", line?.includes(notepad.content) === true],
          ["read-left-foreground-alone", before.foreground === after.foreground],
        ],
        facts: {
          windowId: notepad.id,
          snapshotError: errorCode(reply) ?? null,
          nodeCount: snapshot.nodeCount ?? null,
          documentLine: line ?? null,
          observerControlType: observed?.controlType ?? null,
          observerReadVia: observed?.readVia ?? null,
        },
        before,
        after,
      })
    }),
}
