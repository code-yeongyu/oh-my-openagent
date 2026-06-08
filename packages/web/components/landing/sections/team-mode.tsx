import type { JSX } from "react"
import { getTranslations } from "next-intl/server"
import { Network, Users, Terminal, Wrench, Sparkles, Sword, Shield } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export async function TeamModeSection(): Promise<JSX.Element> {
  const t = await getTranslations("landing")

  return (
    <section
      id="team-mode"
      className="relative overflow-hidden border-t border-white/5 bg-[#0a0a0a] py-24"
      data-section="team-mode"
    >
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-violet-900/10 via-black to-black opacity-70" />
      <div className="reveal-on-enter relative z-10 container mx-auto px-4 md:px-6">
        <div className="mx-auto max-w-5xl">
          <div className="mb-6 flex flex-wrap items-center gap-3">
            <Badge className="border-violet-500/20 bg-violet-500/10 px-4 py-1.5 font-mono text-violet-300">
              {t("teamMode.badge")}
            </Badge>
            <Badge variant="outline" className="border-zinc-700 text-xs text-zinc-400">
              opt-in
            </Badge>
          </div>

          <h2 className="mb-4 text-4xl font-bold tracking-tight md:text-5xl">
            <span className="text-cyan-400">{t("teamMode.title")}</span>
          </h2>
          <h3 className="mb-6 text-2xl font-bold text-zinc-200 md:text-3xl">
            {t("teamMode.headline")}
          </h3>
          <p className="mb-12 max-w-3xl text-xl leading-relaxed text-zinc-400">
            {t("teamMode.description")}
          </p>

          <div className="mb-16 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {(
              [
                { key: "lead", icon: Network },
                { key: "parallel", icon: Users },
                { key: "tmux", icon: Terminal },
                { key: "tools", icon: Wrench },
              ] as const
            ).map(({ key, icon: Icon }) => (
              <div key={key}>
                <Card className="h-full border-zinc-800 bg-zinc-900/30 transition-colors hover:border-cyan-500/30">
                  <CardHeader className="pb-3">
                    <div className="w-fit rounded-lg bg-cyan-500/10 p-2 text-cyan-300">
                      <Icon className="h-5 w-5" />
                    </div>
                    <CardTitle className="mt-3 text-lg text-cyan-200">
                      {t(`teamMode.features.${key}.title`)}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm leading-relaxed text-zinc-400">
                      {t(`teamMode.features.${key}.description`)}
                    </p>
                  </CardContent>
                </Card>
              </div>
            ))}
          </div>

          <div className="mb-10 flex items-center gap-3">
            <Sparkles className="h-4 w-4 text-violet-400" />
            <span className="font-mono text-sm tracking-widest text-violet-400 uppercase">
              {t("teamMode.poweredBy")}
            </span>
            <div className="h-px flex-1 bg-gradient-to-r from-violet-500/30 to-transparent" />
          </div>

          <div className="mb-12 grid grid-cols-1 gap-6 lg:grid-cols-2">
            {(
              [
                { key: "hyperplan", icon: Sword },
                { key: "securityResearch", icon: Shield },
              ] as const
            ).map(({ key, icon: Icon }) => (
              <div key={key}>
                <Card className="h-full border-zinc-800 bg-zinc-900/30 transition-colors hover:border-violet-500/40">
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      <div className="rounded-lg bg-violet-500/10 p-2 text-violet-300">
                        <Icon className="h-5 w-5" />
                      </div>
                      <CardTitle className="font-mono text-lg text-violet-300">
                        {t(`teamMode.skills.${key}.name`)}
                      </CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="leading-relaxed text-zinc-300">
                      {t(`teamMode.skills.${key}.description`)}
                    </p>
                  </CardContent>
                </Card>
              </div>
            ))}
          </div>

          <div className="flex flex-col items-start gap-4 rounded-xl border border-zinc-800 bg-black/40 p-6 sm:flex-row sm:items-center sm:justify-between">
            <code className="font-mono text-sm break-all text-cyan-300">{t("teamMode.optIn")}</code>
            <p className="text-sm text-zinc-400 italic sm:text-right">{t("teamMode.tagline")}</p>
          </div>
        </div>
      </div>
    </section>
  )
}
