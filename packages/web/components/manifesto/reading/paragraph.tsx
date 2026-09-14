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
 * One manifesto paragraph: its own `LitProgress` block, so the words light up as this
 * paragraph crosses the reading zone (top at 80vh → bottom at 50vh), independently of
 * the paragraphs around it. Authored line breaks survive through `white-space: pre-line`.
 */
export function ReadingParagraph({ text, parts, className }: ReadingParagraphProps): JSX.Element {
  return (
    <LitProgress className="lit-read">
      {parts ? (
        <LitWords parts={parts} className={cn(READING_CLASS, className)} />
      ) : (
        <LitWords text={text ?? ""} className={cn(READING_CLASS, className)} />
      )}
    </LitProgress>
  )
}
