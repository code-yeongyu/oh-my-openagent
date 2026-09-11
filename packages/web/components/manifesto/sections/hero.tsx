import type { JSX } from "react"
import { getTranslations } from "next-intl/server"
import { Eyebrow } from "@/components/ledger/eyebrow"
import { LEAD_CLASS, PROSE_LIMIT } from "@/components/manifesto/manifesto-section"

export async function HeroSection(): Promise<JSX.Element> {
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
        <h1
          id="manifesto-hero-title"
          className="text-text-hi text-[clamp(2.5rem,1.35rem+4.4vw,5.25rem)] leading-[0.98] font-medium tracking-[-0.03em] text-balance"
        >
          {t("hero.title")}
        </h1>
        <p className={LEAD_CLASS}>{t("hero.subtitle")}</p>
      </div>
    </section>
  )
}
