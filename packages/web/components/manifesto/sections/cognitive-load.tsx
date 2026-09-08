import type { JSX } from "react"
import { getTranslations } from "next-intl/server"
import { ArrowDown } from "lucide-react"
import { Eyebrow } from "@/components/ledger/eyebrow"
import {
  HEADING_CLASS,
  LEAD_CLASS,
  ManifestoSection,
  PROSE_LIMIT,
  TITLE_CLASS,
} from "@/components/manifesto/manifesto-section"

const STEP_INDEX = ["01", "02", "03", "04", "05"] as const

export async function CognitiveLoadSection(): Promise<JSX.Element> {
  const t = await getTranslations("manifesto")
  const ultraworkStepKeys = ["analyze", "breakdown", "execute", "verify", "commit"] as const

  return (
    <ManifestoSection
      data-section="manifesto-cognitive-load"
      labelledBy="manifesto-cognitive-load-title"
    >
      <div className={`${PROSE_LIMIT} space-y-4`}>
        <h2 id="manifesto-cognitive-load-title" className={TITLE_CLASS}>
          {t("cognitiveLoad.title")}
        </h2>
        <p className={LEAD_CLASS}>{t("cognitiveLoad.subtitle")}</p>
      </div>

      <div className="border-line mt-12 grid border-t lg:grid-cols-2">
        <article className="border-line flex flex-col gap-6 border-b py-8 lg:border-r lg:pr-8">
          <Eyebrow rule as="p">
            {t("cognitiveLoad.ultrawork.badge")}
          </Eyebrow>
          <div className="space-y-2">
            <h3 className={HEADING_CLASS}>{t("cognitiveLoad.ultrawork.title")}</h3>
            <p className="text-text-mid leading-[1.6]">{t("cognitiveLoad.ultrawork.subtitle")}</p>
          </div>
          <ol className="border-line divide-line divide-y border-y">
            {ultraworkStepKeys.map((key, i) => (
              <li key={key} className="grid grid-cols-[54px_1fr] items-baseline gap-x-4 py-3">
                <span
                  aria-hidden="true"
                  className="text-text-faint font-mono text-sm tracking-[-0.01em] tabular-nums"
                >
                  {STEP_INDEX[i]}
                </span>
                <span className="text-text-mid text-sm leading-[1.55]">
                  {t(`cognitiveLoad.ultrawork.steps.${key}`)}
                </span>
              </li>
            ))}
          </ol>
          <p className="text-text-hi mt-auto text-sm font-medium">
            {t("cognitiveLoad.ultrawork.footer")}
          </p>
        </article>

        <article className="border-line flex flex-col gap-6 border-b py-8 lg:pl-8">
          <Eyebrow rule as="p">
            {t("cognitiveLoad.prometheus.badge")}
          </Eyebrow>
          <div className="space-y-2">
            <h3 className={HEADING_CLASS}>{t("cognitiveLoad.prometheus.title")}</h3>
            <p className="text-text-mid leading-[1.6]">{t("cognitiveLoad.prometheus.subtitle")}</p>
          </div>
          <div className="border-line border-y">
            <div className="py-4">
              <h4 className="text-text-hi text-lg leading-[1.35] font-medium tracking-[-0.01em]">
                {t("cognitiveLoad.prometheus.prometheusTitle")}
              </h4>
              <p className="text-text-mid mt-1 text-sm leading-[1.55]">
                {t("cognitiveLoad.prometheus.prometheusDescription")}
              </p>
            </div>
            <div className="border-line text-text-lo flex items-center gap-3 border-y py-2">
              <ArrowDown aria-hidden="true" className="size-4" />
            </div>
            <div className="py-4">
              <h4 className="text-text-hi text-lg leading-[1.35] font-medium tracking-[-0.01em]">
                {t("cognitiveLoad.prometheus.atlasTitle")}
              </h4>
              <p className="text-text-mid mt-1 text-sm leading-[1.55]">
                {t("cognitiveLoad.prometheus.atlasDescription")}
              </p>
            </div>
          </div>
          <p className="text-text-hi mt-auto text-sm font-medium">
            {t("cognitiveLoad.prometheus.footer")}
          </p>
        </article>
      </div>
    </ManifestoSection>
  )
}
