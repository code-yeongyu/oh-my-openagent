import type { JSX, ReactNode } from "react"

/** The numbered eyebrow, the two-tone headline (statement, then its consequence in --ink-2) and the lede. */
export function SectionHead({
  id,
  num,
  eyebrow,
  title,
  soft,
  children,
}: {
  readonly id: string
  readonly num?: string
  readonly eyebrow?: string
  readonly title: string
  readonly soft: string
  readonly children?: ReactNode
}): JSX.Element {
  return (
    <div className="reveal">
      {eyebrow ? (
        <p className="eyebrow">
          {num ? <span className="num">{num}</span> : null}
          <span className="rule" aria-hidden="true" />
          {eyebrow}
        </p>
      ) : null}
      <h2 id={id} className="h2">
        {title} <span className="soft">{soft}</span>
      </h2>
      {children ? <p className="section__lede">{children}</p> : null}
    </div>
  )
}
