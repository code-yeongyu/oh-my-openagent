"use client"

import dynamic from "next/dynamic"
import Image from "next/image"
import { Component, useEffect, useRef, useState, type ReactNode } from "react"
import { useTranslations } from "next-intl"
import { setFocused } from "./use-graph-focus"

const GraphScene = dynamic(() => import("./graph-scene"), { ssr: false })

// The renderer chunk waits for user intent (pointer/scroll/key) or for the page to settle after
// load, so the poster carries the first paint and three.js never competes with LCP/TBT.
const SETTLE_AFTER_LOAD_MS = 4000

class SceneBoundary extends Component<
  { readonly children: ReactNode; readonly onFailure: () => void },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: Error) {
    console.error("Agent graph failed", error)
    this.props.onFailure()
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

function supportsGraph() {
  if (
    "deviceMemory" in navigator &&
    typeof navigator.deviceMemory === "number" &&
    navigator.deviceMemory < 2
  )
    return false
  if (
    "connection" in navigator &&
    typeof navigator.connection === "object" &&
    navigator.connection !== null &&
    "saveData" in navigator.connection &&
    navigator.connection.saveData === true
  )
    return false
  const canvas = document.createElement("canvas")
  const gl = canvas.getContext("webgl2")
  if (!gl) return false
  gl.getExtension("WEBGL_lose_context")?.loseContext()
  return true
}

export function GraphHero({ className }: { readonly className?: string }) {
  const t = useTranslations("landing.agents")
  const root = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<"poster" | "mounting" | "live" | "fallback">("poster")
  const [visible, setVisible] = useState(false)
  const [tabVisible, setTabVisible] = useState(true)
  const [mobile, setMobile] = useState(false)
  const [rotation, setRotation] = useState(0)
  const [focusRequest, setFocusRequest] = useState(0)
  const [resting, setResting] = useState(false)
  const lastInteraction = useRef(0)
  const interact = () => {
    lastInteraction.current = performance.now()
    setResting(false)
  }
  useEffect(() => {
    lastInteraction.current = performance.now()
    const timer = window.setInterval(
      () => setResting(performance.now() - lastInteraction.current >= 20000),
      1000,
    )
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    const element = root.current
    if (!element) return
    const motion = matchMedia("(prefers-reduced-motion: reduce)")
    const narrow = matchMedia("(max-width: 767px)")
    let seen = false
    let idle = false
    let eligible = false
    const mount = () => {
      if (seen && idle && eligible && !motion.matches)
        setState((current) => (current === "poster" ? "mounting" : current))
    }
    const preference = () => {
      if (motion.matches) {
        eligible = false
        setState("poster")
      } else {
        eligible = supportsGraph()
        mount()
      }
    }
    const resize = () => setMobile(narrow.matches)
    const visibility = () => setTabVisible(!document.hidden)
    resize()
    visibility()
    preference()
    const observer = new IntersectionObserver(([entry]) => {
      setVisible(entry?.isIntersecting ?? false)
      seen ||= entry?.isIntersecting ?? false
      mount()
    })
    observer.observe(element)
    const onIdle = () => {
      idle = true
      mount()
    }
    const intentTargets: Array<[EventTarget, string]> = [
      [element, "pointerenter"],
      [element, "pointerdown"],
      [element, "touchstart"],
      [window, "scroll"],
      [window, "keydown"],
    ]
    for (const [target, type] of intentTargets)
      target.addEventListener(type, onIdle, { once: true, passive: true })
    let settleTimer: number | undefined
    const scheduleSettle = () => {
      settleTimer = window.setTimeout(onIdle, SETTLE_AFTER_LOAD_MS)
    }
    if (document.readyState === "complete") scheduleSettle()
    else window.addEventListener("load", scheduleSettle, { once: true })
    motion.addEventListener("change", preference)
    narrow.addEventListener("change", resize)
    document.addEventListener("visibilitychange", visibility)
    return () => {
      observer.disconnect()
      for (const [target, type] of intentTargets) target.removeEventListener(type, onIdle)
      window.removeEventListener("load", scheduleSettle)
      if (settleTimer !== undefined) window.clearTimeout(settleTimer)
      motion.removeEventListener("change", preference)
      narrow.removeEventListener("change", resize)
      document.removeEventListener("visibilitychange", visibility)
    }
  }, [])
  return (
    <div
      ref={root}
      data-testid="graph-hero"
      data-state={state}
      className={`relative isolate aspect-[8/5] w-full overflow-hidden ${className ?? ""}`}
    >
      <Image
        unoptimized
        data-testid="graph-poster"
        src="/images/graph-poster.svg"
        width={1600}
        height={1000}
        alt={t("subtitle")}
        priority
        className="absolute inset-0 h-full w-full object-contain"
        style={{
          opacity: state === "live" ? 0 : 1,
          transition: "opacity 400ms var(--ease-standard)",
        }}
      />
      <div
        tabIndex={0}
        role="region"
        aria-label={t("title")}
        className="absolute inset-0 outline-offset-2 focus-visible:outline-2 focus-visible:outline-[var(--accent-32)]"
        style={{
          opacity: state === "live" ? 1 : 0,
          transition: "opacity 400ms var(--ease-standard)",
        }}
        onPointerDown={interact}
        onPointerMove={interact}
        onKeyDown={(event) => {
          interact()
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault()
            setRotation((value) => (event.key === "ArrowLeft" ? -1 : 1) * (Math.abs(value) + 1))
          }
          if (event.key === "Escape") setFocused(null)
          if (event.key === "Enter") setFocusRequest((value) => value + 1)
        }}
      >
        {(state === "mounting" || state === "live") && (
          <SceneBoundary onFailure={() => setState("fallback")}>
            <GraphScene
              mobile={mobile}
              active={visible && tabVisible && !resting}
              rotation={rotation}
              focusRequest={focusRequest}
              onReady={() => setState("live")}
              onFailure={() => setState("fallback")}
            />
          </SceneBoundary>
        )}
      </div>
    </div>
  )
}

export default GraphHero
