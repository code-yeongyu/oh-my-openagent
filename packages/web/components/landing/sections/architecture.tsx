import type { JSX } from "react"
import { getTranslations } from "next-intl/server"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { PRINCIPLE_KEYS, PRINCIPLE_ICONS } from "@/components/landing/constants"

export async function ArchitectureSection(): Promise<JSX.Element> {
  const t = await getTranslations("landing")

  return (
    <section className="bg-black py-24" data-section="architecture">
      <div className="reveal-on-enter container mx-auto px-4 md:px-6">
        <div className="mb-16 text-center">
          <h2 className="mb-4 text-4xl font-bold text-white md:text-5xl">
            {t("architecture.title")}
          </h2>
          <p className="text-xl text-zinc-400">{t("architecture.subtitle")}</p>
        </div>

        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {PRINCIPLE_KEYS.map((key) => {
            const Icon = PRINCIPLE_ICONS[key]
            return (
              <div key={key}>
                <Card className="h-full border-zinc-800 bg-zinc-900/30">
                  <CardHeader>
                    <div className="w-fit rounded-lg bg-zinc-800 p-2">
                      <Icon className="h-5 w-5 text-zinc-300" />
                    </div>
                    <CardTitle className="mt-3 text-lg text-white">
                      {t(`architecture.principles.${key}.title`)}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm leading-relaxed text-zinc-400">
                      {t(`architecture.principles.${key}.description`)}
                    </p>
                  </CardContent>
                </Card>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
