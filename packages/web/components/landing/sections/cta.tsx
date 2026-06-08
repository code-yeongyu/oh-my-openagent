import type { JSX } from "react"
import { getTranslations } from "next-intl/server"
import { Button } from "@/components/ui/button"
import { Link } from "@/i18n/routing"

export async function CtaSection(): Promise<JSX.Element> {
  const t = await getTranslations("landing")

  return (
    <section className="bg-black py-24" data-section="cta">
      <div className="reveal-on-enter container mx-auto px-4 md:px-6">
        <div>
          <div className="relative overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-900/30 p-8 text-center md:p-16">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(0,212,255,0.08)_0%,_transparent_70%)]" />
            <div className="relative z-10 mx-auto max-w-3xl space-y-8">
              <h2 className="text-4xl font-bold text-white md:text-5xl">{t("cta.title")}</h2>
              <p className="text-lg text-zinc-400">{t("cta.subtitle")}</p>
              <div className="flex justify-center">
                <div className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-black px-6 py-3 font-mono text-sm text-zinc-300">
                  <span className="text-cyan-500">$</span>
                  {t("cta.installCommand")}
                </div>
              </div>
              <div className="flex flex-col justify-center gap-4 sm:flex-row">
                <Link
                  href="https://github.com/code-yeongyu/oh-my-openagent"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button
                    size="lg"
                    className="h-12 bg-cyan-500 px-8 font-bold text-black hover:bg-cyan-600"
                  >
                    {t("cta.installNow")}
                  </Button>
                </Link>
                <Link href="/docs">
                  <Button
                    size="lg"
                    variant="outline"
                    className="h-12 border-zinc-700 px-8 text-white hover:bg-zinc-800"
                  >
                    {t("cta.readTheDocs")}
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
