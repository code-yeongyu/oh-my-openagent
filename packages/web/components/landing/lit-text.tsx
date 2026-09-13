"use client"

import type { JSX } from "react"
import { useEffect, useRef, useState } from "react"

import { cn } from "@/lib/utils"

export interface LitTextProps {
  readonly text: string
  readonly className?: string
}

const THRESHOLDS = Array.from({ length: 41 }, (_, i) => i / 40)

/**
 * Splits `text` into words that light up in order as the paragraph scrolls through the
 * viewport (DESIGN.md §10 lit text). Progress is the paragraph's travel from entering at the
 * viewport bottom to reaching its upper third, sampled at every IntersectionObserver
 * threshold crossing, so the last word lights before the paragraph leaves.
 */
export function LitText({ text, className }: LitTextProps): JSX.Element {
  const ref = useRef<HTMLParagraphElement>(null)
  const words = text.split(/(\s+)/)
  const wordCount = words.filter((w) => w.trim()).length
  const [lit, setLit] = useState(0)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setLit(wordCount)
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return
        const viewport = entry.rootBounds?.height ?? window.innerHeight
        const start = viewport
        const end = viewport * 0.35
        const progress = Math.min(
          1,
          Math.max(0, (start - entry.boundingClientRect.top) / (start - end)),
        )
        setLit((current) => Math.max(current, Math.round(progress * wordCount)))
      },
      { threshold: THRESHOLDS, rootMargin: "0px 0px -35% 0px" },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [wordCount])

  let index = 0
  return (
    <p ref={ref} className={cn("lit-text", className)}>
      {words.map((word, i) => {
        if (!word.trim()) return word
        const isLit = index < lit
        index += 1
        return (
          <span key={i} className={cn("lit-word", isLit && "is-lit")}>
            {word}
          </span>
        )
      })}
    </p>
  )
}
