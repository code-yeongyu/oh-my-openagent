"use client"

import type { RefObject } from "react"
import { useEffect, useState } from "react"

function registerLitProgress(): boolean {
  if (typeof CSS === "undefined" || !("registerProperty" in CSS)) return false
  try {
    CSS.registerProperty({
      name: "--lit-p",
      syntax: "<number>",
      inherits: true,
      initialValue: "0",
    })
    return true
  } catch (error) {
    return error instanceof DOMException && error.name === "InvalidModificationError"
  }
}

function supportsScrollTimeline(): boolean {
  return CSS.supports("animation-timeline: view()")
}

export type LitMode = "pending" | "scroll" | "observer"

function vhPx(style: CSSStyleDeclaration, property: string, viewport: number): number {
  return (Number.parseFloat(style.getPropertyValue(property)) / 100) * viewport
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

/**
 * The reveal's single authoritative driver: one document-level scroll/resize/scrollend listener
 * that lights every reveal word by its own document position. A word lights as its bottom crosses
 * the full line (--lit-line - --lit-band) of any reading block on the page. Because the input is
 * document-relative, already-revealed text stays lit and the lit frontier is monotonic — there is
 * no per-block observer to go stale once a block scrolls past. Registered once, rAF-batched.
 */
let revealDriverArmed = false
function armRevealDriver(): void {
  if (revealDriverArmed) return
  // Reduced motion: the page renders fully lit and the reveal never runs.
  if (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    return
  }
  revealDriverArmed = true
  let frame = 0
  const update = () => {
    frame = 0
    const viewport = window.innerHeight
    for (const block of Array.from(document.querySelectorAll<HTMLElement>(".lit-read"))) {
      const body = block.querySelector<HTMLElement>(".lit-text")
      if (!body) continue
      // The driver has run at least once: this block now reports its real mode.
      if (block.dataset.litMode === "pending") block.dataset.litMode = "observer"
      const endTop =
        vhPx(getComputedStyle(block), "--lit-line", viewport) -
        vhPx(getComputedStyle(block), "--lit-band", viewport)
      const words: { node: HTMLElement; bottom: number; height: number; left: number }[] = []
      for (const word of body.querySelectorAll<HTMLElement>(".lit-word")) {
        const rect = word.getBoundingClientRect()
        words.push({ node: word, bottom: rect.bottom, height: rect.height || 1, left: rect.left })
      }
      // Per-word reveal: each word lights as its own bottom crosses the full line, with a small
      // left-to-right stagger within its line so words light one at a time (word-by-word), never
      // a whole line at once. The stagger is measured from the text column's left edge (not the
      // viewport), so reading order holds at any width.
      const bodyRect = body.getBoundingClientRect()
      const lineWidth = Math.max(1, bodyRect.width)
      // Mixed-script glyph metrics can differ by subpixels on the same visual line.
      // Cluster within half a line-height instead of treating every distinct bottom as a wrap.
      const lineHeight =
        Number.parseFloat(getComputedStyle(body).lineHeight) ||
        Math.max(1, ...words.map(({ height }) => height)) * 1.5
      const lines: { bottom: number; height: number; words: typeof words }[] = []
      for (const word of [...words].sort((a, b) => a.bottom - b.bottom)) {
        const line = lines.at(-1)
        if (line && word.bottom - line.bottom < lineHeight / 2) {
          line.bottom = Math.max(line.bottom, word.bottom)
          line.height = Math.max(line.height, word.height)
          line.words.push(word)
        } else {
          lines.push({ bottom: word.bottom, height: word.height, words: [word] })
        }
      }
      const brightness = new Map<HTMLElement, number>()
      for (const [index, line] of lines.entries()) {
        const next = lines[index + 1]
        const previous = lines[index - 1]
        const spacing = next
          ? next.bottom - line.bottom
          : previous
            ? line.bottom - previous.bottom
            : line.height * 2
        const stagger = Math.min(line.height * 2, spacing)
        for (const { node, left } of line.words) {
          const withinLine = clamp01((left - bodyRect.left) / lineWidth) * stagger
          brightness.set(
            node,
            clamp01((endTop - line.bottom - withinLine) / (line.height * 1.6) + 1),
          )
        }
      }
      // Font fallback can change line boxes and fade heights. Preserve DOM reading order even
      // when those metrics split one visual line: no later word may overtake an earlier word.
      let preceding = 1
      for (const { node } of words) {
        preceding = Math.min(preceding, brightness.get(node) ?? 1)
        node.style.setProperty("--lit-local", String(preceding))
      }
    }
  }
  const schedule = () => {
    if (frame === 0) frame = requestAnimationFrame(update)
  }
  window.addEventListener("scroll", schedule, { passive: true })
  window.addEventListener("resize", schedule)
  document.addEventListener("scrollend", schedule)
  update()
}

/**
 * Scroll-driven reveal. `reveal` (manifesto): a bright edge moves down the block; everything above
 * it stays lit, words below rest at the unread floor — a whole screenful is always readable.
 * Default paragraph (landing secret): the body sweeps across `20vh → 50vh`, then `.lit-follow`
 * fades in after a hold. IO gates the fallback geometry sampling; intersection-ratio alone stops
 * changing for fully visible or viewport-spanning blocks, so geometry is sampled per frame.
 */
export function useLitProgress(
  ref: RefObject<HTMLDivElement | null>,
  reducedMotion: boolean,
  reveal: boolean,
): LitMode {
  const [driven, setMode] = useState<LitMode>("pending")
  // Paragraph mode uses the timeline when available and the observer fallback otherwise; reduced
  // motion never animates. Reveal mode renders "pending" (text stays lit before JS / under JS
  // failure); the shared driver flips the DOM attribute to "observer" after its first pass.
  const mode: LitMode = reducedMotion ? "observer" : driven

  useEffect(() => {
    if (reducedMotion) return
    const element = ref.current
    const body = element?.querySelector<HTMLElement>(".lit-text")
    const follow = element?.querySelector<HTMLElement>(".lit-follow") ?? null
    if (!element || !body) return
    if (reveal) {
      // The reveal is driven by the shared document-level per-word driver (monotonic frontier).
      // It flips data-lit-mode to "observer" on every block after its first pass.
      armRevealDriver()
      return
    }
    const useTimeline = registerLitProgress() && supportsScrollTimeline()

    const updateProgress = () => {
      const rect = body.getBoundingClientRect()
      const viewport = window.innerHeight
      const style = getComputedStyle(element)
      const startTop = viewport * 0.8
      const endTop = viewport * 0.5 - rect.height
      element.style.setProperty(
        "--lit-p",
        String(clamp01((startTop - rect.top) / (startTop - endTop))),
      )
      if (!follow) return
      const hold = vhPx(style, "--lit-read-hold", viewport)
      const fade = vhPx(style, "--lit-follow-fade", viewport)
      const gap = Number.parseFloat(getComputedStyle(follow).marginTop)
      const nextFollow = (endTop - rect.top - Math.max(hold, gap)) / fade
      element.style.setProperty("--lit-f", String(clamp01(nextFollow)))
    }
    let frame = 0
    let intersecting = false
    let observing = false
    const sample = () => {
      updateProgress()
      frame = requestAnimationFrame(sample)
    }
    const syncSampling = () => {
      cancelAnimationFrame(frame)
      if (!observing) return
      updateProgress()
      if (intersecting && !document.hidden) frame = requestAnimationFrame(sample)
    }
    const observer = new IntersectionObserver((entries) => {
      intersecting = entries.some((entry) => entry.isIntersecting)
      syncSampling()
    })
    const startObserving = () => {
      element.classList.remove("lit-scroll")
      setMode("observer")
      observing = true
      updateProgress()
      observer.observe(element)
      document.addEventListener("visibilitychange", syncSampling)
      window.addEventListener("resize", syncSampling)
      document.addEventListener("scrollend", syncSampling)
    }
    if (useTimeline) {
      element.classList.add("lit-scroll")
      const expected = ["lit-progress", ...(follow ? ["lit-follow"] : [])]
      const animations = element
        .getAnimations({ subtree: true })
        .filter((item) => item instanceof CSSAnimation && expected.includes(item.animationName))
      frame = requestAnimationFrame(() => {
        if (
          animations.length === expected.length &&
          animations.every(
            ({ timeline }) =>
              timeline && timeline !== document.timeline && timeline.currentTime !== null,
          )
        ) {
          setMode("scroll")
        } else {
          startObserving()
        }
      })
    } else {
      startObserving()
    }
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      document.removeEventListener("visibilitychange", syncSampling)
      window.removeEventListener("resize", syncSampling)
      document.removeEventListener("scrollend", syncSampling)
      element.classList.remove("lit-scroll")
      element.style.removeProperty("--lit-p")
      element.style.removeProperty("--lit-f")
    }
  }, [reducedMotion, reveal, ref])

  return mode
}
