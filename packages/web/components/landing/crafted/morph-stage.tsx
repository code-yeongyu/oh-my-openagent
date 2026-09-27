"use client"

import type { JSX } from "react"
import { useCallback, useEffect, useRef, useState } from "react"

import { cn } from "@/lib/utils"

import {
  CURSOR_SPRING,
  paintStage,
  retargetEdges,
  settledTracks,
  type Tracks,
} from "./stage-geometry"
import { StageScene, type StageLabels } from "./stage-scenes"
import {
  CURSOR_LEAD_SECONDS,
  STAGE_DWELL_SECONDS,
  USER_HOLD_SECONDS,
  cursorClickPoint,
  nextIndex,
  stageState,
} from "./stage-states"

const MAX_FRAME_SECONDS = 1 / 20

interface Clock {
  now: number
  stateSince: number
  holdUntil: number
  pressAt: number
  lastWall: number
}

export interface MorphStageProps {
  readonly active: number
  readonly onAdvance: (index: number) => void
  readonly userSelections: number
  readonly labels: StageLabels
  readonly className?: string
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)")
    const sync = (): void => setReduced(query.matches)
    sync()
    query.addEventListener("change", sync)
    return () => query.removeEventListener("change", sync)
  }, [])
  return reduced
}

/**
 * DESIGN.md §5 MorphStage. One ledger cell that never cuts: its hairline edges and fill ride
 * closed-form springs toward each crafted state (the edge moving with the travel on
 * SPRING_LEAD, the far edge on SPRING_TRAIL). Geometry is read from a virtual clock that only
 * advances while the stage is on screen and the tab is visible; only transforms change.
 */
export function MorphStage({
  active,
  onAdvance,
  userSelections,
  labels,
  className,
}: MorphStageProps): JSX.Element {
  const reduced = usePrefersReducedMotion()
  const rootRef = useRef<HTMLDivElement>(null)
  const fillRef = useRef<HTMLDivElement>(null)
  const topRef = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const leftRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const cursorRef = useRef<HTMLDivElement>(null)
  const tracksRef = useRef<Tracks | null>(null)
  const clockRef = useRef<Clock>({ now: 0, stateSince: 0, holdUntil: 0, pressAt: -1, lastWall: 0 })
  const activeRef = useRef(active)
  const [visible, setVisible] = useState(false)
  const [liveIndex, setLiveIndex] = useState<number | null>(null)
  const [scenes, setScenes] = useState<{ current: number; leaving: number | null }>({
    current: active,
    leaving: null,
  })
  if (scenes.current !== active) {
    setScenes({ current: active, leaving: reduced ? null : scenes.current })
  }
  const live = reduced ? stageState(active).liveAtSeconds !== undefined : liveIndex === active

  const paint = useCallback((): void => {
    const root = rootRef.current
    const tracks = tracksRef.current
    if (!root || !tracks) return
    const nodes = {
      fill: fillRef.current,
      top: topRef.current,
      right: rightRef.current,
      bottom: bottomRef.current,
      left: leftRef.current,
      content: contentRef.current,
      cursor: cursorRef.current,
    }
    const clock = clockRef.current
    paintStage(nodes, tracks, clock.now, clock.pressAt, root.clientWidth, root.clientHeight)
  }, [])

  const resetToActive = useCallback((): void => {
    const root = rootRef.current
    if (!root) return
    tracksRef.current = settledTracks(activeRef.current, root.clientWidth, root.clientHeight)
    paint()
  }, [paint])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    resetToActive()
    const resize = new ResizeObserver(resetToActive)
    resize.observe(root)
    const io = new IntersectionObserver(([entry]) => setVisible(Boolean(entry?.isIntersecting)), {
      threshold: 0.2,
    })
    io.observe(root)
    return () => {
      resize.disconnect()
      io.disconnect()
    }
  }, [resetToActive])

  useEffect(() => {
    const previous = activeRef.current
    activeRef.current = active
    const clock = clockRef.current
    clock.stateSince = clock.now
    if (reduced || previous === active) {
      resetToActive()
      return
    }
    const tracks = tracksRef.current
    const root = rootRef.current
    if (!tracks || !root) return
    retargetEdges(tracks, active, clock.now, root.clientWidth, root.clientHeight)
    paint()
  }, [active, reduced, paint, resetToActive])

  useEffect(() => {
    if (userSelections === 0) return
    clockRef.current.holdUntil = clockRef.current.now + USER_HOLD_SECONDS
    cursorRef.current?.classList.add("is-idle")
  }, [userSelections])

  useEffect(() => {
    if (reduced || !visible) return
    let frame = 0
    const clock = clockRef.current
    const restartBaseline = (): void => {
      clock.lastWall = 0
    }
    document.addEventListener("visibilitychange", restartBaseline)
    const tick = (wall: number): void => {
      const running = document.visibilityState === "visible"
      if (running && clock.lastWall !== 0)
        clock.now += Math.min((wall - clock.lastWall) / 1000, MAX_FRAME_SECONDS)
      clock.lastWall = running ? wall : 0
      const index = activeRef.current
      const inState = clock.now - clock.stateSince
      const liveAt = stageState(index).liveAtSeconds
      if (liveAt !== undefined && inState >= liveAt) {
        setLiveIndex((value) => (value === index ? value : index))
      }
      const autoplay = clock.now >= clock.holdUntil
      cursorRef.current?.classList.toggle("is-idle", !autoplay)
      const tracks = tracksRef.current
      const root = rootRef.current
      if (autoplay && tracks && root && inState >= STAGE_DWELL_SECONDS - CURSOR_LEAD_SECONDS) {
        const next = nextIndex(index)
        const target = cursorClickPoint(stageState(next).rect, root.clientWidth, root.clientHeight)
        tracks.cursorX.retarget(target.x, clock.now, CURSOR_SPRING)
        tracks.cursorY.retarget(target.y, clock.now, CURSOR_SPRING)
        if (inState >= STAGE_DWELL_SECONDS) {
          clock.pressAt = clock.now
          onAdvance(next)
        }
      }
      paint()
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener("visibilitychange", restartBaseline)
      clock.lastWall = 0
    }
  }, [reduced, visible, onAdvance, paint])

  const current = stageState(scenes.current)
  const leaving = scenes.leaving === null ? null : stageState(scenes.leaving)

  return (
    <div
      ref={rootRef}
      id="crafted-stage"
      data-testid="crafted-stage"
      data-state={stageState(active).id}
      data-running={!reduced && visible ? "true" : "false"}
      role="img"
      aria-label={labels.stageLabel}
      className={cn("morph-stage", live && "is-live", className)}
    >
      <div ref={fillRef} aria-hidden="true" className="morph-fill" />
      <div ref={topRef} aria-hidden="true" className="morph-edge morph-edge-x" />
      <div ref={bottomRef} aria-hidden="true" className="morph-edge morph-edge-x" />
      <div ref={leftRef} aria-hidden="true" className="morph-edge morph-edge-y" />
      <div ref={rightRef} aria-hidden="true" className="morph-edge morph-edge-y" />
      <div ref={contentRef} aria-hidden="true" className="morph-content">
        {leaving ? (
          <div
            key={`out-${leaving.id}`}
            className="morph-scene morph-scene-out"
            onAnimationEnd={() => setScenes((value) => ({ ...value, leaving: null }))}
          >
            <StageScene id={leaving.id} live={false} labels={labels} />
          </div>
        ) : null}
        <div key={`in-${current.id}`} className="morph-scene morph-scene-in">
          <StageScene id={current.id} live={live} labels={labels} />
        </div>
      </div>
      {reduced ? null : (
        <div ref={cursorRef} aria-hidden="true" className="morph-cursor">
          <svg viewBox="0 0 16 16" className="size-4">
            <path d="M2 1.5v11.2l3.1-2.9 2 4.7 2-.9-2-4.6h4.3L2 1.5Z" />
          </svg>
        </div>
      )}
    </div>
  )
}
