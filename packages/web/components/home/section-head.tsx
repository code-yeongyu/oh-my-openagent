import type { JSX, ReactNode } from "react"

/** The status dot the current omo.dev eyebrows carry: teal for a keyword you type, amber for work in flight. */
export type HeadDot = "accent" | "busy"

/** The numbered eyebrow, the two-tone headline (statement, then its consequence in --ink-soft) and the lede. */
export function SectionHead({
  id,
  num,
  eyebrow,
  dot,
  title,
  soft,
  children,
}: {
  readonly id: string
  readonly num?: string
  readonly eyebrow?: string
  readonly dot?: HeadDot
  readonly title: string
  readonly soft: string
  readonly children?: ReactNode
}): JSX.Element {
  return (
    <div className="rise">
      {eyebrow ? (
        <p className="kicker">
          {num ? <span className="num">{num}</span> : null}
          <span className="rule" aria-hidden="true" />
          {eyebrow}
          {dot ? <span className={`eyebrow__dot eyebrow__dot--${dot}`} aria-hidden="true" /> : null}
        </p>
      ) : null}
      <h2 id={id} className="h2">
        {title} <span className="soft">{soft}</span>
      </h2>
      {children ? <p className="section__lede">{children}</p> : null}
    </div>
  )
}
