"use client"

import { LocateFixed, Maximize } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react"

import { cn } from "@/lib/utils"

import { DagEdgeLayer } from "./dag-edge-layer"
import { DagNodeCard } from "./dag-node-card"
import {
  COLUMN_GAP,
  NODE_HEIGHT,
  NODE_WIDTH,
  computeDagLayout,
  connectedNodeIds,
  edgeKey,
} from "./layout"
import { diffNodeStates, shouldDrawEdge, waveUnderlineTarget } from "./motion"
import { waveActivitySummary } from "./scenario"
import type { DagRun, DagState } from "./types"
import { useDagCamera } from "./use-dag-camera"

const EMPTY: ReadonlySet<string> = new Set()

export interface DagGraphViewProps {
  readonly run: DagRun
  readonly clockMs: number
  readonly motionOK: boolean
  readonly labels: {
    readonly wave: string
    readonly done: string
    readonly running: string
    readonly fit: string
    readonly center: string
  }
  readonly onSelectNode: (nodeId: string) => void
}

/**
 * Port of the desktop app's WorkflowGraphView: wave headers with the active-wave underline,
 * the edge canvas, node cards with the entry cascade and one-shot pop/shake, hover/focus
 * lighting the whole dependency path, and a camera with Fit / Center-active-wave.
 */
export function DagGraphView({
  run,
  clockMs,
  motionOK,
  labels,
  onSelectNode,
}: DagGraphViewProps): JSX.Element {
  const layout = useMemo(() => computeDagLayout(run), [run])
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const camera = useDagCamera(viewportRef, layout)

  const [popping, setPopping] = useState<ReadonlySet<string>>(EMPTY)
  const [shaking, setShaking] = useState<ReadonlySet<string>>(EMPTY)
  const [drawingEdges, setDrawingEdges] = useState<ReadonlySet<string>>(EMPTY)
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null)
  const prevStatesRef = useRef<ReadonlyMap<string, DagState>>(new Map())
  const seenRef = useRef<ReadonlySet<string>>(EMPTY)

  const nodeState = useMemo(
    () => new Map(run.nodes.map((node) => [node.id, node.state] as const)),
    [run],
  )
  const sourceState = useMemo(
    () =>
      new Map(
        run.edges.map(
          (edge) => [edgeKey(edge.from, edge.to), nodeState.get(edge.from) ?? "pending"] as const,
        ),
      ),
    [run.edges, nodeState],
  )
  const activeWave = waveUnderlineTarget(run.waves, nodeState)
  const waveActivity = waveActivitySummary(run)
  const waveCount = Math.round((layout.width + COLUMN_GAP) / (NODE_WIDTH + COLUMN_GAP))

  // State diff → one-shot cues; hydration and entry never pop by construction.
  useEffect(() => {
    const previous = prevStatesRef.current
    prevStatesRef.current = nodeState
    const changed = diffNodeStates(previous, nodeState)
    if (changed.size > 0) {
      const failed = new Set([...changed].filter((id) => nodeState.get(id) === "failed"))
      setPopping(new Set([...changed].filter((id) => !failed.has(id))))
      if (failed.size > 0) setShaking(failed)
    }
    const drawing = new Set<string>()
    for (const edge of run.edges) {
      if (shouldDrawEdge(previous.get(edge.from), nodeState.get(edge.from) ?? "pending")) {
        drawing.add(edgeKey(edge.from, edge.to))
      }
    }
    if (drawing.size > 0) setDrawingEdges(drawing)
  }, [run.edges, nodeState])

  // Follow the live wave while the graph overflows the viewport (narrow screens) and the
  // reader has not taken the camera; on wide screens the whole graph is already in view.
  const { overflowing, centerWave } = camera
  useEffect(() => {
    if (!overflowing || activeWave === null) return
    const rows = layout.nodes.filter((n) => n.waveIndex === activeWave).map((n) => n.y)
    centerWave(activeWave, rows)
  }, [overflowing, activeWave, layout, centerWave])

  const entering = new Map<string, number>()
  for (const placement of layout.nodes) {
    if (!seenRef.current.has(placement.node.id)) entering.set(placement.node.id, entering.size)
  }
  useEffect(() => {
    if (entering.size === 0) return
    seenRef.current = new Set([...seenRef.current, ...entering.keys()])
  })

  const clearOneShot = useCallback((nodeId: string) => {
    const drop = (previous: ReadonlySet<string>) => {
      if (!previous.has(nodeId)) return previous
      const next = new Set(previous)
      next.delete(nodeId)
      return next
    }
    setPopping(drop)
    setShaking(drop)
  }, [])
  const onDrawn = useCallback(() => setDrawingEdges(EMPTY), [])

  const connected = useMemo(
    () => (focusedNodeId === null ? null : connectedNodeIds(run.edges, focusedNodeId)),
    [run.edges, focusedNodeId],
  )
  const isEdgeConnected = useCallback(
    (key: string) => {
      if (connected === null) return true
      const separator = key.lastIndexOf("->")
      return connected.has(key.slice(0, separator)) && connected.has(key.slice(separator + 2))
    },
    [connected],
  )

  const toolbarButton =
    "text-text-mid hover:bg-ink-3 hover:text-text-hi focus-visible:outline-accent ease-standard flex size-11 cursor-pointer items-center justify-center transition-colors duration-[var(--dur-micro)] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-40"

  return (
    <div
      ref={viewportRef}
      data-dag-viewport
      className="relative h-full w-full cursor-grab touch-pan-y overflow-x-auto overflow-y-auto select-none active:cursor-grabbing"
      onPointerDown={camera.onPointerDown}
      onPointerMove={camera.onPointerMove}
      onPointerUp={camera.onPointerUp}
      onPointerCancel={camera.onPointerUp}
    >
      <div
        data-dag-canvas
        className={cn(
          "absolute top-0 left-0",
          camera.tweening &&
            "ease-out-quart transition-transform duration-300 motion-reduce:transition-none",
        )}
        style={{
          width: layout.width,
          height: layout.height,
          transform: `translate(${camera.camera.x}px, ${camera.camera.y}px) scale(${camera.camera.scale})`,
          transformOrigin: "0 0",
        }}
      >
        {Array.from({ length: waveCount }, (_, waveIndex) => {
          const activity = waveActivity.find((wave) => wave.index === waveIndex)
          return (
            <div
              key={waveIndex}
              data-dag-wave={waveIndex}
              className="text-text-lo absolute truncate font-mono text-xs"
              style={{
                left: waveIndex * (NODE_WIDTH + COLUMN_GAP),
                top: 12,
                width: NODE_WIDTH,
                height: 24,
              }}
            >
              {labels.wave} {waveIndex + 1}
              {activity === undefined
                ? null
                : ` · ${activity.completed}/${activity.total} ${labels.done}` +
                  (activity.running > 0 ? ` · ${activity.running} ${labels.running}` : "")}
              {waveIndex === activeWave ? (
                <span
                  aria-hidden="true"
                  data-dag-wave-underline
                  className={cn(
                    "absolute bottom-0 left-0 block h-0.5 w-full",
                    motionOK && "dag-wave-underline",
                  )}
                >
                  <span
                    className={cn("bg-accent block h-full w-full", motionOK && "dag-wave-ambient")}
                  />
                </span>
              ) : null}
            </div>
          )
        })}
        <DagEdgeLayer
          layout={layout}
          sourceState={sourceState}
          drawingEdges={drawingEdges}
          onDrawn={onDrawn}
          motionOK={motionOK}
          isEdgeConnected={isEdgeConnected}
        />
        {layout.nodes.map((placement) => (
          <DagNodeCard
            key={placement.node.id}
            node={placement.node}
            clockMs={clockMs}
            position={{
              left: placement.x,
              top: placement.y,
              width: NODE_WIDTH,
              height: NODE_HEIGHT,
            }}
            enterIndex={motionOK ? entering.get(placement.node.id) : undefined}
            popping={popping.has(placement.node.id)}
            shaking={shaking.has(placement.node.id)}
            motionOK={motionOK}
            dimmed={connected !== null && !connected.has(placement.node.id)}
            connected={connected !== null && connected.has(placement.node.id)}
            onClearOneShot={clearOneShot}
            onFocusNode={setFocusedNodeId}
            onSelect={onSelectNode}
          />
        ))}
      </div>
      <div
        data-dag-camera-toolbar
        className="border-line bg-ink-1 absolute right-2 bottom-2 z-10 flex flex-col gap-0.5 border p-1"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          aria-label={labels.fit}
          title={labels.fit}
          className={toolbarButton}
          onClick={camera.fit}
        >
          <Maximize aria-hidden="true" className="size-4" />
        </button>
        <button
          type="button"
          aria-label={labels.center}
          title={labels.center}
          disabled={activeWave === null}
          className={toolbarButton}
          onClick={() => {
            if (activeWave === null) return
            camera.centerWave(
              activeWave,
              layout.nodes.filter((n) => n.waveIndex === activeWave).map((n) => n.y),
            )
          }}
        >
          <LocateFixed aria-hidden="true" className="size-4" />
        </button>
      </div>
    </div>
  )
}
