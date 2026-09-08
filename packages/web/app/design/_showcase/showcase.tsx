import type { JSX, ReactNode } from "react"

import { Eyebrow } from "@/components/ledger/eyebrow"

export interface ShowcaseProps {
  readonly id: string
  readonly eyebrow: string
  readonly title: string
  readonly children: ReactNode
}

/** One chapter of the primitive showcase: eyebrow, title, ruled body. */
export function Showcase({ id, eyebrow, title, children }: ShowcaseProps): JSX.Element {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="border-line border-t py-16">
      <Eyebrow rule>{eyebrow}</Eyebrow>
      <h2
        id={`${id}-title`}
        className="text-text-hi mt-3 text-[clamp(2rem,1.3rem+2.4vw,3.25rem)] leading-[1.04] font-medium tracking-[-0.025em]"
      >
        {title}
      </h2>
      <div className="mt-12 flex flex-col gap-12">{children}</div>
    </section>
  )
}

export interface SpecimenProps {
  readonly label: string
  readonly children: ReactNode
  readonly stack?: boolean
}

/** A labelled state row inside a Showcase. */
export function Specimen({ label, children, stack = false }: SpecimenProps): JSX.Element {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,130px)_1fr] lg:gap-6">
      <p className="text-text-lo text-meta tracking-meta font-mono">{label}</p>
      <div className={stack ? "min-w-0" : "flex min-w-0 flex-wrap items-center gap-4"}>
        {children}
      </div>
    </div>
  )
}
