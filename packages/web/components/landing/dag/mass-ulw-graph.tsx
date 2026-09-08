"use client"

import { useRef, type JSX } from "react"

import { useGraphFocus } from "@/components/landing/graph/use-graph-focus"

import { DagGraphView, type DagGraphViewProps } from "./dag-graph-view"
import { DesktopFrame, type DesktopFrameLabels } from "./desktop-frame"
import { FINAL_RUN, runAt } from "./scenario"
import { USER_COMMAND } from "./scenario-data"
import { useDagPlayback, usePrefersReducedMotion } from "./use-dag-playback"

export interface MassUlwGraphProps {
  readonly frame: DesktopFrameLabels
  readonly graph: DagGraphViewProps["labels"]
  readonly regionLabel: string
  /**
   * `panel`: the workflow graph panel alone (hero). `app`: the whole desktop window — title
   * bar, thread sidebar, chat turn, run header, activity feed — with the graph open inside.
   */
  readonly variant: "panel" | "app"
  readonly testId: string
}

/**
 * The desktop app's workflow DAG view on a scripted 10-node / 5-wave run. Plays while visible;
 * reduced motion shows the finished run instead. Clicking a node focuses it in the shared graph
 * store so the agents bento reacts.
 */
export function MassUlwGraph({
  frame,
  graph,
  regionLabel,
  variant,
  testId,
}: MassUlwGraphProps): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)
  const reducedMotion = usePrefersReducedMotion()
  const clock = useDagPlayback(ref, !reducedMotion)
  const { setFocused } = useGraphFocus()
  const run = reducedMotion ? FINAL_RUN : runAt(clock.clockMs)
  const clockMs = reducedMotion ? Number.MAX_SAFE_INTEGER : clock.clockMs
  const view = (
    <DagGraphView
      key={clock.cycle}
      run={run}
      clockMs={clockMs}
      motionOK={!reducedMotion}
      labels={graph}
      onSelectNode={setFocused}
    />
  )

  if (variant === "app") {
    return (
      <div ref={ref} data-testid={testId} role="region" aria-label={regionLabel}>
        <DesktopFrame run={run} clockMs={clockMs} motionOK={!reducedMotion} labels={frame}>
          {view}
        </DesktopFrame>
      </div>
    )
  }

  return (
    <div
      ref={ref}
      data-testid={testId}
      role="region"
      aria-label={regionLabel}
      className="border-line bg-ink-1 overflow-hidden border"
    >
      <div className="bg-ink-2 border-line flex h-9 items-center gap-2 border-b px-3">
        <span aria-hidden="true" className="flex gap-1.5">
          <span className="bg-text-faint size-2 rounded-full" />
          <span className="bg-text-faint size-2 rounded-full" />
          <span className="bg-text-faint size-2 rounded-full" />
        </span>
        <span className="text-text-lo text-meta ml-2 truncate font-mono">{frame.windowTitle}</span>
      </div>
      <div className="border-line border-b px-3 py-2">
        <p className="text-text-hi font-mono text-xs">{`$ ${USER_COMMAND}`}</p>
        <p className="text-text-lo mt-1 text-xs">
          {frame.workflow} · {run.name}
        </p>
      </div>
      <div className="relative h-[20rem] min-h-0 md:h-[24rem]">{view}</div>
    </div>
  )
}
