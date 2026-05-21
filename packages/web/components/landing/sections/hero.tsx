import type { JSX } from "react"
import { getTranslations } from "next-intl/server"
import { getStats, formatStats } from "@/lib/stats"
import { HeroStats } from "@/components/landing/hero-stats"
import { InstallCommand } from "@/components/landing/install-command"
import { Button } from "@/components/ui/button"
import { Link } from "@/i18n/routing"
import { GithubIcon } from "@/components/icons/github-icon"

const FALLBACK_STATS = {
  stars: "40k+",
  totalDownloads: "1M+",
  monthlyDownloads: "580k+",
  weeklyDownloads: "90k+",
}

export async function HeroSection(): Promise<JSX.Element> {
  const t = await getTranslations("landing")

  let formattedStats = FALLBACK_STATS
  try {
    const stats = await getStats()
    formattedStats = formatStats(stats)
  } catch {
    formattedStats = FALLBACK_STATS
  }

  return (
    <section
      data-section="hero"
      className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden pt-16"
    >
      <div
        aria-hidden="true"
        className="hero-bg absolute inset-0 z-0 bg-cover bg-center"
        style={{ backgroundImage: "url(/images/hero.webp)" }}
      />
      <div className="absolute inset-0 z-0 bg-gradient-to-b from-black/80 via-black/90 to-[#0a0a0a]" />

      <div className="reveal-on-enter relative z-10 container mx-auto flex flex-col items-center gap-8 px-4 text-center md:px-6">
        <div className="space-y-4">
          <h1 className="text-5xl font-bold tracking-tighter text-white md:text-7xl">
            {t("hero.title")}
            <span className="text-cyan-400">{t("hero.titleHighlight")}</span>
          </h1>
          <p className="mx-auto max-w-3xl text-xl font-light text-zinc-400 md:text-2xl">
            {t("hero.subtitle", {
              stars: formattedStats.stars,
              downloads: formattedStats.totalDownloads,
            })}
          </p>
        </div>

        <HeroStats
          initialStats={{
            stars: formattedStats.stars,
            totalDownloads: formattedStats.totalDownloads,
            monthlyDownloads: formattedStats.monthlyDownloads,
            weeklyDownloads: formattedStats.weeklyDownloads,
          }}
          labels={{
            githubStars: t("hero.githubStars", { count: "{count}" }),
            specializedAgents: t("hero.specializedAgents", { count: "11" }),
            totalDownloads: t("hero.totalDownloads", { count: "{count}" }),
            monthlyDownloads: t("hero.monthlyDownloads", { count: "{count}" }),
            lifecycleHooks: t("hero.lifecycleHooks", { count: "55+" }),
          }}
        />

        <div className="w-full max-w-md">
          <InstallCommand command={t("hero.installCommand")} />
        </div>

        <div className="flex flex-col gap-4 sm:flex-row">
          <Link href="/docs#installation">
            <Button
              size="lg"
              className="h-12 bg-cyan-500 px-8 text-lg font-bold text-black shadow-sm hover:bg-cyan-600"
            >
              {t("hero.getStarted")}
            </Button>
          </Link>
          <Link
            href="https://github.com/code-yeongyu/oh-my-openagent"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button
              size="lg"
              variant="outline"
              className="h-12 border-zinc-700 px-8 text-lg text-white hover:bg-zinc-800"
            >
              <GithubIcon className="mr-2 h-5 w-5" />
              {t("hero.viewOnGitHub")}
            </Button>
          </Link>
        </div>
      </div>
    </section>
  )
}
