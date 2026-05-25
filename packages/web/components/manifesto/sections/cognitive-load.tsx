import type { JSX } from "react"
import { getTranslations } from "next-intl/server"
import { ArrowRight, Terminal } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Section } from "@/components/ui/section"

export async function CognitiveLoadSection(): Promise<JSX.Element> {
  const t = await getTranslations("manifesto")
  const ultraworkStepKeys = ["analyze", "breakdown", "execute", "verify", "commit"] as const

  return (
    <Section data-section="manifesto-cognitive-load" className="mx-auto max-w-5xl">
      <div className="mb-16 text-center">
        <h2 className="mb-4 text-3xl font-bold md:text-4xl">{t("cognitiveLoad.title")}</h2>
        <p className="text-muted-foreground mx-auto max-w-2xl text-xl">
          {t("cognitiveLoad.subtitle")}
        </p>
      </div>

      <div className="grid gap-8 md:grid-cols-2">
        <Card className="from-background to-primary/5 border-primary/20 relative overflow-hidden bg-gradient-to-br">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <Terminal className="h-24 w-24" />
          </div>
          <CardHeader>
            <Badge className="mb-2 w-fit">{t("cognitiveLoad.ultrawork.badge")}</Badge>
            <CardTitle className="text-2xl">{t("cognitiveLoad.ultrawork.title")}</CardTitle>
            <p className="text-muted-foreground">{t("cognitiveLoad.ultrawork.subtitle")}</p>
          </CardHeader>
          <CardContent>
            <div className="border-primary/20 relative ml-2 space-y-6 border-l pl-4">
              {ultraworkStepKeys.map((key) => (
                <div key={key} className="relative">
                  <div className="bg-primary border-background absolute top-1.5 -left-[21px] h-3 w-3 rounded-full border-2" />
                  <p className="text-sm">{t(`cognitiveLoad.ultrawork.steps.${key}`)}</p>
                </div>
              ))}
            </div>
            <div className="border-border/50 text-primary mt-8 border-t pt-6 text-center font-bold">
              {t("cognitiveLoad.ultrawork.footer")}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-secondary/10 border-border/50">
          <CardHeader>
            <Badge variant="secondary" className="mb-2 w-fit">
              {t("cognitiveLoad.prometheus.badge")}
            </Badge>
            <CardTitle className="text-2xl">{t("cognitiveLoad.prometheus.title")}</CardTitle>
            <p className="text-muted-foreground">{t("cognitiveLoad.prometheus.subtitle")}</p>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              <div className="bg-background/50 border-border/50 rounded-lg border p-4">
                <h3 className="text-primary mb-1 font-semibold">
                  {t("cognitiveLoad.prometheus.prometheusTitle")}
                </h3>
                <p className="text-muted-foreground text-sm">
                  {t("cognitiveLoad.prometheus.prometheusDescription")}
                </p>
              </div>
              <div className="flex justify-center">
                <ArrowRight className="text-muted-foreground/50 rotate-90 md:rotate-0" />
              </div>
              <div className="bg-background/50 border-border/50 rounded-lg border p-4">
                <h3 className="text-primary mb-1 font-semibold">
                  {t("cognitiveLoad.prometheus.atlasTitle")}
                </h3>
                <p className="text-muted-foreground text-sm">
                  {t("cognitiveLoad.prometheus.atlasDescription")}
                </p>
              </div>
            </div>
            <div className="border-border/50 text-muted-foreground mt-4 border-t pt-6 text-center font-bold">
              {t("cognitiveLoad.prometheus.footer")}
            </div>
          </CardContent>
        </Card>
      </div>
    </Section>
  )
}
