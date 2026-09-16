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
 * One manifesto paragraph: its own `LitProgress` block in line mode, so every authored line
 * is a block that lights while it crosses the fixed reading line (`--lit-line`). Only one line
 * is ever mid-sweep, and the reveal unit is the same as the line-break unit.
 */
export function ReadingParagraph({ text, parts, className }: ReadingParagraphProps): JSX.Element {
  return (
    <LitProgress className="lit-read" lines>
      {parts ? (
        <LitWords lines parts={parts} className={cn(READING_CLASS, className)} />
      ) : (
        <LitWords lines text={text ?? ""} className={cn(READING_CLASS, className)} />
      )}
    </LitProgress>
  )
}
