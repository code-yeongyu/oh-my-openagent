"use client"

import { useEffect, useId, useRef, type JSX } from "react"

import { cn } from "@/lib/utils"

import { edgePath, sampleEdgePoints, type DagLayout } from "./layout"
import { easeInOutCubic, edgeLightKeyframes } from "./motion"
import { dagStrokeClass } from "./status"
import type { DagState } from "./types"

const EDGE_DRAW_DURATION_MS = 420
const EDGE_FLOW_DASH = "7 9"
const EDGE_LIGHT_SIZE = 14
const EDGE_LIGHT_SAMPLES = 24
const EDGE_LIGHT_DURATION_MS = 1600
/** Hard cap on simultaneously animated lights — each is a promoted compositor layer. */
const MAX_EDGE_LIGHTS = 8

export interface DagEdgeLayerProps {
  readonly layout: DagLayout
  /** Source-node state per edge key; drives stroke ink, flow and lights. */
  readonly sourceState: ReadonlyMap<string, DagState>
  /** Edge keys currently drawing themselves in (source just left pending). */
  readonly drawingEdges: ReadonlySet<string>
  readonly onDrawn: () => void
  readonly motionOK: boolean
  readonly isEdgeConnected: (edgeKey: string) => boolean
}

/**
 * Port of the desktop graph's edge canvas: draw-in via stroke-dashoffset on the source's
 * start, a stepped dash flow while the source runs, and travelling lights on the same cubic.
 */
export function DagEdgeLayer({
  layout,
  sourceState,
  drawingEdges,
  onDrawn,
  motionOK,
  isEdgeConnected,
}: DagEdgeLayerProps): JSX.Element {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const lightUid = useId().replaceAll(":", "")

  // Draw-in: measure each newly-drawn edge once, then walk its dash offset to zero with an
  // imperative transition; React stays out of the animation.
  useEffect(() => {
    if (drawingEdges.size === 0) return
    const drawn: SVGPathElement[] = []
    const svg = svgRef.current
    if (motionOK && svg !== null) {
      for (const path of svg.querySelectorAll<SVGPathElement>("[data-dag-edge]")) {
        const key = path.getAttribute("data-dag-edge")
        if (key === null || !drawingEdges.has(key)) continue
        const length = path.getTotalLength()
        path.style.strokeDasharray = `${length}`
        path.style.strokeDashoffset = `${length}`
        path.getBoundingClientRect()
        path.style.transition = `stroke-dashoffset ${EDGE_DRAW_DURATION_MS}ms ease-out`
        path.style.strokeDashoffset = "0"
        drawn.push(path)
      }
    }
    const timer = window.setTimeout(() => {
      for (const path of drawn) {
        path.style.transition = ""
        path.style.strokeDasharray = ""
        path.style.strokeDashoffset = ""
      }
      onDrawn()
    }, EDGE_DRAW_DURATION_MS + 30)
    return () => window.clearTimeout(timer)
  }, [drawingEdges, motionOK, onDrawn])

  const lights = motionOK
    ? layout.edges
        .filter((edge) => !drawingEdges.has(edge.key) && sourceState.get(edge.key) === "running")
        .filter((edge) => isEdgeConnected(edge.key))
        .slice(0, MAX_EDGE_LIGHTS)
        .map((edge, index) => {
          const name = `dag-edge-light-${lightUid}-${index}`
          return {
            key: edge.key,
            name,
            css: edgeLightKeyframes(
              name,
              sampleEdgePoints(edge.from, edge.to, EDGE_LIGHT_SAMPLES, easeInOutCubic),
              EDGE_LIGHT_SIZE,
            ),
          }
        })
    : []

  return (
    <>
      <svg
        ref={svgRef}
        aria-hidden="true"
        className="pointer-events-none absolute top-0 left-0"
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
      >
        {layout.edges.map((edge) => {
          const state = sourceState.get(edge.key)
          const flowing = motionOK && !drawingEdges.has(edge.key) && state === "running"
          return (
            <path
              key={edge.key}
              data-dag-edge={edge.key}
              d={edgePath(edge.from, edge.to)}
              className={cn(
                "ease-standard fill-none transition-opacity duration-[var(--dur-micro)]",
                dagStrokeClass(state),
                flowing && "dag-edge-flow",
                !isEdgeConnected(edge.key) && "opacity-10",
              )}
              style={flowing ? { strokeDasharray: EDGE_FLOW_DASH } : undefined}
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
          )
        })}
      </svg>
      {lights.length === 0 ? null : (
        <>
          <style>{lights.map((light) => light.css).join("")}</style>
          {lights.map((light) => (
            <span
              key={`light:${light.key}`}
              aria-hidden="true"
              data-dag-edge-light={light.key}
              className="dag-edge-light pointer-events-none absolute top-0 left-0 rounded-full"
              style={{
                width: EDGE_LIGHT_SIZE,
                height: EDGE_LIGHT_SIZE,
                animation: `${light.name} ${EDGE_LIGHT_DURATION_MS}ms linear infinite`,
              }}
            />
          ))}
        </>
      )}
    </>
  )
}
