import { ogPalette } from "./palette"

type Wave = 1 | 2 | 3

interface GraphNode {
  readonly x: number
  readonly y: number
  readonly wave: Wave
}

const nodes: ReadonlyArray<GraphNode> = [
  { x: 180, y: 40, wave: 1 },
  { x: 80, y: 160, wave: 2 },
  { x: 180, y: 175, wave: 2 },
  { x: 290, y: 150, wave: 2 },
  { x: 30, y: 300, wave: 3 },
  { x: 110, y: 320, wave: 3 },
  { x: 190, y: 305, wave: 3 },
  { x: 260, y: 330, wave: 3 },
  { x: 340, y: 295, wave: 3 },
]

const edges: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [0, 2],
  [0, 3],
  [1, 4],
  [1, 5],
  [2, 5],
  [2, 6],
  [3, 7],
  [3, 8],
  [2, 7],
]

export function GraphGlyph() {
  return (
    <svg width="380" height="360" viewBox="0 0 380 360" aria-hidden="true">
      {edges.map(([a, b]) => {
        const from = nodes[a]
        const to = nodes[b]
        if (!from || !to) return null
        return (
          <line
            key={`${a}-${b}`}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            stroke={ogPalette.accent}
            strokeOpacity={to.wave === 3 ? 0.28 : 0.55}
            strokeWidth={1}
          />
        )
      })}
      {nodes.map((node, index) => {
        const lit = node.wave < 3
        return (
          <g key={index}>
            <circle
              cx={node.x}
              cy={node.y}
              r={lit ? 18 : 12}
              fill={ogPalette.accent}
              fillOpacity={lit ? 0.16 : 0.08}
            />
            <circle
              cx={node.x}
              cy={node.y}
              r={lit ? 7 : 5}
              fill={lit ? ogPalette.accentHot : ogPalette.accent}
              fillOpacity={lit ? 1 : 0.7}
            />
          </g>
        )
      })}
    </svg>
  )
}
