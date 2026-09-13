import type { JSX } from "react"
import { getTranslations } from "next-intl/server"

import { MassUlwGraph } from "@/components/landing/dag/mass-ulw-graph"
import { CommandBar } from "@/components/landing/install-command"
import { Button } from "@/components/ui/button"
import { Link } from "@/i18n/routing"

/**
 * DESIGN.md §4/§9 hero — `cover` pattern: `min-h-[100dvh]`, content vertically centered. At lg an
 * editorial split: text column left (6 of 12 tracks — the Display H1 holds exactly two lines,
 * the second in `--accent`), `MassUlwGraph` right. Below lg the graph stacks under the text.
 * Static `--accent-16` wash + `--line-faint` dot grid (§7).
 */
export async function HeroSection(): Promise<JSX.Element> {
  const t = await getTranslations("landing")

  return (
    <section
      data-section="hero"
      aria-labelledby="hero-title"
      className="relative flex min-h-[100dvh] flex-col justify-center pt-16"
    >
      <div aria-hidden="true" className="hero-wash absolute inset-0 -z-10" />
      <div
        aria-hidden="true"
        className="dot-grid absolute inset-0 -z-10 [mask-image:linear-gradient(to_bottom,transparent,var(--ink-0)_35%,transparent)]"
      />
      <div className="mx-auto w-full max-w-[90rem] px-4 sm:px-5 lg:px-8">
        <div className="grid items-center gap-10 py-16 lg:grid-cols-12 lg:gap-6 lg:py-24">
          <div className="reveal lg:col-span-6">
            <h1 id="hero-title" className="type-display text-text-hi max-w-6xl">
              <span className="block">{t("hero.title")}</span>
              <span className="text-accent block">{t("hero.titleHighlight")}</span>
            </h1>
            <p
              data-testid="hero-tagline"
              className="text-text-mid prose-cjk mt-8 max-w-2xl text-lg leading-[1.7] whitespace-pre-line"
            >
              {t("hero.subcopy")}
            </p>
            <p className="eyebrow text-text-lo mt-10">{t("hero.installLabel")}</p>
            <CommandBar command={t("hero.installCommand")} className="mt-3 max-w-xl" />
            <div className="mt-8 flex flex-wrap items-center gap-6">
              <Button size="lg" asChild>
                <Link href="/docs#installation">{t("hero.getStarted")}</Link>
              </Button>
              <Button variant="link" size="md" asChild>
                <Link href="/manifesto">{t("hero.readManifesto")}</Link>
              </Button>
            </div>
          </div>
          <div className="reveal lg:col-span-6">
            <div className="overflow-hidden lg:overflow-visible">
              <MassUlwGraph
                variant="panel"
                testId="hero-dag"
                regionLabel={t("dag.region")}
                frame={{
                  windowTitle: t("dag.windowTitle"),
                  threads: t("dag.threads"),
                  threadRows: [t("dag.thread1"), t("dag.thread2"), t("dag.thread3")],
                  workflow: t("dag.workflow"),
                  runStatus: {
                    pending: t("dag.status.pending"),
                    running: t("dag.status.running"),
                    completed: t("dag.status.completed"),
                  },
                  assistantPlanning: t("dag.assistantPlanning"),
                  assistantRunning: t("dag.assistantRunning"),
                  assistantDone: t("dag.assistantDone"),
                }}
                graph={{
                  wave: t("dag.wave"),
                  done: t("dag.done"),
                  running: t("dag.running"),
                  fit: t("dag.fit"),
                  center: t("dag.center"),
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
