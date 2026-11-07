// Draws every Mermaid block in the docs to docs-diagrams/<key>.svg with the pinned mermaid package in
// headless Chromium, and deletes SVGs no block uses any more (lib/docs-diagrams.mjs explains why the SVGs
// are committed). `bun run docs:diagrams` writes them; `--check` exits 1 listing missing and unused files
// without launching a browser. Needs Chromium once: `bunx playwright install chromium`.
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"

import { chromium } from "@playwright/test"

import {
  DIAGRAMS_DIR,
  MERMAID_CONFIG,
  diagramKey,
  docsMermaidSources,
} from "../lib/docs-diagrams.mjs"

const require = createRequire(import.meta.url)
const diagramsRoot = new URL(`../${DIAGRAMS_DIR}/`, import.meta.url)
const checkOnly = process.argv.includes("--check")

const blocks = new Map()
for (const { file, source } of await docsMermaidSources())
  blocks.set(diagramKey(source), { file, source })
await mkdir(diagramsRoot, { recursive: true })
const committed = (await readdir(diagramsRoot)).filter((name) => name.endsWith(".svg"))
const unused = committed.filter((name) => !blocks.has(name.slice(0, -".svg".length)))
const missing = [...blocks.keys()].filter((key) => !committed.includes(`${key}.svg`))

if (checkOnly) {
  if (missing.length > 0 || unused.length > 0) {
    const lines = [
      ...missing.map((key) => `  missing ${key}.svg (${blocks.get(key)?.file})`),
      ...unused.map((name) => `  unused ${name}`),
    ]
    process.stderr.write(
      `stale docs diagrams (run \`bun run docs:diagrams\`):\n${lines.join("\n")}\n`,
    )
    process.exit(1)
  }
  process.stdout.write(`${blocks.size} docs diagrams match their Mermaid sources\n`)
  process.exit(0)
}

// The SVG's text is measured here and drawn on the site, so both use Geist at the same weights.
const fontFace = async (weight, file) => {
  // geist's package exports do not expose its font files, so read them from its install directory.
  const woff2 = await readFile(
    new URL(`../node_modules/geist/dist/fonts/geist-sans/${file}`, import.meta.url),
  )
  return `@font-face{font-family:Geist;font-weight:${weight};src:url(data:font/woff2;base64,${woff2.toString("base64")}) format("woff2")}`
}
const fonts = await Promise.all([
  fontFace(400, "Geist-Regular.woff2"),
  fontFace(500, "Geist-Medium.woff2"),
])

// Two decimals is a hundredth of a pixel; rough.js emits sixteen, which made one state diagram 391 KB. The
// min-width keeps labels legible on a phone: a wide diagram scrolls inside its figure instead of shrinking.
function finish(svg) {
  return svg
    .replace(/(-?\d+\.\d{2})\d+/g, "$1")
    .replace(
      /style="max-width: ([\d.]+)px;"/,
      'style="max-width: $1px; min-width: min($1px, 42rem)"',
    )
}

const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  await page.setContent(
    `<!doctype html><style>${fonts.join("")}:root{--font-geist-sans:Geist}body{font-family:Geist}</style>` +
      `<body><span style="font-weight:400">Geist</span><span style="font-weight:500">Geist</span></body>`,
  )
  await page.addScriptTag({ path: require.resolve("mermaid/dist/mermaid.min.js") })
  await page.evaluate(() => document.fonts.ready)

  for (const [key, { file, source }] of blocks) {
    const svg = await page.evaluate(
      async ({ config, id, text }) => {
        window.mermaid.initialize(config)
        return (await window.mermaid.render(id, text)).svg
      },
      { config: MERMAID_CONFIG, id: `docs-diagram-${key}`, text: source },
    )
    await writeFile(new URL(`${key}.svg`, diagramsRoot), `${finish(svg)}\n`)
    process.stdout.write(`${key}.svg <- ${file}\n`)
  }
} finally {
  await browser.close()
}

for (const name of unused) {
  await rm(new URL(name, diagramsRoot))
  process.stdout.write(`removed unused ${name}\n`)
}
