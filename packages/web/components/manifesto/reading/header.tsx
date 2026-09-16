import type { JSX } from "react"
import { getTranslations } from "next-intl/server"

import { Eyebrow } from "@/components/ledger/eyebrow"
import { PROSE_LIMIT } from "@/components/manifesto/manifesto-section"

export async function ManifestoHeader(): Promise<JSX.Element> {
  const t = await getTranslations("manifesto")

  return (
    <section
      data-section="manifesto-hero"
      aria-labelledby="manifesto-hero-title"
      className="py-24 lg:py-40"
    >
      <div className={`${PROSE_LIMIT} space-y-6`}>
        <Eyebrow rule as="p">
          {t("badge")}
        </Eyebrow>
        <h1 id="manifesto-hero-title" className="type-display text-text-hi">
          {t("hero.title")}
        </h1>
        <p className="type-title text-text-mid leading-[1.2] whitespace-pre-line">
          {t("hero.subtitle")}
        </p>
        <p
          data-testid="manifesto-byline"
          className="text-text-lo pt-4 font-mono text-xs leading-[1.45] tracking-[0.04em]"
        >
          <span>{t("meta.author")}</span>
          <span aria-hidden="true"> · </span>
          <time dateTime="2026-09-14">{t("meta.date")}</time>
        </p>
        <p className="text-text-lo prose-cjk text-sm leading-[1.55] italic">{t("meta.series")}</p>
      </div>
    </section>
  )
}
