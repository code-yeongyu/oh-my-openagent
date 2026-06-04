import type { JSX } from "react"
import { getTranslations } from "next-intl/server"
import { Zap } from "lucide-react"
import { Section } from "@/components/ui/section"

export async function TokenCostSection(): Promise<JSX.Element> {
  const t = await getTranslations("manifesto")

  return (
    <Section data-section="manifesto-token-cost" className="mx-auto max-w-4xl">
      <div className="grid items-center gap-12 md:grid-cols-2">
        <div>
          <h2 className="mb-6 text-3xl font-bold md:text-4xl">{t("tokenCost.title")}</h2>
          <p className="text-muted-foreground mb-6 text-lg">{t("tokenCost.description")}</p>
          <ul className="mb-8 space-y-3">
            <li className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-yellow-500" />
              <span>{t("tokenCost.parallelAgents")}</span>
            </li>
            <li className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-yellow-500" />
              <span>{t("tokenCost.completeWork")}</span>
            </li>
            <li className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-yellow-500" />
              <span>{t("tokenCost.selfVerification")}</span>
            </li>
          </ul>
        </div>
        <div className="bg-secondary/20 border-border/50 rounded-xl border p-8">
          <h3 className="text-primary mb-4 text-xl font-semibold">{t("tokenCost.however")}</h3>
          <p className="text-muted-foreground mb-4">{t("tokenCost.optimizeDescription")}</p>
          <ul className="space-y-2 text-sm">
            <li className="text-muted-foreground flex items-center gap-2">
              <div className="bg-primary h-1.5 w-1.5 rounded-full" />
              {t("tokenCost.cheaperModels")}
            </li>
            <li className="text-muted-foreground flex items-center gap-2">
              <div className="bg-primary h-1.5 w-1.5 rounded-full" />
              {t("tokenCost.avoidingRedundant")}
            </li>
            <li className="text-muted-foreground flex items-center gap-2">
              <div className="bg-primary h-1.5 w-1.5 rounded-full" />
              {t("tokenCost.intelligentCaching")}
            </li>
            <li className="text-muted-foreground flex items-center gap-2">
              <div className="bg-primary h-1.5 w-1.5 rounded-full" />
              {t("tokenCost.stoppingExactly")}
            </li>
          </ul>
        </div>
      </div>
    </Section>
  )
}
