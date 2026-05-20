import type { JSX } from "react"
import { getTranslations } from "next-intl/server"
import { HardDrive } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export async function SisyphusSection(): Promise<JSX.Element> {
  const t = await getTranslations("landing")

  return (
    <section
      data-section="sisyphus"
      id="agents"
      className="relative overflow-hidden bg-black py-24"
    >
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-cyan-900/20 via-black to-black opacity-50" />
      <div className="reveal-on-enter relative z-10 container mx-auto px-4 md:px-6">
        <div className="mx-auto max-w-4xl">
          <div className="mb-6 flex items-center gap-3">
            <Badge className="border-cyan-500/20 bg-cyan-500/10 px-4 py-1.5 text-cyan-400">
              {t("sisyphus.badge")}
            </Badge>
            <Badge variant="outline" className="border-zinc-700 text-xs text-zinc-400">
              {t("sisyphus.model")}
            </Badge>
          </div>

          <h2 className="mb-4 text-4xl font-bold text-white md:text-5xl">
            <span className="text-cyan-400">{t("sisyphus.title")}</span>
          </h2>
          <h3 className="mb-6 text-2xl font-bold text-zinc-300 md:text-3xl">
            {t("sisyphus.headline")}
          </h3>
          <p className="mb-12 max-w-3xl text-xl leading-relaxed text-zinc-400">
            {t("sisyphus.description")}
          </p>

          <div className="mb-12 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            {(["intent", "explore", "delegate", "verify"] as const).map((phase, i) => (
              <div key={phase}>
                <Card className="h-full border-zinc-800 bg-zinc-900/30">
                  <CardHeader className="pb-2">
                    <div className="mb-1 font-mono text-xs text-cyan-400">PHASE {i + 1}</div>
                    <CardTitle className="text-lg text-white">
                      {t(`sisyphus.phases.${phase}.title`)}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-zinc-400">
                      {t(`sisyphus.phases.${phase}.description`)}
                    </p>
                  </CardContent>
                </Card>
              </div>
            ))}
          </div>

          <div>
            <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/5 p-6 md:p-8">
              <div className="flex items-start gap-4">
                <div className="rounded-lg bg-cyan-400/10 p-3">
                  <HardDrive className="h-6 w-6 text-cyan-400" />
                </div>
                <div>
                  <h4 className="mb-2 text-xl font-bold text-cyan-400">
                    {t("sisyphus.boulderTitle")}
                  </h4>
                  <p className="leading-relaxed text-zinc-300">
                    {t("sisyphus.boulderDescription")}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
