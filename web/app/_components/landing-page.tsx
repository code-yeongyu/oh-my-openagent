import type { Metadata } from "next"
import type { JSX, SVGProps } from "react"
import { getTranslations } from "next-intl/server"
import {
  Layers,
  Star,
  Check,
  Zap,
  Search,
  Code2,
  Brain,
  Eye,
  MessageSquare,
  Shield,
  Lightbulb,
  Route,
  HardDrive,
  ArrowRight,
  Target,
  Users,
  Network,
  Terminal,
  Wrench,
  Sparkles,
  Sword,
} from "lucide-react"
import { HeroStats } from "@/components/landing/hero-stats"
import { InstallCommand } from "@/components/landing/install-command"
import { TerminalTypewriter } from "@/components/landing/motion-wrappers"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Link } from "@/i18n/routing"
import { formatStats, getStats } from "@/lib/stats"

const FALLBACK_STATS = {
  stars: "40k+",
  totalDownloads: "1M+",
  monthlyDownloads: "580k+",
  weeklyDownloads: "90k+",
}

export const landingMetadata: Metadata = {
  title: "Oh My OpenAgent — The Best Agent Harness",
  description:
    "Meet Sisyphus: The batteries-included agent that codes like you. Multi-model orchestration, Team Mode, background agents, 50+ lifecycle hooks.",
}

export async function LandingPage(): Promise<JSX.Element> {
  const t = await getTranslations("landing")

  let formattedStats = FALLBACK_STATS
  try {
    const stats = await getStats()
    formattedStats = formatStats(stats)
  } catch {
    formattedStats = FALLBACK_STATS
  }

  const subAgentKeys = ["oracle", "librarian", "explore", "metis", "momus"] as const
  type SubAgentKey = (typeof subAgentKeys)[number]

  const agentStyles: Record<
    SubAgentKey,
    { color: string; border: string; bg: string; icon: typeof Brain }
  > = {
    oracle: {
      color: "text-purple-400",
      border: "border-zinc-800",
      bg: "bg-purple-400/5",
      icon: Eye,
    },
    librarian: {
      color: "text-green-400",
      border: "border-zinc-800",
      bg: "bg-green-400/5",
      icon: Search,
    },
    explore: {
      color: "text-blue-400",
      border: "border-zinc-800",
      bg: "bg-blue-400/5",
      icon: Code2,
    },
    metis: {
      color: "text-pink-400",
      border: "border-zinc-800",
      bg: "bg-pink-400/5",
      icon: MessageSquare,
    },
    momus: { color: "text-red-400", border: "border-zinc-800", bg: "bg-red-400/5", icon: Check },
  }

  const reviewKeys = ["review1", "review2", "review3", "review4", "review5", "review6"] as const

  const principleKeys = [
    "specialization",
    "trustVerify",
    "wisdom",
    "modelOptimization",
    "categories",
    "continuity",
  ] as const
  type PrincipleKey = (typeof principleKeys)[number]

  const principleIcons: Record<PrincipleKey, typeof Brain> = {
    specialization: Target,
    trustVerify: Shield,
    wisdom: Lightbulb,
    modelOptimization: Zap,
    categories: Route,
    continuity: HardDrive,
  }

  return (
    <div className="flex min-h-screen flex-col overflow-x-hidden">
      <link rel="preload" as="image" href="/images/hero.webp" fetchPriority="low" />
      <section className="relative flex min-h-[90vh] items-center justify-center overflow-hidden pt-16">
        <div
          aria-hidden="true"
          className="hero-bg absolute inset-0 z-0 bg-cover bg-center"
          style={{ backgroundImage: "url(/images/hero.webp)" }}
        />
        <div className="absolute inset-0 z-0 bg-gradient-to-b from-black/80 via-black/90 to-[#0a0a0a]" />

        <div className="relative z-10 container mx-auto flex flex-col items-center gap-8 px-4 text-center md:px-6">
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
              lifecycleHooks: t("hero.lifecycleHooks", { count: "50+" }),
            }}
          />

          <div className="w-full max-w-md">
            <InstallCommand command={t("hero.installCommand")} />
          </div>

          <div className="flex flex-col gap-4 sm:flex-row">
            <Link href="https://github.com/code-yeongyu/oh-my-openagent" target="_blank">
              <Button
                size="lg"
                className="h-12 bg-cyan-500 px-8 text-lg font-bold text-black shadow-sm hover:bg-cyan-600"
              >
                {t("hero.getStarted")}
              </Button>
            </Link>
            <Link href="https://github.com/code-yeongyu/oh-my-openagent" target="_blank">
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

      <section id="features" className="overflow-hidden border-t border-white/5 bg-[#0a0a0a] py-24">
        <div className="container mx-auto px-4 md:px-6">
          <div className="flex flex-col items-center gap-16 lg:flex-row">
            <div className="flex-1 space-y-8">
              <Badge className="border-cyan-500/20 bg-cyan-500/10 px-4 py-1.5 text-cyan-400">
                {t("ulw.badge")}
              </Badge>
              <h2 className="bg-gradient-to-r from-cyan-400 to-purple-600 bg-clip-text text-4xl font-black tracking-tighter text-transparent md:text-5xl">
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
                <Badge className="border-purple-500/20 bg-purple-500/10 px-4 py-2 text-sm text-purple-400">
                  {t("ulw.deepResearch")}
                </Badge>
                <Badge className="border-green-500/20 bg-green-500/10 px-4 py-2 text-sm text-green-400">
                  {t("ulw.selfCorrection")}
                </Badge>
                <Badge className="border-amber-500/20 bg-amber-500/10 px-4 py-2 text-sm text-amber-400">
                  {t("ulw.parallelAgents")}
                </Badge>
              </div>
              <p className="text-lg text-zinc-400/90 italic">{t("ulw.tagline")}</p>
            </div>

            <div className="w-full max-w-xl flex-1">
              <div className="overflow-hidden rounded-xl border border-zinc-800 bg-black shadow-xl">
                <div className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-900/50 px-4 py-3">
                  <div className="h-3 w-3 rounded-full border border-red-500/50 bg-red-500/20" />
                  <div className="h-3 w-3 rounded-full border border-yellow-500/50 bg-yellow-500/20" />
                  <div className="h-3 w-3 rounded-full border border-green-500/50 bg-green-500/20" />
                  <div className="ml-2 font-mono text-xs text-zinc-400">
                    {t("ulw.terminalTitle")}
                  </div>
                </div>
                <div className="space-y-4 overflow-x-auto p-6 font-mono text-sm">
                  <div className="flex gap-2">
                    <span className="text-green-500">➜</span>
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
                    <span className="text-green-500">✓</span>
                    <span className="font-bold text-green-400">{t("ulw.steps.complete")}</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-green-500">➜</span>
                    <span className="text-cyan-500">~</span>
                    <span className="animate-pulse text-white">_</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="agents" className="relative overflow-hidden bg-black py-24">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-cyan-900/20 via-black to-black opacity-50" />
        <div className="relative z-10 container mx-auto px-4 md:px-6">
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

      <section className="border-y border-white/5 bg-[#0a0a0a] py-24">
        <div className="container mx-auto px-4 md:px-6">
          <div className="mb-16 text-center">
            <Badge className="mb-6 border-amber-500/20 bg-amber-500/10 px-4 py-1.5 text-amber-400">
              {t("prometheusAtlas.badge")}
            </Badge>
            <h2 className="mb-4 text-4xl font-bold text-white md:text-5xl">
              {t("prometheusAtlas.title")}
            </h2>
            <p className="mx-auto max-w-2xl text-xl text-zinc-400">
              {t("prometheusAtlas.headline")}
            </p>
          </div>

          <div className="mb-12 grid grid-cols-1 gap-8 lg:grid-cols-2">
            <div>
              <Card className="h-full border-zinc-800 bg-zinc-900/30">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="rounded-lg bg-amber-400/10 p-2">
                      <Brain className="h-6 w-6 text-amber-400" />
                    </div>
                    <Badge variant="outline" className="border-zinc-700 text-xs text-zinc-400">
                      {t("prometheusAtlas.prometheus.model")}
                    </Badge>
                  </div>
                  <CardTitle className="mt-4 text-2xl text-amber-400">
                    {t("prometheusAtlas.prometheus.name")}
                  </CardTitle>
                  <CardDescription className="font-medium text-zinc-400">
                    {t("prometheusAtlas.prometheus.role")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="leading-relaxed text-zinc-300">
                    {t("prometheusAtlas.prometheus.description")}
                  </p>
                  <ul className="space-y-2">
                    {([0, 1, 2, 3] as const).map((i) => (
                      <li key={i} className="flex items-center gap-2 text-sm text-zinc-400">
                        <ArrowRight className="h-3 w-3 shrink-0 text-amber-400" />
                        {t(`prometheusAtlas.prometheus.features.${i}`)}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </div>

            <div>
              <Card className="h-full border-zinc-800 bg-zinc-900/30">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="rounded-lg bg-indigo-400/10 p-2">
                      <Layers className="h-6 w-6 text-indigo-400" />
                    </div>
                    <Badge variant="outline" className="border-zinc-700 text-xs text-zinc-400">
                      {t("prometheusAtlas.atlas.model")}
                    </Badge>
                  </div>
                  <CardTitle className="mt-4 text-2xl text-indigo-400">
                    {t("prometheusAtlas.atlas.name")}
                  </CardTitle>
                  <CardDescription className="font-medium text-zinc-400">
                    {t("prometheusAtlas.atlas.role")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="leading-relaxed text-zinc-300">
                    {t("prometheusAtlas.atlas.description")}
                  </p>
                  <ul className="space-y-2">
                    {([0, 1, 2, 3] as const).map((i) => (
                      <li key={i} className="flex items-center gap-2 text-sm text-zinc-400">
                        <ArrowRight className="h-3 w-3 shrink-0 text-indigo-400" />
                        {t(`prometheusAtlas.atlas.features.${i}`)}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </div>
          </div>

          <div>
            <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/20 p-6 md:p-8">
              <div className="flex min-w-[600px] flex-col items-start justify-between gap-4 md:min-w-0 md:flex-row md:items-center md:gap-0">
                {([1, 2, 3, 4, 5] as const).map((step, i) => (
                  <div key={step} className="flex flex-1 items-center gap-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-700 bg-zinc-800 font-mono text-xs text-zinc-400">
                        {step}
                      </div>
                      <span className="text-sm whitespace-nowrap text-zinc-300">
                        {t(`prometheusAtlas.workflow.step${step}`)}
                      </span>
                    </div>
                    {i < 4 && (
                      <ArrowRight className="ml-auto hidden h-4 w-4 shrink-0 text-zinc-600 md:block" />
                    )}
                  </div>
                ))}
              </div>
              <p className="mt-6 border-t border-zinc-800 pt-6 text-center text-zinc-400 italic">
                {t("prometheusAtlas.whyItWorks")}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden bg-black py-24">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom,_var(--tw-gradient-stops))] from-orange-900/10 via-black to-black opacity-70" />
        <div className="relative z-10 container mx-auto px-4 md:px-6">
          <div className="mx-auto max-w-4xl">
            <div className="mb-6 flex items-center gap-3">
              <Badge className="border-orange-500/20 bg-orange-500/10 px-4 py-1.5 text-orange-400">
                {t("hephaestus.badge")}
              </Badge>
              <Badge variant="outline" className="border-zinc-700 text-xs text-zinc-400">
                {t("hephaestus.model")}
              </Badge>
            </div>

            <h2 className="mb-4 text-4xl font-bold md:text-5xl">
              <span className="text-orange-400">{t("hephaestus.title")}</span>
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
                  <div className="rounded-lg border border-orange-400/20 bg-orange-400/5 p-4 text-center">
                    <div className="mb-2 font-mono text-xs text-orange-400">0{i + 1}</div>
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

      <section
        id="team-mode"
        className="relative overflow-hidden border-t border-white/5 bg-[#0a0a0a] py-24"
      >
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-fuchsia-900/20 via-black to-black opacity-70" />
        <div className="relative z-10 container mx-auto px-4 md:px-6">
          <div className="mx-auto max-w-5xl">
            <div className="mb-6 flex flex-wrap items-center gap-3">
              <Badge className="border-fuchsia-500/30 bg-fuchsia-500/10 px-4 py-1.5 font-mono text-fuchsia-300">
                {t("teamMode.badge")}
              </Badge>
              <Badge variant="outline" className="border-zinc-700 text-xs text-zinc-400">
                opt-in
              </Badge>
            </div>

            <h2 className="mb-4 text-4xl font-bold tracking-tight md:text-5xl">
              <span className="bg-gradient-to-r from-fuchsia-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent">
                {t("teamMode.title")}
              </span>
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
                  <Card className="h-full border-zinc-800 bg-zinc-900/30 transition-colors hover:border-fuchsia-500/30">
                    <CardHeader className="pb-3">
                      <div className="w-fit rounded-lg bg-fuchsia-500/10 p-2 text-fuchsia-300">
                        <Icon className="h-5 w-5" />
                      </div>
                      <CardTitle className="mt-3 text-lg text-fuchsia-200">
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
              <Sparkles className="h-4 w-4 text-fuchsia-400" />
              <span className="font-mono text-sm tracking-widest text-fuchsia-300/80 uppercase">
                {t("teamMode.poweredBy")}
              </span>
              <div className="h-px flex-1 bg-gradient-to-r from-fuchsia-500/30 to-transparent" />
            </div>

            <div className="mb-12 grid grid-cols-1 gap-6 lg:grid-cols-2">
              {(
                [
                  { key: "hyperplan", icon: Sword, accent: "purple" as const },
                  { key: "securityResearch", icon: Shield, accent: "rose" as const },
                ] as const
              ).map(({ key, icon: Icon, accent }) => (
                <div key={key}>
                  <Card
                    className={`h-full border-zinc-800 bg-zinc-900/30 ${
                      accent === "purple"
                        ? "hover:border-purple-500/40"
                        : "hover:border-rose-500/40"
                    } transition-colors`}
                  >
                    <CardHeader>
                      <div className="flex items-center gap-3">
                        <div
                          className={`rounded-lg p-2 ${
                            accent === "purple"
                              ? "bg-purple-500/10 text-purple-300"
                              : "bg-rose-500/10 text-rose-300"
                          }`}
                        >
                          <Icon className="h-5 w-5" />
                        </div>
                        <CardTitle
                          className={`font-mono text-lg ${
                            accent === "purple" ? "text-purple-300" : "text-rose-300"
                          }`}
                        >
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
              <code className="font-mono text-sm break-all text-fuchsia-200/90">
                {t("teamMode.optIn")}
              </code>
              <p className="text-sm text-zinc-400 italic sm:text-right">{t("teamMode.tagline")}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-white/5 bg-[#0a0a0a] py-24">
        <div className="container mx-auto px-4 md:px-6">
          <div className="mb-16 text-center">
            <h2 className="mb-4 text-4xl font-bold text-white md:text-5xl">{t("agents.title")}</h2>
            <p className="text-xl text-zinc-400">{t("agents.subtitle")}</p>
          </div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-5">
            {subAgentKeys.map((key) => {
              const style = agentStyles[key]
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
                    <Badge className="border-teal-500/20 bg-teal-500/10 px-3 py-1 text-teal-400">
                      {t("agents.dynamicSystem.role")}
                    </Badge>
                  </div>
                  <CardTitle className="text-2xl text-teal-400">
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
                        {[
                          { cat: "visual-engineering", model: "Gemini 3.1 Pro" },
                          { cat: "ultrabrain", model: "GPT 5.4" },
                          { cat: "artistry", model: "Gemini 3.1 Pro" },
                          { cat: "quick", model: "Claude Haiku 4.5" },
                          { cat: "deep", model: "GPT 5.3 Codex" },
                          { cat: "writing", model: "Kimi K2.5" },
                          { cat: "git", model: "Claude Haiku 4.5" },
                        ].map((item) => (
                          <div
                            key={item.cat}
                            className="flex items-center justify-between rounded border border-zinc-800/50 bg-black/40 p-2"
                          >
                            <span className="font-mono text-sm text-teal-400">{item.cat}</span>
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
                        {["playwright", "git-master", "frontend-ui-ux", "dev-browser"].map(
                          (skill) => (
                            <div
                              key={skill}
                              className="flex items-center gap-2 rounded border border-zinc-700/50 bg-zinc-800/30 p-3"
                            >
                              <Zap className="h-4 w-4 text-yellow-400" />
                              <span className="font-mono text-sm text-zinc-200">{skill}</span>
                            </div>
                          ),
                        )}
                      </div>
                      <div className="mt-6 rounded-lg border border-teal-500/10 bg-teal-500/5 p-4">
                        <p className="text-sm text-teal-300 italic">
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

      <section className="bg-black py-24">
        <div className="container mx-auto px-4 md:px-6">
          <div className="mb-16 text-center">
            <h2 className="mb-4 text-4xl font-bold text-white md:text-5xl">
              {t("architecture.title")}
            </h2>
            <p className="text-xl text-zinc-400">{t("architecture.subtitle")}</p>
          </div>

          <div className="mx-auto grid max-w-5xl grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {principleKeys.map((key) => {
              const Icon = principleIcons[key]
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

      <section className="border-t border-white/5 bg-[#0a0a0a] py-24">
        <div className="container mx-auto px-4 md:px-6">
          <div>
            <h2 className="mb-16 text-center text-4xl font-bold text-white md:text-5xl">
              {t("reviews.title")}
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {reviewKeys.map((key) => (
              <div key={key}>
                <Card className="h-full border-zinc-800 bg-zinc-900/30">
                  <CardContent className="pt-6">
                    <div className="mb-4 text-cyan-500">
                      <Star className="h-5 w-5 fill-cyan-500" />
                    </div>
                    <p className="mb-6 leading-relaxed text-zinc-300 italic">
                      &ldquo;{t(`reviews.${key}.text`)}&rdquo;
                    </p>
                    <p className="text-sm font-medium text-zinc-400">
                      — {t(`reviews.${key}.author`)}
                    </p>
                  </CardContent>
                </Card>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-black py-24">
        <div className="container mx-auto px-4 md:px-6">
          <div>
            <div className="relative overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-900/30 p-8 text-center md:p-16">
              <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/10 via-purple-500/10 to-cyan-500/10 opacity-50" />
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
                  <Link href="https://github.com/code-yeongyu/oh-my-openagent" target="_blank">
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
    </div>
  )
}

function GithubIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
    >
      <title>GitHub</title>
      <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
      <path d="M9 18c-4.51 2-5-2-7-2" />
    </svg>
  )
}
