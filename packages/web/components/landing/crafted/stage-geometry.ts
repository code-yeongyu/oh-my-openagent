import { SPRING_LEAD, SPRING_TRAIL, SpringTrack, type Spring } from "@/lib/morph-spring"

import { cursorClickPoint, stageState, toPixels } from "./stage-states"

export const CURSOR_SPRING: Spring = { omega: 7.5, zeta: 0.92 }
const PRESS_SECONDS = 0.14

export interface Tracks {
  readonly left: SpringTrack
  readonly top: SpringTrack
  readonly right: SpringTrack
  readonly bottom: SpringTrack
  readonly cursorX: SpringTrack
  readonly cursorY: SpringTrack
}

export interface StageNodes {
  readonly fill: HTMLElement | null
  readonly top: HTMLElement | null
  readonly right: HTMLElement | null
  readonly bottom: HTMLElement | null
  readonly left: HTMLElement | null
  readonly content: HTMLElement | null
  readonly cursor: HTMLElement | null
}

export function settledTracks(index: number, width: number, height: number): Tracks {
  const rect = toPixels(stageState(index).rect, width, height)
  const click = cursorClickPoint(stageState(index).rect, width, height)
  return {
    left: new SpringTrack(rect.left),
    top: new SpringTrack(rect.top),
    right: new SpringTrack(rect.right),
    bottom: new SpringTrack(rect.bottom),
    cursorX: new SpringTrack(click.x),
    cursorY: new SpringTrack(click.y),
  }
}

/** Retargets each edge: the edge growing along the travel leads, the other trails. */
export function retargetEdges(
  tracks: Tracks,
  index: number,
  at: number,
  width: number,
  height: number,
): void {
  const next = toPixels(stageState(index).rect, width, height)
  const edges = [
    [tracks.left, next.left, -1],
    [tracks.top, next.top, -1],
    [tracks.right, next.right, 1],
    [tracks.bottom, next.bottom, 1],
  ] as const
  for (const [track, target, outward] of edges) {
    const growing = (target - track.settledTarget) * outward > 0
    track.retarget(target, at, growing ? SPRING_LEAD : SPRING_TRAIL)
  }
}

/** Writes the frame at time `t` as transforms only: translate + scale on edges and fill. */
export function paintStage(
  nodes: StageNodes,
  tracks: Tracks,
  t: number,
  pressAt: number,
  width: number,
  height: number,
): void {
  const left = tracks.left.valueAt(t)
  const top = tracks.top.valueAt(t)
  const right = tracks.right.valueAt(t)
  const bottom = tracks.bottom.valueAt(t)
  const sx = Math.max(right - left, 1) / Math.max(width, 1)
  const sy = Math.max(bottom - top, 1) / Math.max(height, 1)
  const place = (node: HTMLElement | null, transform: string): void => {
    if (node) node.style.transform = transform
  }
  place(nodes.fill, `translate3d(${left}px, ${top}px, 0) scale(${sx}, ${sy})`)
  place(nodes.top, `translate3d(${left}px, ${top}px, 0) scaleX(${sx})`)
  place(nodes.bottom, `translate3d(${left}px, ${bottom - 1}px, 0) scaleX(${sx})`)
  place(nodes.left, `translate3d(${left}px, ${top}px, 0) scaleY(${sy})`)
  place(nodes.right, `translate3d(${right - 1}px, ${top}px, 0) scaleY(${sy})`)
  place(
    nodes.content,
    `translate3d(${(left + right) / 2}px, ${(top + bottom) / 2}px, 0) translate(-50%, -50%)`,
  )
  const sincePress = t - pressAt
  const pressed = sincePress >= 0 && sincePress < PRESS_SECONDS
  place(
    nodes.cursor,
    `translate3d(${tracks.cursorX.valueAt(t)}px, ${tracks.cursorY.valueAt(t)}px, 0) scale(${pressed ? 0.86 : 1})`,
  )
}
