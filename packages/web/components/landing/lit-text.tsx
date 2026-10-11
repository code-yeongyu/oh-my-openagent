"use client"

import type { CSSProperties, JSX, ReactNode } from "react"
import { useRef } from "react"

import { useLitProgress } from "@/components/landing/lit-progress"
import { usePrefersReducedMotion } from "@/components/landing/dag/use-dag-playback"
import { cn } from "@/lib/utils"

export interface LitProgressProps {
  readonly children: ReactNode
  readonly className?: string
  /**
   * `reveal` (manifesto reading blocks): a scroll-driven window reveal — a bright edge moves down
   * the block with scroll, everything above the edge stays fully lit, words near the edge carry
   * the emphasis, and words below the edge rest at the unread floor. Default `paragraph` (landing
   * secret): the body sweeps once and an optional `.lit-follow` fades in after a hold.
   */
  readonly reveal?: boolean
}

export function LitProgress({
  children,
  className,
  reveal = false,
}: LitProgressProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const reducedMotion = usePrefersReducedMotion()
  const mode = useLitProgress(ref, reducedMotion, reveal)

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

const countWords = (value: string): number => value.split(/\s+/).filter(Boolean).length

export function LitWords({ text, parts, className }: LitWordsProps): JSX.Element {
  const resolvedParts: readonly LitPart[] = parts ?? [{ text: text ?? "" }]
  const wordCount = resolvedParts.reduce((count, part) => count + countWords(part.text), 0)
  const style: CSSProperties & { "--lit-count": number } = { "--lit-count": wordCount }

  const nodes: ReactNode[] = []
  let index = 0
  for (const [partIndex, part] of resolvedParts.entries()) {
    const words: ReactNode[] = []
    for (const [i, word] of part.text.split(/(\s+)/).entries()) {
      if (!word.trim()) {
        words.push(word)
        continue
      }
      const wordStyle: CSSProperties & { "--i": number } = { "--i": index }
      index += 1
      words.push(
        <span key={`${partIndex}-${i}`} className="lit-word" style={wordStyle}>
          {word}
        </span>,
      )
    }
    nodes.push(
      part.href ? (
        <a
          key={partIndex}
          href={part.href}
          target="_blank"
          rel="noopener noreferrer"
          className="lit-link focus-visible:outline-accent-32 focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {words}
        </a>
      ) : (
        words
      ),
    )
  }

  return (
    <p className={cn("lit-text", className)} style={style}>
      {nodes}
    </p>
  )
}
