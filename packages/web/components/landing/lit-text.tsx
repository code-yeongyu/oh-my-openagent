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
  /**
   * Light the words line by line as each `.lit-line` crosses the fixed reading line
   * (`--lit-line` ± `--lit-band`), so only one line is in transition at a time. Requires
   * `LitWords` rendered with `lines`.
   */
  readonly lines?: boolean
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

/**
 * The body's named view timeline drives separate word and follow-up ranges (DESIGN.md §10).
 * IO gates the geometry fallback, rather than sampling progress through intersection thresholds:
 * those stop changing when a short block is fully visible or a tall block spans the viewport.
 * The `.lit-follow` element is optional: a reading block (`lit-read`) sweeps its words alone.
 * With `lines`, every `.lit-line` owns its own view timeline anchored to the reading line.
 */
export function LitProgress({ children, className, lines = false }: LitProgressProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState<"pending" | "scroll" | "observer">("pending")

  useEffect(() => {
    const element = ref.current
    const body = element?.querySelector<HTMLElement>(".lit-text")
    const follow = element?.querySelector<HTMLElement>(".lit-follow") ?? null
    if (!element || !body) return
    const lineElements = lines ? [...element.querySelectorAll<HTMLElement>(".lit-line")] : []
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setMode("observer")
      return
    }
    const useTimeline = registerLitProgress() && supportsScrollTimeline()

    const vh = (style: CSSStyleDeclaration, property: string, viewport: number): number =>
      (Number.parseFloat(style.getPropertyValue(property)) / 100) * viewport

    const updateProgress = () => {
      const rect = body.getBoundingClientRect()
      const viewport = window.innerHeight
      const style = getComputedStyle(element)
      if (lineElements.length > 0) {
        const readingLine = vh(style, "--lit-line", viewport)
        const band = vh(style, "--lit-band", viewport)
        for (const line of lineElements) {
          const lineRect = line.getBoundingClientRect()
          const progress = (readingLine + band - lineRect.top) / (lineRect.height + 2 * band)
          line.style.setProperty("--lit-p", String(clamp01(progress)))
        }
      } else {
        const startTop = viewport * 0.8
        const endTop = viewport * 0.5 - rect.height
        const words = (startTop - rect.top) / (startTop - endTop)
        element.style.setProperty("--lit-p", String(clamp01(words)))
      }
      if (!follow) return
      const endTop = viewport * 0.5 - rect.height
      const hold = vh(style, "--lit-read-hold", viewport)
      const fade = vh(style, "--lit-follow-fade", viewport)
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
    const useObserver = () => {
      element.classList.remove("lit-scroll")
      setMode("observer")
      observing = true
      updateProgress()
      observer.observe(element)
      document.addEventListener("visibilitychange", syncSampling)
      window.addEventListener("resize", syncSampling)
      // A jump that skips this block fires no intersection entry; resample once the scroll settles.
      document.addEventListener("scrollend", syncSampling)
    }
    if (useTimeline) {
      element.classList.add("lit-scroll")
      const expectedAnimations = [
        ...Array.from({ length: Math.max(1, lineElements.length) }, () => "lit-progress"),
        ...(follow ? ["lit-follow"] : []),
      ]
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
      document.removeEventListener("scrollend", syncSampling)
      element.classList.remove("lit-scroll")
      element.style.removeProperty("--lit-p")
      element.style.removeProperty("--lit-f")
      for (const line of lineElements) line.style.removeProperty("--lit-p")
    }
  }, [lines])

  return (
    <div
      ref={ref}
      className={cn(
        "lit-progress",
        lines && "lit-lines",
        mode === "scroll" && "lit-scroll",
        className,
      )}
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
  /**
   * Render every authored line (`\n`) as its own `.lit-line` block with its own word count,
   * so a `LitProgress` with `lines` can light the text one line at a time.
   */
  readonly lines?: boolean
}

const countWords = (value: string): number => value.split(/\s+/).filter(Boolean).length

/** Split consecutive parts on authored line breaks; a line may span a linked and a plain part. */
function splitLines(parts: readonly LitPart[]): LitPart[][] {
  const result: LitPart[][] = []
  let current: LitPart[] = []
  for (const part of parts) {
    part.text.split("\n").forEach((segment, i) => {
      if (i > 0) {
        result.push(current)
        current = []
      }
      if (segment.trim()) current.push({ text: segment, href: part.href })
    })
  }
  result.push(current)
  return result.filter((line) => line.length > 0)
}

export function LitWords({ text, parts, className, lines = false }: LitWordsProps): JSX.Element {
  const resolvedParts: readonly LitPart[] = parts ?? [{ text: text ?? "" }]
  const wordCount = resolvedParts.reduce((count, part) => count + countWords(part.text), 0)
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

  const renderParts = (run: readonly LitPart[], keyPrefix: string): ReactNode[] =>
    run.map((part, partIndex) =>
      part.href ? (
        <a
          key={`${keyPrefix}-${partIndex}`}
          href={part.href}
          target="_blank"
          rel="noopener noreferrer"
          className="lit-link focus-visible:outline-accent-32 focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {renderWords(part.text, `${keyPrefix}-${partIndex}`)}
        </a>
      ) : (
        renderWords(part.text, `${keyPrefix}-${partIndex}`)
      ),
    )

  if (!lines) {
    return (
      <p className={cn("lit-text", className)} style={style}>
        {renderParts(resolvedParts, "p")}
      </p>
    )
  }

  return (
    <p className={cn("lit-text", className)} style={style}>
      {splitLines(resolvedParts).map((line, lineIndex) => {
        index = 0
        const lineStyle: CSSProperties & { "--lit-count": number } = {
          "--lit-count": line.reduce((count, part) => count + countWords(part.text), 0),
        }
        return (
          <span key={lineIndex} className="lit-line" style={lineStyle}>
            {renderParts(line, `l${lineIndex}`)}
          </span>
        )
      })}
    </p>
  )
}
