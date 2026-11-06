"use client"

import type { JSX } from "react"
import { useEffect, useRef, useState } from "react"

import {
  draw,
  layout,
  type Colors,
  type Geometry,
  type NodeTrack,
  type Packet,
} from "@/components/home/graph/draw"
import { EASE_ENTER, EASE_STATE, Tween } from "@/components/home/graph/ease"
import { GRAPH_NODES, SCENES } from "@/components/home/graph/scenes"

const LOAD = { idle: 0, running: 0.55, done: 1, blocked: 0.3 } as const
const SCENE_MS = 5600

function readColors(): Colors {
  const style = getComputedStyle(document.documentElement)
  const v = (name: string): string => style.getPropertyValue(name).trim()
  return {
    ink: v("--ink"),
    ink2: v("--ink-2"),
    ink3: v("--ink-3"),
    dot: v("--dot"),
    line: v("--line-strong"),
    accent: v("--accent"),
    wait: v("--wait"),
    ok: v("--ok"),
  }
}

/**
 * The sample run as a dot-matrix graph in four captioned scenes (plan, fan out, finish, check). Scenes advance every
 * 5.6 s and on click; drawing runs only while the figure is on screen. Under reduced motion each scene is drawn settled.
 */
export function RunGraph({
  steps,
  captions,
  hubLabel,
  figureLabel,
  stepsLabel,
}: {
  readonly steps: readonly string[]
  readonly captions: readonly string[]
  readonly hubLabel: string
  readonly figureLabel: string
  readonly stepsLabel: string
}): JSX.Element {
  const [scene, setScene] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const api = useRef<{ go: (i: number, animate: boolean) => void; running: () => boolean } | null>(
    null,
  )

  useEffect(() => {
    const el = root.current
    const cv = canvas.current
    const ctx = cv?.getContext("2d")
    if (!el || !cv || !ctx) return
    const reduced = matchMedia("(prefers-reduced-motion: reduce)")
    const tracks = new Map<string, NodeTrack>(
      GRAPH_NODES.map((n) => [n.id, { shown: new Tween(0), load: new Tween(0), state: "idle" }]),
    )
    let geo: Geometry = layout(cv.clientWidth)
    let colors = readColors()
    let current = 0
    let packets: Packet[] = []
    let raf = 0
    let timer = 0
    let nextPacket = 0
    let visible = false

    const resize = (): void => {
      geo = layout(cv.clientWidth)
      const dpr = Math.min(devicePixelRatio || 1, 2)
      cv.style.height = `${geo.height}px`
      cv.width = Math.round(geo.width * dpr)
      cv.height = Math.round(geo.height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    const paint = (now: number): void => draw(ctx, geo, colors, tracks, packets, now, hubLabel)
    const running = (): boolean =>
      visible && !reduced.matches && document.visibilityState === "visible"
    const go = (index: number, animate: boolean): void => {
      current = index
      setScene(index)
      const now = performance.now()
      for (const [i, node] of GRAPH_NODES.entries()) {
        const state = SCENES[index]?.states[node.id] ?? null
        const track = tracks.get(node.id)
        if (!track) continue
        track.state = state ?? "idle"
        const shown = state === null ? 0 : 1
        if (animate) {
          track.shown.set(shown, now + i * 50, 900, EASE_ENTER)
          track.load.set(LOAD[track.state], now + 200 + i * 40, 700, EASE_STATE)
        } else {
          track.shown.jump(shown)
          track.load.jump(LOAD[track.state])
        }
      }
      packets = []
    }
    const frame = (now: number): void => {
      if (SCENES[current]?.flow && now >= nextPacket) {
        const live = GRAPH_NODES.filter((n) => tracks.get(n.id)?.state === "running")
        const pool = live.length ? live : GRAPH_NODES
        const target = pool[Math.floor(Math.random() * pool.length)]
        if (target)
          packets.push({ to: target.id, start: now, dur: 1500, back: Math.random() < 0.4 })
        nextPacket = now + 380
      }
      packets = packets.filter((p) => now - p.start < p.dur)
      paint(now)
      raf = requestAnimationFrame(frame)
    }
    const advance = (): void => {
      go((current + 1) % SCENES.length, true)
      timer = window.setTimeout(advance, SCENE_MS)
    }
    const sync = (): void => {
      cancelAnimationFrame(raf)
      clearTimeout(timer)
      if (running()) {
        raf = requestAnimationFrame(frame)
        timer = window.setTimeout(advance, SCENE_MS)
      } else {
        go(current, false)
        paint(performance.now())
      }
    }
    api.current = {
      running,
      go: (i, animate) => {
        clearTimeout(timer)
        go(i, animate)
        if (running()) timer = window.setTimeout(advance, SCENE_MS + 2400)
        else paint(performance.now())
      },
    }
    resize()
    go(0, false)
    paint(performance.now())
    const ro = new ResizeObserver(() => {
      resize()
      if (!running()) paint(performance.now())
    })
    ro.observe(cv)
    const recolor = (): void => {
      colors = readColors()
      if (!running()) paint(performance.now())
    }
    const mo = new MutationObserver(recolor)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] })
    const scheme = matchMedia("(prefers-color-scheme: dark)")
    scheme.addEventListener("change", recolor)
    void document.fonts.ready.then(recolor)
    const io = new IntersectionObserver(([entry]) => {
      const was = visible
      visible = entry?.isIntersecting ?? false
      if (visible && !was && running()) {
        for (const track of tracks.values()) track.shown.jump(0)
        go(current, true)
      }
      sync()
    })
    io.observe(el)
    reduced.addEventListener("change", sync)
    document.addEventListener("visibilitychange", sync)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(timer)
      ro.disconnect()
      mo.disconnect()
      io.disconnect()
      scheme.removeEventListener("change", recolor)
      reduced.removeEventListener("change", sync)
      document.removeEventListener("visibilitychange", sync)
    }
  }, [hubLabel])

  return (
    <div ref={root} className="graph reveal">
      <div className="graph__steps" role="group" aria-label={stepsLabel}>
        {steps.map((step, i) => (
          <button
            key={step}
            type="button"
            aria-pressed={scene === i}
            onClick={() => api.current?.go(i, api.current.running())}
          >
            <span className="graph__n">{String(i + 1).padStart(2, "0")}</span>
            {step}
          </button>
        ))}
      </div>
      <canvas ref={canvas} className="graph__canvas" role="img" aria-label={figureLabel} />
      <div className="graph__caption" aria-live="polite">
        <p dangerouslySetInnerHTML={{ __html: captions[scene] ?? "" }} />
      </div>
    </div>
  )
}
