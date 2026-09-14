"use client"

import type { CSSProperties, JSX, ReactNode } from "react"
import { useEffect, useRef, useState } from "react"

import { cn } from "@/lib/utils"

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

export interface LitProgressProps {
  readonly children: ReactNode
  readonly className?: string
}

/**
 * The body's named view timeline drives separate word and follow-up ranges (DESIGN.md §10).
 * IO gates the geometry fallback, rather than sampling progress through intersection thresholds:
 * those stop changing when a short block is fully visible or a tall block spans the viewport.
 * The `.lit-follow` element is optional: a reading block (`lit-read`) sweeps its words alone.
 */
export function LitProgress({ children, className }: LitProgressProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState<"pending" | "scroll" | "observer">("pending")

  useEffect(() => {
    const element = ref.current
    const body = element?.querySelector<HTMLElement>(".lit-text")
    const follow = element?.querySelector<HTMLElement>(".lit-follow") ?? null
    if (!element || !body) return
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setMode("observer")
      return
    }
    const useTimeline = registerLitProgress() && supportsScrollTimeline()

    const updateProgress = () => {
      const rect = body.getBoundingClientRect()
      const viewport = window.innerHeight
      const style = getComputedStyle(element)
      const startTop = viewport * 0.8
      const endTop = viewport * 0.5 - rect.height
      const words = (startTop - rect.top) / (startTop - endTop)
      element.style.setProperty("--lit-p", String(Math.min(1, Math.max(0, words))))
      if (!follow) return
      const hold = (Number.parseFloat(style.getPropertyValue("--lit-read-hold")) / 100) * viewport
      const fade = (Number.parseFloat(style.getPropertyValue("--lit-follow-fade")) / 100) * viewport
      const gap = Number.parseFloat(getComputedStyle(follow).marginTop)
      const nextFollow = (endTop - rect.top - Math.max(hold, gap)) / fade
      element.style.setProperty("--lit-f", String(Math.min(1, Math.max(0, nextFollow))))
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
    const useObserver = () => {
      element.classList.remove("lit-scroll")
      setMode("observer")
      observing = true
      updateProgress()
      observer.observe(element)
      document.addEventListener("visibilitychange", syncSampling)
      window.addEventListener("resize", syncSampling)
    }
    if (useTimeline) {
      element.classList.add("lit-scroll")
      const expectedAnimations = follow ? ["lit-progress", "lit-follow"] : ["lit-progress"]
      const animations = element
        .getAnimations({ subtree: true })
        .filter(
          (item) => item instanceof CSSAnimation && expectedAnimations.includes(item.animationName),
        )
      // View timelines acquire their current time during the next rendering update.
      frame = requestAnimationFrame(() => {
        if (
          animations.length === expectedAnimations.length &&
          animations.every(
            ({ timeline }) =>
              timeline && timeline !== document.timeline && timeline.currentTime !== null,
          )
        ) {
          setMode("scroll")
        } else {
          useObserver()
        }
      })
    } else {
      useObserver()
    }
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      document.removeEventListener("visibilitychange", syncSampling)
      window.removeEventListener("resize", syncSampling)
      element.classList.remove("lit-scroll")
      element.style.removeProperty("--lit-p")
      element.style.removeProperty("--lit-f")
    }
  }, [])

  return (
    <div
      ref={ref}
      className={cn("lit-progress", mode === "scroll" && "lit-scroll", className)}
      data-lit-mode={mode}
    >
      {children}
    </div>
  )
}

export interface LitPart {
  readonly text: string
  /** Wrap this part's words in an external link; the sweep continues across it. */
  readonly href?: string
}

export interface LitWordsProps {
  readonly text?: string
  /** Alternative to `text`: consecutive parts, some of them linked. */
  readonly parts?: readonly LitPart[]
  readonly className?: string
}

export function LitWords({ text, parts, className }: LitWordsProps): JSX.Element {
  const resolvedParts: readonly LitPart[] = parts ?? [{ text: text ?? "" }]
  const wordCount = resolvedParts.reduce(
    (count, part) => count + part.text.split(/\s+/).filter(Boolean).length,
    0,
  )
  const style: CSSProperties & { "--lit-count": number } = { "--lit-count": wordCount }

  let index = 0
  const renderWords = (partText: string, keyPrefix: string): ReactNode[] =>
    partText.split(/(\s+)/).map((word, i) => {
      if (!word.trim()) return word
      const wordStyle: CSSProperties & { "--i": number } = { "--i": index }
      index += 1
      return (
        <span key={`${keyPrefix}-${i}`} className="lit-word" style={wordStyle}>
          {word}
        </span>
      )
    })

  return (
    <p className={cn("lit-text", className)} style={style}>
      {resolvedParts.map((part, partIndex) =>
        part.href ? (
          <a
            key={partIndex}
            href={part.href}
            target="_blank"
            rel="noopener noreferrer"
            className="lit-link focus-visible:outline-accent-32 focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {renderWords(part.text, String(partIndex))}
          </a>
        ) : (
          renderWords(part.text, String(partIndex))
        ),
      )}
    </p>
  )
}
