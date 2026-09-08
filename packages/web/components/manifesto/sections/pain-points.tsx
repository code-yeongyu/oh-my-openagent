import type { JSX } from "react"
import { getTranslations } from "next-intl/server"
import { X } from "lucide-react"
import { Link } from "@/i18n/routing"
import {
  HEADING_CLASS,
  LEAD_CLASS,
  ManifestoSection,
  PROSE_LIMIT,
  RuledList,
} from "@/components/manifesto/manifesto-section"

export async function PainPointsSection(): Promise<JSX.Element> {
  const t = await getTranslations("manifesto")
  const painPointKeys = ["fixing", "syntax", "copyPasting", "reviewing"] as const

  return (
    <ManifestoSection data-section="manifesto-pain-points" labelledBy="manifesto-why-different">
      <div className={`${PROSE_LIMIT} space-y-10`}>
        <p className="border-line bg-code-bg text-text-hi border px-4 py-4 font-mono text-sm leading-[1.55] tracking-[-0.01em] sm:px-6 sm:text-base">
          {t("bottleneck")}
        </p>

        <p className={LEAD_CLASS}>{t("autonomousCar")}</p>

        <h2 id="manifesto-why-different" className={HEADING_CLASS}>
          {t("whyDifferent")}
        </h2>

        <p className="text-text-mid leading-[1.6]">{t("micromanagement")}</p>

        <RuledList
          icon={<X className="size-4" />}
          items={painPointKeys.map((key) => ({ key, label: t(`painPoints.${key}`) }))}
        />

        <p className="border-line-strong text-text-hi border-l-2 pl-6 text-xl leading-[1.35] font-medium tracking-[-0.01em]">
          {t("notCollaboration")}
        </p>

        <p className="text-text-mid leading-[1.6]">
          <Link
            href="/"
            className="text-accent underline-grow focus-visible:outline-accent-32 focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {t("premiseLinkText")}
          </Link>{" "}
          {t("premise", { linkText: "" })}
        </p>
      </div>
    </ManifestoSection>
  )
}
