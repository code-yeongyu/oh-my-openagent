import type { JSX } from "react"

import type { LitPart } from "@/components/landing/lit-text"
import { LitProgress, LitWords } from "@/components/landing/lit-text"
import { cn } from "@/lib/utils"

/** DESIGN.md §3 Lead scaled up one step for long-form reading; §10 `lit-read` sweep. */
export const READING_CLASS = "prose-cjk text-xl leading-[1.7] md:text-2xl"

export interface ReadingParagraphProps {
  readonly text?: string
  readonly parts?: readonly LitPart[]
  readonly className?: string
}

/**
 * One manifesto paragraph: a `LitProgress` reading block in reveal mode. A scroll-driven window
 * reveal keeps everything above the bright edge fully lit, so a whole screenful is readable and
 * the reveal never gates reading on scroll; words near the edge carry the emphasis.
 */
export function ReadingParagraph({ text, parts, className }: ReadingParagraphProps): JSX.Element {
  return (
    <LitProgress className="lit-read" reveal>
      {parts ? (
        <LitWords parts={parts} className={cn(READING_CLASS, className)} />
      ) : (
        <LitWords text={text ?? ""} className={cn(READING_CLASS, className)} />
      )}
    </LitProgress>
  )
}
