import type { JSX } from "react"
import { getTranslations } from "next-intl/server"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ArrowRight, Zap } from "lucide-react"
import {
  SUB_AGENT_KEYS,
  AGENT_STYLES,
  CATEGORY_ROUTING,
  SKILL_INJECTIONS,
} from "@/components/landing/constants"

export async function SubAgentsSection(): Promise<JSX.Element> {
  const t = await getTranslations("landing")

  return (
    <section className="border-t border-white/5 bg-[#0a0a0a] py-24" data-section="sub-agents">
      <div className="reveal-on-enter container mx-auto px-4 md:px-6">
        <div className="mb-16 text-center">
          <h2 className="mb-4 text-4xl font-bold text-white md:text-5xl">{t("agents.title")}</h2>
          <p className="text-xl text-zinc-400">{t("agents.subtitle")}</p>
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-5">
          {SUB_AGENT_KEYS.map((key) => {
            const style = AGENT_STYLES[key]
            const Icon = style.icon
            return (
              <div key={key}>
                <Card
                  className={`h-full border-zinc-800 bg-zinc-900/30 ${style.border} ${style.bg}`}
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <div className={`rounded-lg bg-black/50 p-2 ${style.color}`}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <Badge variant="outline" className="border-zinc-700 text-xs text-zinc-400">
                        {t(`agents.${key}.model`)}
                      </Badge>
                    </div>
                    <CardTitle className={`mt-3 text-lg ${style.color}`}>
                      {t(`agents.${key}.name`)}
                    </CardTitle>
                    <CardDescription className="text-sm font-medium text-zinc-400">
                      {t(`agents.${key}.role`)}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm leading-relaxed text-zinc-300">
                      {t(`agents.${key}.description`)}
                    </p>
                  </CardContent>
                </Card>
              </div>
            )
          })}

          <div className="col-span-1 mt-4 md:col-span-2 lg:col-span-5">
            <Card className="h-full overflow-hidden border-zinc-800 bg-zinc-900/30">
              <CardHeader>
                <div className="mb-2 flex items-center gap-3">
                  <Badge className="border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-cyan-400">
                    {t("agents.dynamicSystem.role")}
                  </Badge>
                </div>
                <CardTitle className="text-2xl text-cyan-400">
                  {t("agents.dynamicSystem.name")}
                </CardTitle>
                <CardDescription className="max-w-3xl text-base text-zinc-400">
                  {t("agents.dynamicSystem.description")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="mt-4 grid grid-cols-1 gap-8 md:grid-cols-2">
                  <div className="space-y-4">
                    <h3 className="text-sm font-bold tracking-wider text-zinc-300 uppercase">
                      Category Routing
                    </h3>
                    <div className="space-y-2">
                      {CATEGORY_ROUTING.map((item) => (
                        <div
                          key={item.cat}
                          className="flex items-center justify-between rounded border border-zinc-800/50 bg-black/40 p-2"
                        >
                          <span className="font-mono text-sm text-cyan-400">{item.cat}</span>
                          <ArrowRight className="h-3 w-3 text-zinc-600" />
                          <span className="text-sm text-zinc-300">{item.model}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h3 className="text-sm font-bold tracking-wider text-zinc-300 uppercase">
                      Skill Injection
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                      {SKILL_INJECTIONS.map((skill) => (
                        <div
                          key={skill}
                          className="flex items-center gap-2 rounded border border-zinc-700/50 bg-zinc-800/30 p-3"
                        >
                          <Zap className="h-4 w-4 text-yellow-400" />
                          <span className="font-mono text-sm text-zinc-200">{skill}</span>
                        </div>
                      ))}
                    </div>
                    <div className="mt-6 rounded-lg border border-cyan-500/10 bg-cyan-500/5 p-4">
                      <p className="text-sm text-cyan-300 italic">
                        &quot;The right model + right expertise, every time.&quot;
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </section>
  )
}
