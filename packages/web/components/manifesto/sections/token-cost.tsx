import type { JSX } from "react"
import { getTranslations } from "next-intl/server"
import {
  HEADING_CLASS,
  LEAD_CLASS,
  ManifestoSection,
  RuledList,
  TITLE_CLASS,
} from "@/components/manifesto/manifesto-section"

export async function TokenCostSection(): Promise<JSX.Element> {
  const t = await getTranslations("manifesto")
  const outputKeys = ["parallelAgents", "completeWork", "selfVerification"] as const
  const efficiencyKeys = [
    "cheaperModels",
    "avoidingRedundant",
    "intelligentCaching",
    "stoppingExactly",
  ] as const

  return (
    <ManifestoSection data-section="manifesto-token-cost" labelledBy="manifesto-token-cost-title">
      <div className="grid gap-12 lg:grid-cols-2 lg:gap-6">
        <div className="max-w-[68ch] space-y-6">
          <h2 id="manifesto-token-cost-title" className={TITLE_CLASS}>
            {t("tokenCost.title")}
          </h2>
          <p className={LEAD_CLASS}>{t("tokenCost.description")}</p>
          <RuledList items={outputKeys.map((key) => ({ key, label: t(`tokenCost.${key}`) }))} />
        </div>

        <div className="border-line bg-ink-1 border p-6 lg:p-8">
          <h3 className={HEADING_CLASS}>{t("tokenCost.however")}</h3>
          <p className="text-text-mid mt-3 leading-[1.6]">{t("tokenCost.optimizeDescription")}</p>
          <RuledList
            className="mt-6 text-sm"
            items={efficiencyKeys.map((key) => ({ key, label: t(`tokenCost.${key}`) }))}
          />
        </div>
      </div>
    </ManifestoSection>
  )
}
