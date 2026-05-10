import { getTranslations } from "next-intl/server"
import Image from "next/image"
import { ArrowRight, Check, Terminal, Zap } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Section } from "@/components/ui/section"
import { Separator } from "@/components/ui/separator"
import { Link } from "@/i18n/routing"

async function ManifestoPage() {
  const t = await getTranslations("manifesto")

  const painPointKeys = ["fixing", "syntax", "copyPasting", "reviewing"] as const
  const indistinguishableKeys = [
    "patterns",
    "errorHandling",
    "tests",
    "noSlop",
    "comments",
  ] as const
  const ultraworkStepKeys = ["analyze", "breakdown", "execute", "verify", "commit"] as const

  const coreLoopKeys = [
    "prometheus",
    "metis",
    "momus",
    "orchestrator",
    "todoContinuation",
    "categorySystem",
    "backgroundAgents",
    "wisdomAccumulation",
  ] as const

  const futureKeys = ["focus", "quality", "complexity", "promptEngineering"] as const

  return (
    <main className="bg-background text-foreground min-h-screen overflow-x-hidden">
      <section className="relative flex min-h-[80vh] flex-col items-center justify-center overflow-hidden px-6 pt-20 text-center">
        <div className="absolute inset-0 z-0 opacity-20">
          <Image
            src="/images/core-loop.png"
            alt="Background"
            fill
            className="object-cover object-center"
            priority
          />
          <div className="from-background/80 via-background/90 to-background absolute inset-0 bg-gradient-to-b" />
        </div>

        <div className="animate-in fade-in slide-in-from-bottom-2 relative z-10 mx-auto max-w-4xl space-y-6 duration-500">
          <Badge
            variant="outline"
            className="border-primary/50 text-primary mb-4 px-4 py-1 text-sm"
          >
            {t("badge")}
          </Badge>
          <h1 className="from-foreground to-foreground/60 bg-gradient-to-b bg-clip-text text-5xl font-bold tracking-tight text-transparent md:text-7xl">
            {t("hero.title")}
          </h1>
          <p className="text-muted-foreground text-xl font-light tracking-wide md:text-2xl">
            {t("hero.subtitle")}
          </p>
        </div>
      </section>

      <Section className="mx-auto max-w-3xl">
        <div className="space-y-12">
          <div className="text-primary/90 border-primary/20 bg-primary/5 border-y py-8 text-center font-mono text-lg md:text-xl">
            {t("bottleneck")}
          </div>

          <div className="prose prose-invert prose-lg max-w-none">
            <p>{t("autonomousCar")}</p>

            <h2 className="mt-8 mb-4 text-2xl font-bold">{t("whyDifferent")}</h2>

            <p>{t("micromanagement")}</p>

            <ul className="my-6 list-none space-y-4 pl-0">
              {painPointKeys.map((key) => (
                <li key={key} className="flex items-start gap-3">
                  <span className="mt-1 text-red-500">✕</span>
                  <span>{t(`painPoints.${key}`)}</span>
                </li>
              ))}
            </ul>

            <p className="my-8 border-l-4 border-red-500 bg-red-500/5 py-2 pl-6 text-xl font-semibold">
              {t("notCollaboration")}
            </p>

            <p>
              <Link href="/" className="text-primary underline-offset-4 hover:underline">
                {t("premiseLinkText")}
              </Link>{" "}
              {t("premise", { linkText: "" })}
            </p>
          </div>
        </div>
      </Section>

      <Separator className="mx-auto max-w-4xl opacity-20" />

      <Section className="mx-auto max-w-3xl">
        <h2 className="mb-8 text-3xl font-bold md:text-4xl">{t("indistinguishable.title")}</h2>

        <p className="text-muted-foreground mb-8 text-xl">{t("indistinguishable.subtitle")}</p>

        <div className="mb-10 grid gap-6">
          {indistinguishableKeys.map((key) => (
            <div
              key={key}
              className="bg-secondary/30 border-border/50 flex items-start gap-4 rounded-lg border p-4"
            >
              <Check className="h-6 w-6 shrink-0 text-green-500" />
              <span>{t(`indistinguishable.items.${key}`)}</span>
            </div>
          ))}
        </div>

        <blockquote className="border-primary bg-primary/5 rounded-r-lg border-l-4 py-4 pl-6 text-2xl font-light italic">
          {t("indistinguishable.quote")}
        </blockquote>
      </Section>

      <Section className="mx-auto max-w-4xl">
        <div className="grid items-center gap-12 md:grid-cols-2">
          <div>
            <h2 className="mb-6 text-3xl font-bold md:text-4xl">{t("tokenCost.title")}</h2>
            <p className="text-muted-foreground mb-6 text-lg">{t("tokenCost.description")}</p>
            <ul className="mb-8 space-y-3">
              <li className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-yellow-500" />
                <span>{t("tokenCost.parallelAgents")}</span>
              </li>
              <li className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-yellow-500" />
                <span>{t("tokenCost.completeWork")}</span>
              </li>
              <li className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-yellow-500" />
                <span>{t("tokenCost.selfVerification")}</span>
              </li>
            </ul>
          </div>
          <div className="bg-secondary/20 border-border/50 rounded-xl border p-8">
            <h3 className="text-primary mb-4 text-xl font-semibold">{t("tokenCost.however")}</h3>
            <p className="text-muted-foreground mb-4">{t("tokenCost.optimizeDescription")}</p>
            <ul className="space-y-2 text-sm">
              <li className="text-muted-foreground flex items-center gap-2">
                <div className="bg-primary h-1.5 w-1.5 rounded-full" />
                {t("tokenCost.cheaperModels")}
              </li>
              <li className="text-muted-foreground flex items-center gap-2">
                <div className="bg-primary h-1.5 w-1.5 rounded-full" />
                {t("tokenCost.avoidingRedundant")}
              </li>
              <li className="text-muted-foreground flex items-center gap-2">
                <div className="bg-primary h-1.5 w-1.5 rounded-full" />
                {t("tokenCost.intelligentCaching")}
              </li>
              <li className="text-muted-foreground flex items-center gap-2">
                <div className="bg-primary h-1.5 w-1.5 rounded-full" />
                {t("tokenCost.stoppingExactly")}
              </li>
            </ul>
          </div>
        </div>
      </Section>

      <Section className="mx-auto max-w-5xl">
        <div className="mb-16 text-center">
          <h2 className="mb-4 text-3xl font-bold md:text-4xl">{t("cognitiveLoad.title")}</h2>
          <p className="text-muted-foreground mx-auto max-w-2xl text-xl">
            {t("cognitiveLoad.subtitle")}
          </p>
        </div>

        <div className="grid gap-8 md:grid-cols-2">
          <Card className="from-background to-primary/5 border-primary/20 relative overflow-hidden bg-gradient-to-br">
            <div className="absolute top-0 right-0 p-4 opacity-10">
              <Terminal className="h-24 w-24" />
            </div>
            <CardHeader>
              <Badge className="mb-2 w-fit">{t("cognitiveLoad.ultrawork.badge")}</Badge>
              <CardTitle className="text-2xl">{t("cognitiveLoad.ultrawork.title")}</CardTitle>
              <p className="text-muted-foreground">{t("cognitiveLoad.ultrawork.subtitle")}</p>
            </CardHeader>
            <CardContent>
              <div className="border-primary/20 relative ml-2 space-y-6 border-l pl-4">
                {ultraworkStepKeys.map((key) => (
                  <div key={key} className="relative">
                    <div className="bg-primary border-background absolute top-1.5 -left-[21px] h-3 w-3 rounded-full border-2" />
                    <p className="text-sm">{t(`cognitiveLoad.ultrawork.steps.${key}`)}</p>
                  </div>
                ))}
              </div>
              <div className="border-border/50 text-primary mt-8 border-t pt-6 text-center font-bold">
                {t("cognitiveLoad.ultrawork.footer")}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-secondary/10 border-border/50">
            <CardHeader>
              <Badge variant="secondary" className="mb-2 w-fit">
                {t("cognitiveLoad.prometheus.badge")}
              </Badge>
              <CardTitle className="text-2xl">{t("cognitiveLoad.prometheus.title")}</CardTitle>
              <p className="text-muted-foreground">{t("cognitiveLoad.prometheus.subtitle")}</p>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div className="bg-background/50 border-border/50 rounded-lg border p-4">
                  <h3 className="text-primary mb-1 font-semibold">
                    {t("cognitiveLoad.prometheus.prometheusTitle")}
                  </h3>
                  <p className="text-muted-foreground text-sm">
                    {t("cognitiveLoad.prometheus.prometheusDescription")}
                  </p>
                </div>
                <div className="flex justify-center">
                  <ArrowRight className="text-muted-foreground/50 rotate-90 md:rotate-0" />
                </div>
                <div className="bg-background/50 border-border/50 rounded-lg border p-4">
                  <h3 className="text-primary mb-1 font-semibold">
                    {t("cognitiveLoad.prometheus.atlasTitle")}
                  </h3>
                  <p className="text-muted-foreground text-sm">
                    {t("cognitiveLoad.prometheus.atlasDescription")}
                  </p>
                </div>
              </div>
              <div className="border-border/50 text-muted-foreground mt-4 border-t pt-6 text-center font-bold">
                {t("cognitiveLoad.prometheus.footer")}
              </div>
            </CardContent>
          </Card>
        </div>
      </Section>

      <Section className="mx-auto max-w-6xl">
        <div className="grid gap-8 md:grid-cols-3">
          {(["predictable", "continuous", "delegatable"] as const).map((key) => (
            <div
              key={key}
              className="bg-secondary/10 border-border/30 rounded-xl border p-6 text-center transition-colors"
            >
              <div className="mb-4 flex justify-center">
                <Image
                  src={`/images/${key}.png`}
                  alt={key}
                  width={64}
                  height={64}
                  className="rounded-lg"
                />
              </div>
              <h3 className="mb-3 text-xl font-bold">{t(`principles.${key}.title`)}</h3>
              <p className="text-muted-foreground">{t(`principles.${key}.description`)}</p>
            </div>
          ))}
        </div>
      </Section>

      <Separator className="mx-auto max-w-4xl opacity-20" />

      <Section className="mx-auto max-w-5xl">
        <h2 className="mb-12 text-center text-3xl font-bold md:text-4xl">{t("coreLoop.title")}</h2>

        <div className="bg-background border-border/50 mb-16 rounded-xl border p-6 shadow-lg">
          <div className="flex flex-wrap items-center justify-center gap-4 py-8 md:gap-8">
            <div className="rounded-lg border-2 border-white bg-black px-6 py-3 text-sm font-semibold text-white md:text-base">
              Human Intent
            </div>
            <svg
              className="text-muted-foreground h-8 w-8 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
            <div className="rounded-lg border-2 border-zinc-600 bg-zinc-900 px-6 py-3 text-sm font-semibold text-white md:text-base">
              Agent Execution
            </div>
            <svg
              className="text-muted-foreground h-8 w-8 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
            <div className="rounded-lg border-2 border-cyan-500 bg-black px-6 py-3 text-sm font-semibold text-cyan-400 md:text-base">
              Verified Result
            </div>
          </div>
          <p className="text-muted-foreground mt-2 text-center text-xs">↻ Minimum Intervention</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {coreLoopKeys.map((key) => (
            <Card key={key} className="bg-secondary/5 border-border/40 transition-colors">
              <CardHeader className="pb-2">
                <CardTitle className="text-primary text-lg">
                  {t(`coreLoop.features.${key}.feature`)}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground text-sm">
                  {t(`coreLoop.features.${key}.purpose`)}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </Section>

      <Section className="mx-auto max-w-3xl text-center">
        <h2 className="mb-8 text-3xl font-bold md:text-4xl">{t("future.title")}</h2>

        <div className="mx-auto mb-12 max-w-2xl space-y-4 text-left">
          {futureKeys.map((key) => (
            <div key={key} className="flex items-center gap-3">
              <div className="bg-primary h-2 w-2 shrink-0 rounded-full" />
              <span className="text-lg">{t(`future.items.${key}`)}</span>
            </div>
          ))}
        </div>

        <div className="space-y-6">
          <p className="text-2xl font-light">{t("future.quote1")}</p>
          <p className="text-primary text-3xl font-bold">{t("future.quote2")}</p>
        </div>
      </Section>

      <section className="from-primary/10 to-background bg-gradient-to-t px-6 py-32 text-center">
        <div className="space-y-8">
          <h2 className="text-foreground text-6xl font-black tracking-tighter md:text-8xl">
            {t("finalCta.title")}
          </h2>

          <Button size="lg" className="rounded-full px-8 py-6 text-lg" asChild>
            <Link href="https://github.com/code-yeongyu/oh-my-openagent" target="_blank">
              {t("finalCta.button")} <ArrowRight className="ml-2 h-5 w-5" />
            </Link>
          </Button>
        </div>
      </section>
    </main>
  )
}

export default ManifestoPage
