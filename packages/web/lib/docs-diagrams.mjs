// Mermaid blocks in the docs are drawn once, by `bun run docs:diagrams` (scripts/render-docs-diagrams.mjs,
// headless Chromium running the pinned mermaid package), and committed as SVG files under docs-diagrams/.
// The docs build inlines them (scripts/generate-docs-content.mjs), so /docs ships static SVG: no client
// JavaScript, nothing to lay out after load, and the same bytes on every rebuild of a commit (the deploy's
// asset-retention guard refuses a rebuild whose bytes differ). Each file is named after a hash of the
// block's source and of MERMAID_CONFIG, so an edited block has no SVG until it is drawn again.
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"

import { Marked } from "marked"

import { DOC_PAGES_DATA, DOC_SECTIONS_DATA } from "./docs-sections-data.mjs"

/** Directory of the committed SVGs, relative to packages/web. */
export const DIAGRAMS_DIR = "docs-diagrams"

const DOCS_ROOT = new URL("../../../docs/", import.meta.url)

// The site is dark only (DESIGN.md §2); every color is a palette token. Cyan means "live" on this site,
// so the diagrams stay neutral.
export const MERMAID_CONFIG = {
  startOnLoad: false,
  securityLevel: "strict",
  theme: "base",
  look: "classic",
  // State shapes are drawn through rough.js even in the classic look; a fixed seed keeps a redraw byte-identical.
  handDrawnSeed: 1,
  htmlLabels: false,
  // Mermaid draws edge-label backings at half opacity, so the edge line shows through the label text.
  themeCSS: ".edgeLabel rect, .edgeLabel .label rect { opacity: 1; }",
  flowchart: { htmlLabels: false, curve: "basis", padding: 12, nodeSpacing: 40, rankSpacing: 56 },
  state: { padding: 12 },
  themeVariables: {
    darkMode: true,
    background: "#09090b",
    fontFamily: "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif",
    fontSize: "15px",
    primaryColor: "#14141a",
    primaryTextColor: "#f5f5f7",
    primaryBorderColor: "#55565e",
    secondaryColor: "#0e0e11",
    tertiaryColor: "#0e0e11",
    mainBkg: "#14141a",
    nodeBorder: "#55565e",
    nodeTextColor: "#f5f5f7",
    textColor: "#c3c4c9",
    lineColor: "#8b8c95",
    clusterBkg: "#0e0e11",
    clusterBorder: "#2a2a31",
    titleColor: "#c3c4c9",
    edgeLabelBackground: "#0e0e11",
    labelBackgroundColor: "#0e0e11",
    stateBkg: "#14141a",
    stateBorder: "#55565e",
    compositeBackground: "#0e0e11",
    transitionColor: "#8b8c95",
    transitionLabelColor: "#c3c4c9",
    specialStateColor: "#c3c4c9",
    innerEndBackground: "#c3c4c9",
  },
}

/** The SVG file name stem for one Mermaid block. */
export function diagramKey(source) {
  const input = JSON.stringify({ config: MERMAID_CONFIG, source })
  return createHash("sha256").update(input).digest("hex").slice(0, 16)
}

/** The Mermaid sources of one markdown file, read the way the docs build reads its code blocks. */
export function mermaidSources(markdown) {
  const sources = []
  const marked = new Marked({ gfm: true })
  marked.walkTokens(marked.lexer(markdown), (token) => {
    if (token.type === "code" && token.lang === "mermaid") sources.push(token.text)
  })
  return sources
}

/** Every Mermaid block of every doc the site renders, in page order. */
export async function docsMermaidSources() {
  const blocks = []
  for (const { file } of [...DOC_SECTIONS_DATA, ...DOC_PAGES_DATA]) {
    const markdown = await readFile(new URL(file, DOCS_ROOT), "utf8")
    for (const source of mermaidSources(markdown)) blocks.push({ file, source })
  }
  return blocks
}
