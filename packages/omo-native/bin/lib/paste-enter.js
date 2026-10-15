import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { engineDependencyDir } from "./engine-dependency.js"

// Senpi's marker-free paste fallback (StdinBuffer.consumeUnbracketedBurst) folds a read of bare line
// breaks that lands within the burst window (20 ms, 100 ms over SSH) after a burst paste into that
// paste. That read is how `herdr pane send-text` + `send-keys enter` deliver a multi-line prompt
// (no bracketed-paste markers, Enter a few ms later), so the Enter was eaten and the prompt stayed
// in the editor. The bare line break is still held for the window, so a paste split right at a line
// break stays one paste, but with no text after it the held break is released as Enter.
export const heldPasteEnd = /this\.holdTrailingNewline\(\s*trailing\s*,\s*endsPaste\s*\)/g
export const heldEnterOrPasteEnd = "this.holdTrailingNewline(trailing, endsPaste && head.length > 0)"

function patchFile(path) {
  const source = readFileSync(path, "utf8")
  heldPasteEnd.lastIndex = 0
  if (!heldPasteEnd.test(source)) return 0
  heldPasteEnd.lastIndex = 0
  const count = source.match(heldPasteEnd).length
  writeFileSync(path, source.replace(heldPasteEnd, heldEnterOrPasteEnd))
  return count
}

function javascriptFiles(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { recursive: true })
    .filter((relative) => relative.endsWith(".js"))
    .map((relative) => join(dir, relative))
}

// Every copy the engine can run: the pre-linked bundle the launcher prefers and the pi-tui dist.
export function preparePasteEnter(senpiRoot) {
  const files = javascriptFiles(join(senpiRoot, "dist", "bundle"))
  const tuiRoot = engineDependencyDir(senpiRoot, "@earendil-works/pi-tui")
  if (tuiRoot !== undefined) files.push(join(tuiRoot, "dist", "stdin-buffer.js"))
  let patched = 0
  for (const path of files) if (existsSync(path)) patched += patchFile(path)
  return patched
}
