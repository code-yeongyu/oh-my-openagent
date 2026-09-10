"use client"

import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react"

import { LOOP_MS } from "./scenario-data"

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)"

function subscribeReducedMotion(onChange: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => {}
  const query = window.matchMedia(REDUCED_MOTION)
  query.addEventListener("change", onChange)
  return () => query.removeEventListener("change", onChange)
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => typeof window.matchMedia === "function" && window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  )
}

export interface DagClock {
  /** Scenario time within the current loop, in ms; quantised to 100ms. */
  readonly clockMs: number
  /** Increments each time the run replays, so the graph can remount and re-cascade. */
  readonly cycle: number
  readonly playing: boolean
}

/**
 * One rAF clock for the scripted run. It advances only while the panel is at least 40%
 * visible and the document is shown; time is quantised to 100ms so React renders ~10x/s at
 * most, not once per frame. Reduced motion never starts the clock — the caller shows the
 * final frame instead.
 */
export function useDagPlayback(ref: RefObject<HTMLElement | null>, enabled: boolean): DagClock {
  const [visible, setVisible] = useState(false)
  const [shown, setShown] = useState(true)
  const [clock, setClock] = useState<DagClock>({ clockMs: 0, cycle: 0, playing: false })
  const elapsedRef = useRef(0)

  useEffect(() => {
    const element = ref.current
    if (element === null || typeof IntersectionObserver === "undefined") return
    const observer = new IntersectionObserver(
      (entries) => setVisible(entries.some((entry) => entry.intersectionRatio >= 0.4)),
      { threshold: [0, 0.4, 1] },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])

  useEffect(() => {
    const onVisibility = () => setShown(document.visibilityState !== "hidden")
    onVisibility()
    document.addEventListener("visibilitychange", onVisibility)
    return () => document.removeEventListener("visibilitychange", onVisibility)
  }, [])

  const playing = enabled && visible && shown
  useEffect(() => {
    if (!playing) {
      setClock((previous) => (previous.playing ? { ...previous, playing: false } : previous))
      return
    }
    let frame = 0
    let last = performance.now()
    const tick = (now: number) => {
      elapsedRef.current += now - last
      last = now
      const total = elapsedRef.current
      const cycle = Math.floor(total / LOOP_MS)
      const clockMs = Math.floor((total % LOOP_MS) / 100) * 100
      setClock((previous) =>
        previous.clockMs === clockMs && previous.cycle === cycle && previous.playing
          ? previous
          : { clockMs, cycle, playing: true },
      )
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing])

  return clock
}
