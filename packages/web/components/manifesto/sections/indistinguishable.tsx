import type { JSX } from "react"
import { getTranslations } from "next-intl/server"
import { Check } from "lucide-react"
import {
  HEADING_CLASS,
  LEAD_CLASS,
  ManifestoSection,
  PROSE_LIMIT,
  RuledList,
  TITLE_CLASS,
} from "@/components/manifesto/manifesto-section"

export async function IndistinguishableSection(): Promise<JSX.Element> {
  const t = await getTranslations("manifesto")
  const indistinguishableKeys = [
    "patterns",
    "errorHandling",
    "tests",
    "noSlop",
    "comments",
  ] as const

  return (
    <ManifestoSection
      data-section="manifesto-indistinguishable"
      labelledBy="manifesto-indistinguishable-title"
    >
      <div className={`${PROSE_LIMIT} space-y-10`}>
        <div className="space-y-4">
          <h2 id="manifesto-indistinguishable-title" className={TITLE_CLASS}>
            {t("indistinguishable.title")}
          </h2>
          <p className={LEAD_CLASS}>{t("indistinguishable.subtitle")}</p>
        </div>

        <RuledList
          icon={<Check className="size-4" />}
          items={indistinguishableKeys.map((key) => ({
            key,
            label: t(`indistinguishable.items.${key}`),
          }))}
        />

        <blockquote className={`border-line-strong border-l-2 pl-6 ${HEADING_CLASS}`}>
          {t("indistinguishable.quote")}
        </blockquote>
      </div>
    </ManifestoSection>
  )
}
