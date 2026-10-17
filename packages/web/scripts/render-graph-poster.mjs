import { mkdir, writeFile } from "node:fs/promises"
import { graphNodes, graphEdges } from "../components/landing/graph/graph-data.ts"
import { graphPalette as palette } from "../components/landing/graph/graph-palette.ts"

const project = ([x, y, z]) => {
  const scale = 1200 / (12 - z)
  return { x: 800 + x * scale, y: 500 - y * scale, scale }
}
const edges = graphEdges
  .map(({ source, target }) => {
    const a = project(graphNodes.find((node) => node.id === source).position)
    const b = project(graphNodes.find((node) => node.id === target).position)
    return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${palette.accentDim}" stroke-width="1" opacity=".35"/>`
  })
  .join("")
const nodes = graphNodes
  .map((node) => {
    const p = project(node.position)
    const radius = (node.wave === 1 ? 0.38 : 0.24) * p.scale
    return `<circle cx="${p.x}" cy="${p.y}" r="${radius * 3}" fill="url(#halo)"/><circle cx="${p.x}" cy="${p.y}" r="${radius}" fill="${node.wave < 3 ? palette.accentHot : palette.ink3}" stroke="${palette.accentDim}"/>`
  })
  .join("")
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000"><defs><pattern id="grid" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="${palette.lineFaint}"/></pattern><radialGradient id="halo"><stop stop-color="${palette.accent}" stop-opacity=".16"/><stop offset="1" stop-color="${palette.accent}" stop-opacity="0"/></radialGradient></defs><path fill="${palette.ink0}" d="M0 0h1600v1000H0z"/><path fill="url(#grid)" d="M0 0h1600v1000H0z"/>${edges}${nodes}</svg>\n`
if (Buffer.byteLength(svg) > 40 * 1024) throw new Error("Graph poster exceeds 40 KB")
await mkdir(new URL("../public/images/", import.meta.url), { recursive: true })
await writeFile(new URL("../public/images/graph-poster.svg", import.meta.url), svg)
process.stdout.write(`Graph poster: ${Buffer.byteLength(svg)} bytes\n`)
