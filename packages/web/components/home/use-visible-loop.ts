"use client"

import { useEffect, type RefObject } from "react"

/** A sleep that rejects when the scene is aborted, so a loop stops mid-step the moment its figure leaves the screen. */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    function onAbort(): void {
      clearTimeout(timer)
      reject(signal.reason)
    }
    signal.addEventListener("abort", onAbort, { once: true })
  })
}

/**
 * Repeats `scene` while the element is on screen, the tab is visible and motion is allowed; otherwise `settle`
 * draws the finished still frame. Reduced motion never starts the loop.
 */
export function useVisibleLoop(
  ref: RefObject<HTMLElement | null>,
  scene: (signal: AbortSignal) => Promise<void>,
  settle: () => void,
): void {
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const reduced = matchMedia("(prefers-reduced-motion: reduce)")
    let visible = false
    let controller: AbortController | null = null

    const sync = (): void => {
      const should = visible && !reduced.matches && document.visibilityState === "visible"
      if (should && !controller) {
        const current = new AbortController()
        controller = current
        const repeat = (): void => {
          if (!current.signal.aborted) scene(current.signal).then(repeat, () => undefined)
        }
        repeat()
      } else if (!should && controller) {
        controller.abort()
        controller = null
        settle()
      }
    }
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false
      sync()
    })
    observer.observe(element)
    reduced.addEventListener("change", sync)
    document.addEventListener("visibilitychange", sync)
    return () => {
      observer.disconnect()
      reduced.removeEventListener("change", sync)
      document.removeEventListener("visibilitychange", sync)
      controller?.abort()
    }
  }, [ref, scene, settle])
}
