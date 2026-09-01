import type { JSX } from "react"
import { getTranslations } from "next-intl/server"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { InstallCommand } from "@/components/landing/install-command"

export async function EditionsSection(): Promise<JSX.Element> {
  const t = await getTranslations("landing")

  return (
    <section className="border-t border-white/5 bg-[#0a0a0a] py-24" data-section="editions">
      <div className="reveal-on-enter container mx-auto px-4 md:px-6">
        <div className="mb-16 text-center">
          <h2 className="mb-4 text-4xl font-bold text-white md:text-5xl">{t("editions.title")}</h2>
          <p className="text-xl text-zinc-400">{t("editions.subtitle")}</p>
        </div>

        <div className="mx-auto grid max-w-4xl grid-cols-1 gap-8 md:grid-cols-2">
          <Card className="relative overflow-hidden border-cyan-500/20 bg-zinc-900/50">
            <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 to-transparent" />
            <CardHeader className="relative">
              <Badge className="mb-3 w-fit border-cyan-500/30 bg-cyan-500/10 text-cyan-400">
                {t("editions.ultimate.platform")}
              </Badge>
              <CardTitle className="text-2xl text-white">{t("editions.ultimate.name")}</CardTitle>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                {t("editions.ultimate.description")}
              </p>
            </CardHeader>
            <CardContent className="relative">
              <InstallCommand command={t("editions.ultimate.install")} />
            </CardContent>
          </Card>

          <Card className="relative overflow-hidden border-emerald-500/20 bg-zinc-900/50">
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent" />
            <CardHeader className="relative">
              <Badge className="mb-3 w-fit border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                {t("editions.light.platform")}
              </Badge>
              <CardTitle className="text-2xl text-white">{t("editions.light.name")}</CardTitle>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                {t("editions.light.description")}
              </p>
            </CardHeader>
            <CardContent className="relative">
              <InstallCommand command={t("editions.light.install")} />
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  )
}
