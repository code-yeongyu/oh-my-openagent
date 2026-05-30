import type { JSX } from "react"
import { getTranslations } from "next-intl/server"
import { X } from "lucide-react"
import { Section } from "@/components/ui/section"
import { Link } from "@/i18n/routing"

export async function PainPointsSection(): Promise<JSX.Element> {
  const t = await getTranslations("manifesto")
  const painPointKeys = ["fixing", "syntax", "copyPasting", "reviewing"] as const

  return (
    <Section data-section="manifesto-pain-points" className="mx-auto max-w-3xl">
      <div className="space-y-12">
        <div className="text-primary/90 border-primary/20 bg-primary/5 border-y py-8 text-center font-mono text-lg md:text-xl">
          {t("bottleneck")}
        </div>

        <div className="prose prose-invert prose-lg max-w-none">
          <p>{t("autonomousCar")}</p>

          <h2 className="mt-8 mb-4 text-2xl font-bold">{t("whyDifferent")}</h2>

          <p>{t("micromanagement")}</p>

          <ul className="my-6 list-none space-y-4 pl-0">
            {painPointKeys.map((key) => (
              <li key={key} className="flex items-start gap-3">
                <span className="mt-1 text-red-500" aria-hidden="true">
                  <X className="size-4" />
                </span>
                <span>{t(`painPoints.${key}`)}</span>
              </li>
            ))}
          </ul>

          <p className="my-8 border-l-4 border-red-500 bg-red-500/5 py-2 pl-6 text-xl font-semibold">
            {t("notCollaboration")}
          </p>

          <p>
            <Link href="/" className="text-primary underline-offset-4 hover:underline">
              {t("premiseLinkText")}
            </Link>{" "}
            {t("premise", { linkText: "" })}
          </p>
        </div>
      </div>
    </Section>
  )
}
