import type { JSX } from "react"
import { getTranslations } from "next-intl/server"
import {
  HEADING_CLASS,
  LEAD_CLASS,
  ManifestoSection,
  PROSE_LIMIT,
  RuledList,
  TITLE_CLASS,
} from "@/components/manifesto/manifesto-section"

export async function FutureSection(): Promise<JSX.Element> {
  const t = await getTranslations("manifesto")
  const futureKeys = ["focus", "quality", "complexity", "promptEngineering"] as const

  return (
    <ManifestoSection data-section="manifesto-future" labelledBy="manifesto-future-title">
      <div className={`${PROSE_LIMIT} space-y-10`}>
        <h2 id="manifesto-future-title" className={TITLE_CLASS}>
          {t("future.title")}
        </h2>

        <RuledList items={futureKeys.map((key) => ({ key, label: t(`future.items.${key}`) }))} />

        <div className="space-y-4">
          <p className={LEAD_CLASS}>{t("future.quote1")}</p>
          <p className={HEADING_CLASS}>{t("future.quote2")}</p>
        </div>
      </div>
    </ManifestoSection>
  )
}
