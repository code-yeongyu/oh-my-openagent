import { EASE_MOVE, type Tween } from "@/components/home/graph/ease"
import { GRAPH_NODES, type NodeState } from "@/components/home/graph/scenes"

export interface Colors {
  readonly ink: string
  readonly ink2: string
  readonly ink3: string
  readonly dot: string
  readonly line: string
  readonly accent: string
  readonly wait: string
  readonly ok: string
}

export interface NodeTrack {
  readonly shown: Tween
  readonly load: Tween
  state: NodeState
}

export interface Packet {
  readonly to: string
  readonly start: number
  readonly dur: number
  readonly back: boolean
}

export interface Geometry {
  readonly width: number
  readonly height: number
  readonly pitch: number
  readonly narrow: boolean
  readonly hub: { readonly x: number; readonly y: number }
  readonly boxes: ReadonlyMap<string, { x: number; y: number; w: number; h: number }>
}

/** Wave columns under the orchestrator; on a phone the boxes shrink and only the model shows under each. */
export function layout(width: number): Geometry {
  const narrow = width < 640
  const height = narrow ? 360 : 420
  const pitch = narrow ? 4 : 6
  const cols = 5
  const colW = width / cols
  const boxW = Math.floor((colW - (narrow ? 8 : 24)) / pitch) * pitch
  const boxH = (narrow ? 7 : 8) * pitch
  const hub = { x: Math.round(width / 2), y: narrow ? 30 : 40 }
  const top = narrow ? 104 : 124
  const rowGap = boxH + (narrow ? 34 : 40)
  const boxes = new Map<string, { x: number; y: number; w: number; h: number }>()
  const perWave = new Map<number, number>()
  for (const node of GRAPH_NODES) {
    const row = perWave.get(node.wave) ?? 0
    perWave.set(node.wave, row + 1)
    const x = Math.round(node.wave * colW + (colW - boxW) / 2)
    boxes.set(node.id, { x, y: top + row * rowGap, w: boxW, h: boxH })
  }
  return { width, height, pitch, narrow, hub, boxes }
}

function link(geo: Geometry, id: string): Array<[number, number]> {
  const b = geo.boxes.get(id)
  if (!b) return []
  const cx = b.x + b.w / 2
  const bend = geo.hub.y + 34
  return [
    [geo.hub.x, geo.hub.y + geo.pitch * 2],
    [geo.hub.x, bend],
    [cx, bend],
    [cx, b.y - geo.pitch],
  ]
}

function pointOn(points: Array<[number, number]>, f: number): [number, number] {
  const lengths = points
    .slice(1)
    .map((p, i) => Math.hypot(p[0] - points[i]![0], p[1] - points[i]![1]))
  let target = lengths.reduce((a, b) => a + b, 0) * f
  for (const [i, length] of lengths.entries()) {
    if (target <= length || i === lengths.length - 1) {
      const k = length ? Math.min(target / length, 1) : 0
      const [x0, y0] = points[i]!
      const [x1, y1] = points[i + 1]!
      return [x0 + (x1 - x0) * k, y0 + (y1 - y0) * k]
    }
    target -= length
  }
  return points.at(-1) ?? [0, 0]
}

/** One frame: dot field, links, the orchestrator block, each agent box filling with its load, then the packets. */
export function draw(
  ctx: CanvasRenderingContext2D,
  geo: Geometry,
  c: Colors,
  tracks: ReadonlyMap<string, NodeTrack>,
  packets: readonly Packet[],
  now: number,
  hubLabel: string,
): void {
  const { width, height, pitch, narrow, hub } = geo
  const dot = Math.max(2, Math.round(pitch * 0.5))
  const square = (x: number, y: number, size: number, color: string, alpha = 1): void => {
    ctx.globalAlpha = alpha
    ctx.fillStyle = color
    ctx.fillRect(Math.round(x - size / 2), Math.round(y - size / 2), size, size)
  }
  ctx.clearRect(0, 0, width, height)
  for (let y = pitch * 2; y < height; y += pitch * 3)
    for (let x = pitch * 2; x < width; x += pitch * 3) square(x, y, 1.5, c.dot, 0.7)
  for (const node of GRAPH_NODES) {
    const shown = tracks.get(node.id)?.shown.value(now) ?? 0
    const points = link(geo, node.id)
    for (let f = 0; f < shown; f += 0.035) {
      const [x, y] = pointOn(points, f)
      square(x, y, dot - 1, c.line, 0.9)
    }
  }
  for (let r = -1; r <= 1; r++)
    for (let col = -3; col <= 3; col++)
      square(
        hub.x + col * pitch,
        hub.y + r * pitch,
        dot + 1,
        c.accent,
        Math.abs(col) === 3 ? 0.4 : 0.95,
      )
  ctx.globalAlpha = 1
  ctx.font = `500 ${narrow ? 11 : 12}px "Timeless Sans", ui-sans-serif, system-ui, sans-serif`
  ctx.textBaseline = "middle"
  ctx.textAlign = "left"
  ctx.fillStyle = c.ink2
  ctx.fillText(hubLabel, hub.x + pitch * 4.5, hub.y)
  ctx.textAlign = "center"
  for (const node of GRAPH_NODES) {
    const track = tracks.get(node.id)
    const box = geo.boxes.get(node.id)
    if (!track || !box) continue
    const shown = track.shown.value(now)
    const load = track.load.value(now)
    const cols = Math.round(box.w / pitch)
    const rows = Math.round(box.h / pitch)
    const lit = Math.round((rows - 2) * load)
    const lift = (1 - shown) * 8
    const fill = track.state === "blocked" ? c.wait : track.state === "done" ? c.ok : c.accent
    for (let r = 0; r < rows; r++)
      for (let col = 0; col < cols; col++) {
        const edge = r === 0 || col === 0 || r === rows - 1 || col === cols - 1
        const filled = !edge && rows - 2 - r < lit
        if (!edge && !filled) continue
        square(
          box.x + col * pitch + pitch / 2,
          box.y + r * pitch + pitch / 2 + lift,
          dot,
          filled ? fill : c.line,
          shown * (filled ? 0.85 : 1),
        )
      }
    ctx.globalAlpha = shown
    ctx.fillStyle = c.ink
    ctx.fillText(narrow ? node.model : node.id, box.x + box.w / 2, box.y + box.h + 14 + lift)
    if (!narrow) {
      ctx.fillStyle = track.state === "blocked" ? c.wait : c.ink3
      ctx.fillText(
        track.state === "blocked" ? "waiting: GPU quota" : node.model,
        box.x + box.w / 2,
        box.y + box.h + 30 + lift,
      )
    }
  }
  for (const p of packets) {
    const k = Math.min(Math.max((now - p.start) / p.dur, 0), 1)
    const f = EASE_MOVE(k)
    const [x, y] = pointOn(link(geo, p.to), p.back ? 1 - f : f)
    for (const [dx, dy] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ] as const)
      square(x + (dx - 0.5) * pitch, y + (dy - 0.5) * pitch, dot + 1, p.back ? c.ok : c.accent, 1)
  }
  ctx.globalAlpha = 1
}
