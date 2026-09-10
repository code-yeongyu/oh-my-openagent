"use client"

import type { CSSProperties, JSX, ReactNode } from "react"
import { useRef, useEffect, useState } from "react"

import { cn } from "@/lib/utils"

export interface RevealProps {
  readonly children: ReactNode
  /** Stagger slot: delay = index * 60ms (DESIGN.md §6). */
  readonly index?: number
  readonly className?: string
  readonly as?: "div" | "section" | "li" | "article"
}

function supportsScrollTimeline(): boolean {
  return typeof CSS !== "undefined" && CSS.supports("animation-timeline: view()")
}

/**
 * `.reveal` wrapper (DESIGN.md §6). Browsers with `animation-timeline: view()` run the
 * scroll-driven entrance in pure CSS; others get `.is-visible` from an IntersectionObserver
 * that fires once. Reduced motion is handled by the stylesheet (final state, no transition).
 */
export function Reveal({
  children,
  index = 0,
  className,
  as: Tag = "div",
}: RevealProps): JSX.Element {
  const ref = useRef<HTMLElement>(null)
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element || isVisible || supportsScrollTimeline()) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return
        setIsVisible(true)
        observer.disconnect()
      },
      { threshold: 0.15 },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [isVisible])

  const style: CSSProperties & { "--index": number } = { "--index": index }

  return (
    <Tag
      ref={(node: HTMLElement | null) => {
        ref.current = node
      }}
      style={style}
      className={cn("reveal", isVisible && "is-visible", className)}
    >
      {children}
    </Tag>
  )
}

interface TerminalTypewriterProps {
  text: string
}

export function TerminalTypewriter({ text }: TerminalTypewriterProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const [isInView, setIsInView] = useState(false)
  const [displayed, setDisplayed] = useState("")

  useEffect(() => {
    const element = ref.current
    if (!element || isInView) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return
        setIsInView(true)
        observer.disconnect()
      },
      { threshold: 0.1 },
    )

    observer.observe(element)

    return () => observer.disconnect()
  }, [isInView])

  useEffect(() => {
    if (!isInView) return
    let i = 0
    const interval = setInterval(() => {
      if (i <= text.length) {
        setDisplayed(text.slice(0, i))
        i++
      } else {
        clearInterval(interval)
      }
    }, 40)
    return () => clearInterval(interval)
  }, [isInView, text])

  return (
    <span ref={ref} className="text-zinc-300">
      {displayed}
      {displayed.length < text.length && <span className="animate-pulse">_</span>}
    </span>
  )
}
