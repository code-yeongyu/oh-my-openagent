import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const relativePath = "node_modules/@earendil-works/pi-tui/dist/terminal-image.js"
const ghosttyDetection = `if (termProgram === "ghostty" || term.includes("ghostty") || process.env.GHOSTTY_RESOURCES_DIR) {
        return { images: "kitty", trueColor: true, hyperlinks: true };
    }`
const placeholderDetection = `if (termProgram === "ghostty" || term.includes("ghostty") || process.env.GHOSTTY_RESOURCES_DIR) {
        return { images: "kitty", trueColor: true, hyperlinks: true, kittyUnicodePlaceholders: true };
    }`

/** Keep Ghostty images attached to transcript cells instead of fixed screen coordinates. */
export function prepareGhosttyKittyPlaceholders(senpiRoot) {
  const path = join(senpiRoot, relativePath)
  if (!existsSync(path)) throw new Error(`omo-ai: installed Senpi target is missing: ${relativePath}`)
  const source = readFileSync(path, "utf8")
  if (source.includes(placeholderDetection)) return
  if (!source.includes(ghosttyDetection)) throw new Error(`omo-ai: unsupported Senpi ${relativePath}`)
  writeFileSync(path, source.replace(ghosttyDetection, placeholderDetection))
}
