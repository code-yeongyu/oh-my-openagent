"use client"

import { useCallback, useEffect, useRef, useState, type PointerEvent, type RefObject } from "react"

import { COLUMN_GAP, NODE_HEIGHT, NODE_WIDTH, type DagLayout } from "./layout"
import { isClickGesture } from "./motion"

// Cards must stay legible (mono 10px+ at 0.78); below this the graph pans and follows the
// live wave instead of shrinking, exactly as the desktop panel does when it is narrow.
const MIN_SCALE = 0.78
const MAX_SCALE = 1
const FIT_PADDING = 16

export interface DagCamera {
  readonly x: number
  readonly y: number
  readonly scale: number
}

interface DragOrigin {
  readonly pointerId: number
  readonly clientX: number
  readonly clientY: number
  readonly cameraX: number
  readonly cameraY: number
  panning: boolean
}

export interface DagCameraControls {
  readonly camera: DagCamera
  readonly tweening: boolean
  /** True when the graph is wider than the viewport even at the fitted scale. */
  readonly overflowing: boolean
  readonly fit: () => void
  readonly centerWave: (waveIndex: number, waveRows: readonly number[]) => void
  readonly onPointerDown: (event: PointerEvent<HTMLDivElement>) => void
  readonly onPointerMove: (event: PointerEvent<HTMLDivElement>) => void
  readonly onPointerUp: (event: PointerEvent<HTMLDivElement>) => void
}

/**
 * Port of the desktop graph camera: fit-to-viewport on size changes until the reader takes
 * the camera (drag), Fit hands it back, Center keeps the reader's zoom and moves only WHERE
 * it looks. No wheel zoom on the landing page — the wheel belongs to the document.
 */
export function useDagCamera(
  viewportRef: RefObject<HTMLDivElement | null>,
  layout: DagLayout,
): DagCameraControls {
  const [camera, setCamera] = useState<DagCamera>({ x: 0, y: 0, scale: 1 })
  const [tweening, setTweening] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  const takenRef = useRef(false)
  const dragRef = useRef<DragOrigin | null>(null)
  const tweenTimer = useRef<number | null>(null)

  const armTween = useCallback(() => {
    setTweening(true)
    if (tweenTimer.current !== null) window.clearTimeout(tweenTimer.current)
    tweenTimer.current = window.setTimeout(() => {
      tweenTimer.current = null
      setTweening(false)
    }, 340)
  }, [])

  const applyFit = useCallback(() => {
    const viewport = viewportRef.current
    if (viewport === null || layout.width <= 0 || viewport.clientWidth <= 0) return
    const scale = Math.min(
      MAX_SCALE,
      Math.max(
        MIN_SCALE,
        Math.min(
          (viewport.clientWidth - FIT_PADDING * 2) / layout.width,
          (viewport.clientHeight - FIT_PADDING * 2) / layout.height,
        ),
      ),
    )
    const scaledWidth = layout.width * scale
    const scaledHeight = layout.height * scale
    setOverflowing(scaledWidth > viewport.clientWidth)
    setCamera({
      scale,
      x:
        scaledWidth > viewport.clientWidth ? FIT_PADDING : (viewport.clientWidth - scaledWidth) / 2,
      y:
        scaledHeight > viewport.clientHeight
          ? FIT_PADDING
          : (viewport.clientHeight - scaledHeight) / 2,
    })
    armTween()
  }, [viewportRef, layout, armTween])

  useEffect(() => {
    const autoFit = () => {
      if (!takenRef.current) applyFit()
    }
    autoFit()
    const viewport = viewportRef.current
    if (viewport === null || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(autoFit)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [applyFit, viewportRef])

  useEffect(
    () => () => {
      if (tweenTimer.current !== null) window.clearTimeout(tweenTimer.current)
    },
    [],
  )

  const fit = useCallback(() => {
    takenRef.current = false
    applyFit()
  }, [applyFit])

  const centerWave = useCallback(
    (waveIndex: number, waveRows: readonly number[]) => {
      const viewport = viewportRef.current
      if (viewport === null || waveRows.length === 0) return
      const centerX = waveIndex * (NODE_WIDTH + COLUMN_GAP) + NODE_WIDTH / 2
      const centerY = (Math.min(...waveRows) + Math.max(...waveRows) + NODE_HEIGHT) / 2
      takenRef.current = true
      setCamera((previous) => ({
        scale: previous.scale,
        x: viewport.clientWidth / 2 - centerX * previous.scale,
        y: viewport.clientHeight / 2 - centerY * previous.scale,
      }))
      armTween()
    },
    [viewportRef, armTween],
  )

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      dragRef.current = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        cameraX: camera.x,
        cameraY: camera.y,
        panning: false,
      }
    },
    [camera.x, camera.y],
  )

  const onPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (drag === null || drag.pointerId !== event.pointerId) return
    if (!drag.panning) {
      if (isClickGesture(drag.clientX, drag.clientY, event.clientX, event.clientY)) return
      drag.panning = true
      takenRef.current = true
      if (typeof event.currentTarget.setPointerCapture === "function") {
        event.currentTarget.setPointerCapture(event.pointerId)
      }
    }
    setCamera((previous) => ({
      ...previous,
      x: drag.cameraX + event.clientX - drag.clientX,
      y: drag.cameraY + event.clientY - drag.clientY,
    }))
  }, [])

  const onPointerUp = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (drag === null || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    if (drag.panning && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }, [])

  return {
    camera,
    tweening,
    overflowing,
    fit,
    centerWave,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  }
}
