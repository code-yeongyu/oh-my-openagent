import type { JSX } from "react"
import { getTranslations } from "next-intl/server"
import { Check } from "lucide-react"
import { Section } from "@/components/ui/section"

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
    <Section data-section="manifesto-indistinguishable" className="mx-auto max-w-3xl">
      <h2 className="mb-8 text-3xl font-bold md:text-4xl">{t("indistinguishable.title")}</h2>

      <p className="text-muted-foreground mb-8 text-xl">{t("indistinguishable.subtitle")}</p>

      <div className="mb-10 grid gap-6">
        {indistinguishableKeys.map((key) => (
          <div
            key={key}
            className="bg-secondary/30 border-border/50 flex items-start gap-4 rounded-lg border p-4"
          >
            <Check className="h-6 w-6 shrink-0 text-green-500" />
            <span>{t(`indistinguishable.items.${key}`)}</span>
          </div>
        ))}
      </div>

      <blockquote className="border-primary bg-primary/5 rounded-r-lg border-l-4 py-4 pl-6 text-2xl font-light italic">
        {t("indistinguishable.quote")}
      </blockquote>
    </Section>
  )
}
