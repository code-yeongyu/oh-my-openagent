import type { JSX } from "react"
import { getTranslations } from "next-intl/server"
import { Badge } from "@/components/ui/badge"
import { TerminalTypewriter } from "@/components/landing/motion-wrappers"

export async function UltraworkSection(): Promise<JSX.Element> {
  const t = await getTranslations("landing")

  return (
    <section
      data-section="ultrawork"
      id="features"
      className="overflow-hidden border-t border-white/5 bg-[#0a0a0a] py-24"
    >
      <div className="reveal-on-enter container mx-auto px-4 md:px-6">
        <div className="flex flex-col items-center gap-16 lg:flex-row">
          <div className="flex-1 space-y-8">
            <Badge className="border-cyan-500/20 bg-cyan-500/10 px-4 py-1.5 text-cyan-400">
              {t("ulw.badge")}
            </Badge>
            <h2 className="text-4xl font-black tracking-tighter text-cyan-400 md:text-5xl">
              {t("ulw.title")}
            </h2>
            <div className="space-y-4">
              <h3 className="text-3xl font-bold text-white">{t("ulw.headline")}</h3>
              <p className="text-xl leading-relaxed text-zinc-400">{t("ulw.description")}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Badge className="border-cyan-500/20 bg-cyan-500/10 px-4 py-2 text-sm text-cyan-400">
                {t("ulw.autoPlanning")}
              </Badge>
              <Badge className="border-cyan-500/20 bg-cyan-500/10 px-4 py-2 text-sm text-cyan-400">
                {t("ulw.deepResearch")}
              </Badge>
              <Badge className="border-cyan-500/20 bg-cyan-500/10 px-4 py-2 text-sm text-cyan-400">
                {t("ulw.selfCorrection")}
              </Badge>
              <Badge className="border-cyan-500/20 bg-cyan-500/10 px-4 py-2 text-sm text-cyan-400">
                {t("ulw.parallelAgents")}
              </Badge>
            </div>
            <p className="text-lg text-zinc-400/90 italic">{t("ulw.tagline")}</p>
          </div>

          <div className="w-full max-w-xl flex-1">
            <div className="overflow-hidden rounded-xl border border-zinc-800 bg-black shadow-xl shadow-cyan-500/5">
              <div className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-900/50 px-4 py-3">
                <div className="h-3 w-3 rounded-full border border-red-500/50 bg-red-500/20" />
                <div className="h-3 w-3 rounded-full border border-yellow-500/50 bg-yellow-500/20" />
                <div className="h-3 w-3 rounded-full border border-green-500/50 bg-green-500/20" />
                <div className="ml-2 font-mono text-xs text-zinc-400">{t("ulw.terminalTitle")}</div>
              </div>
              <div className="space-y-4 overflow-x-auto p-6 font-mono text-sm">
                <div className="flex gap-2">
                  <span className="text-green-500">$</span>
                  <span className="text-cyan-500">~</span>
                  <TerminalTypewriter text={t("ulw.terminalInput")} />
                </div>
                <div className="space-y-2 border-l-2 border-zinc-800 pl-4">
                  <div className="text-cyan-400">{t("ulw.steps.scanning")}</div>
                  <div className="text-zinc-400">{t("ulw.steps.context")}</div>
                  <div className="text-purple-400">{t("ulw.steps.planning")}</div>
                  <div className="text-amber-400">{t("ulw.steps.delegating")}</div>
                  <div className="text-blue-400">{t("ulw.steps.verifying")}</div>
                </div>
                <div className="flex gap-2 pt-4">
                  <span className="text-green-500">ok</span>
                  <span className="font-bold text-green-400">{t("ulw.steps.complete")}</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-green-500">$</span>
                  <span className="text-cyan-500">~</span>
                  <span className="animate-pulse text-white">_</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
