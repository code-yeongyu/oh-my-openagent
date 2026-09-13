import type { CSSProperties, JSX, ReactNode } from "react"

import { Chip } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export interface MarqueeProps {
  readonly items: readonly string[]
  readonly reverse?: boolean
  readonly durationSeconds?: number
  readonly className?: string
}

export function Marquee({
  items,
  reverse = false,
  durationSeconds = 40,
  className,
}: MarqueeProps): JSX.Element {
  const style: CSSProperties & { "--marquee-dur": string } = {
    "--marquee-dur": `${durationSeconds}s`,
  }
  const track = (hidden: boolean): JSX.Element => (
    <ul className="marquee-track" aria-hidden={hidden || undefined}>
      {items.map((item) => (
        <li key={item}>
          <Chip className="bg-ink-1 whitespace-nowrap">{item}</Chip>
        </li>
      ))}
    </ul>
  )
  return (
    <div className={cn("marquee", reverse && "marquee-reverse", className)} style={style}>
      {track(false)}
      {track(true)}
    </div>
  )
}

export interface TickerProps {
  readonly rows: readonly { readonly key: string; readonly content: ReactNode }[]
  readonly durationSeconds?: number
  readonly className?: string
}

export function Ticker({ rows, durationSeconds = 30, className }: TickerProps): JSX.Element {
  const style: CSSProperties & { "--ticker-dur": string } = {
    "--ticker-dur": `${durationSeconds}s`,
  }
  const track = (hidden: boolean): JSX.Element => (
    <ul className="divide-line divide-y" aria-hidden={hidden || undefined}>
      {rows.map((row) => (
        <li key={row.key} className="py-3">
          {row.content}
        </li>
      ))}
    </ul>
  )
  return (
    <div className={cn("ticker", className)} style={style}>
      <div className="ticker-track">
        {track(false)}
        {track(true)}
      </div>
    </div>
  )
}

export interface RotatingWordProps {
  readonly words: readonly string[]
  /** Rendered inside every row so a particle ("에서", "から") always hugs the current word. */
  readonly suffix?: string
  readonly className?: string
}

export function RotatingWord({ words, suffix = "", className }: RotatingWordProps): JSX.Element {
  const style: CSSProperties & { "--count": number } = { "--count": words.length }
  return (
    <span className={cn("rotate-word", className)} style={style}>
      <span className="rotate-word-track">
        {words.map((word) => (
          <span key={word}>
            <span className="text-accent">{word}</span>
            {suffix ? <span className="text-text-hi">{suffix}</span> : null}
          </span>
        ))}
      </span>
    </span>
  )
}
