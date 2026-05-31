import type { JSX } from "react"
import { getTranslations } from "next-intl/server"
import { Section } from "@/components/ui/section"

export async function FutureSection(): Promise<JSX.Element> {
  const t = await getTranslations("manifesto")
  const futureKeys = ["focus", "quality", "complexity", "promptEngineering"] as const

  return (
    <Section data-section="manifesto-future" className="mx-auto max-w-3xl text-center">
      <h2 className="mb-8 text-3xl font-bold md:text-4xl">{t("future.title")}</h2>

      <div className="mx-auto mb-12 max-w-2xl space-y-4 text-left">
        {futureKeys.map((key) => (
          <div key={key} className="flex items-center gap-3">
            <div className="bg-primary h-2 w-2 shrink-0 rounded-full" />
            <span className="text-lg">{t(`future.items.${key}`)}</span>
          </div>
        ))}
      </div>

      <div className="space-y-6">
        <p className="text-2xl font-light">{t("future.quote1")}</p>
        <p className="text-primary text-3xl font-bold">{t("future.quote2")}</p>
      </div>
    </Section>
  )
}
