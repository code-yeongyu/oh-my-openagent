// Renders every raster app icon from app/icon.svg so each PNG the site ships derives from the
// one vector mark. `bun run icons:render` writes them; `bun run icons:check` exits 1 listing
// every committed PNG that no longer matches a fresh render (lib/app-icons.test.ts does too).
import { readFile, writeFile } from "node:fs/promises"

import { ICON_OUTPUTS, ICON_SOURCE, renderIcon } from "../lib/app-icons.ts"

const webRoot = new URL("../", import.meta.url)
const checkOnly = process.argv.includes("--check")
const source = await readFile(new URL(ICON_SOURCE, webRoot), "utf8")

const stale = []
for (const output of ICON_OUTPUTS) {
  const { png } = await renderIcon(source, output)
  const target = new URL(output.file, webRoot)
  if (checkOnly) {
    const committed = await readFile(target).catch((error) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null
      throw error
    })
    if (committed === null || Buffer.compare(committed, png) !== 0) stale.push(output.file)
    continue
  }
  await writeFile(target, png)
  process.stdout.write(
    `${output.file}: ${output.size}x${output.size} ${output.purpose}, ${png.byteLength} bytes\n`,
  )
}

if (checkOnly) {
  if (stale.length > 0) {
    process.stderr.write(
      `stale app icons (run \`bun run icons:render\`):\n${stale.map((file) => `  ${file}`).join("\n")}\n`,
    )
    process.exit(1)
  }
  process.stdout.write(`${ICON_OUTPUTS.length} app icons match ${ICON_SOURCE}\n`)
}
