import type { JSX } from "react"
import { getTranslations } from "next-intl/server"

import { MassUlwGraph } from "@/components/landing/dag/mass-ulw-graph"
import { CommandBar, type CommandTab } from "@/components/landing/install-command"
import { Eyebrow } from "@/components/ledger/eyebrow"
import { Chip } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Link } from "@/i18n/routing"
import { FALLBACK_FORMATTED_STATS, formatStats, getStats } from "@/lib/stats"

/**
 * DESIGN.md §4/§9 hero — `cover` pattern: `min-h-[100dvh]`, rows auto / 1fr / auto. At lg an
 * editorial split: text column left (6 of 12 tracks — the Display H1 must hold two lines), `GraphHero` right. Below lg the graph
 * stacks under the text at ~56vw. Static `--accent-16` wash + `--line-faint` dot grid (§7).
 */
// Model families present in packages/model-core routing tables (agent chains + categories).
const MODEL_FAMILIES = ["Claude", "GPT", "Kimi", "Grok", "GLM", "DeepSeek"] as const

export async function HeroSection(): Promise<JSX.Element> {
  const t = await getTranslations("landing")

  let formattedStats = FALLBACK_FORMATTED_STATS
  try {
    formattedStats = formatStats(await getStats())
  } catch {
    formattedStats = FALLBACK_FORMATTED_STATS
  }

  const tabs: readonly CommandTab[] = [
    {
      id: "opencode",
      label: t("installTabs.opencode"),
      command: t("installTabs.opencodeCommand"),
    },
    { id: "codex", label: t("installTabs.codex"), command: t("installTabs.codexCommand") },
    { id: "senpi", label: t("installTabs.senpi"), command: t("installTabs.senpiCommand") },
  ]

  return (
    <section
      data-section="hero"
      aria-labelledby="hero-title"
      className="relative grid min-h-[100dvh] grid-rows-[auto_1fr_auto] pt-16"
    >
      <div aria-hidden="true" className="hero-wash absolute inset-0 -z-10" />
      <div
        aria-hidden="true"
        className="dot-grid absolute inset-0 -z-10 [mask-image:linear-gradient(to_bottom,transparent,var(--ink-0)_35%,transparent)]"
      />
      <div className="mx-auto w-full max-w-[90rem] px-4 sm:px-5 lg:px-8">
        <div className="grid items-center gap-10 py-16 lg:grid-cols-12 lg:gap-6 lg:py-24">
          <div className="reveal lg:col-span-6">
            <Eyebrow rule dot="accent">
              {t("hero.eyebrow")}
            </Eyebrow>
            <h1 id="hero-title" className="type-display text-text-hi mt-6 max-w-6xl">
              {t("hero.title")}
              <br />
              <span>{t("hero.titleHighlight")}</span>
            </h1>
            <p
              data-testid="hero-tagline"
              className="text-text-mid mt-8 max-w-xl text-lg leading-[1.6]"
            >
              {formattedStats.description}
            </p>
            <CommandBar tabs={tabs} className="mt-8 max-w-xl" />
            <div className="mt-6 max-w-xl" data-testid="hero-models">
              <p className="eyebrow text-text-lo">{t("hero.modelsLabel")}</p>
              <ul className="mt-3 flex flex-wrap gap-2" aria-label={t("hero.modelsLabel")}>
                {MODEL_FAMILIES.map((family) => (
                  <li key={family}>
                    <Chip>{family}</Chip>
                  </li>
                ))}
              </ul>
              <p className="text-text-lo mt-3 text-sm leading-[1.55]">{t("hero.modelsHint")}</p>
            </div>
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
      <div className="mx-auto w-full max-w-[90rem] px-4 pb-8 sm:px-5 lg:px-8">
        <ol className="flex flex-wrap items-center gap-x-8 gap-y-2">
          {(["wave1", "wave2", "wave3"] as const).map((key) => (
            <li key={key} className="eyebrow flex items-center gap-2">
              <span className="text-text-faint tabular-nums">{t(`hero.rail.${key}.index`)}</span>
              <span>{t(`hero.rail.${key}.label`)}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
