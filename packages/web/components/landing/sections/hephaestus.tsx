import type { JSX } from "react"
import { getTranslations } from "next-intl/server"
import { Badge } from "@/components/ui/badge"

export async function HephaestusSection(): Promise<JSX.Element> {
  const t = await getTranslations("landing")

  return (
    <section className="relative overflow-hidden bg-black py-24" data-section="hephaestus">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom,_var(--tw-gradient-stops))] from-cyan-900/10 via-black to-black opacity-70" />
      <div className="reveal-on-enter relative z-10 container mx-auto px-4 md:px-6">
        <div className="mx-auto max-w-4xl">
          <div className="mb-6 flex items-center gap-3">
            <Badge className="border-cyan-400/20 bg-cyan-400/5 px-4 py-1.5 text-cyan-400">
              {t("hephaestus.badge")}
            </Badge>
            <Badge variant="outline" className="border-zinc-700 text-xs text-zinc-400">
              {t("hephaestus.model")}
            </Badge>
          </div>

          <h2 className="mb-4 text-4xl font-bold md:text-5xl">
            <span className="text-cyan-400">{t("hephaestus.title")}</span>
          </h2>
          <h3 className="mb-6 text-2xl font-bold text-zinc-300 md:text-3xl">
            {t("hephaestus.headline")}
          </h3>
          <p className="mb-12 max-w-3xl text-xl leading-relaxed text-zinc-400">
            {t("hephaestus.description")}
          </p>

          <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {(["explore", "plan", "decide", "execute", "verify"] as const).map((step, i) => (
              <div key={step}>
                <div className="rounded-lg border border-cyan-400/20 bg-cyan-400/5 p-4 text-center">
                  <div className="mb-2 font-mono text-xs text-cyan-400">0{i + 1}</div>
                  <p className="text-sm leading-snug break-keep text-zinc-300">
                    {t(`hephaestus.loop.${step}`)}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <p className="text-center text-lg text-zinc-400/90 italic">{t("hephaestus.tagline")}</p>
        </div>
      </div>
    </section>
  )
}
