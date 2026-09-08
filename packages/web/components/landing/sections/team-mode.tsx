import type { JSX } from "react"
import { getTranslations } from "next-intl/server"

import { Reveal } from "@/components/landing/motion-wrappers"
import { SectionHeader } from "@/components/landing/section-header"
import { Eyebrow } from "@/components/ledger/eyebrow"
import { Frame } from "@/components/ledger/frame"

const FEATURES = ["lead", "parallel", "tmux", "tools"] as const
const PANES = [
  { pane: "paneLead", status: "statusLead", line: "lineLead" },
  { pane: "paneImpl", status: "statusImpl", line: "lineImpl" },
  { pane: "paneReview", status: "statusReview", line: "lineReview" },
  { pane: "paneTest", status: "statusTest", line: "lineTest" },
] as const

/** Team Mode: compact copy beside a CSS tmux grid mockup (chrome + 2×2 panes). */
export async function TeamModeSection(): Promise<JSX.Element> {
  const t = await getTranslations("landing.teamMode")

  return (
    <section
      id="team-mode"
      data-section="team-mode"
      aria-labelledby="team-mode-title"
      className="border-line border-t py-16 lg:py-24"
    >
      <Frame>
        <div className="grid gap-12 lg:grid-cols-[1fr_minmax(0,34rem)] lg:gap-16">
          <Reveal>
            <SectionHeader
              id="team-mode-title"
              eyebrow={t("eyebrow")}
              dot="busy"
              title={t("title")}
              intro={t("description")}
            />
            <dl className="border-line divide-line mt-12 divide-y">
              {FEATURES.map((key) => (
                <div key={key} className="grid gap-1 py-5 sm:grid-cols-[minmax(0,11rem)_1fr]">
                  <dt className="text-text-hi text-base leading-[1.35] font-medium tracking-[-0.01em]">
                    {t(`features.${key}.title`)}
                  </dt>
                  <dd className="text-text-mid text-sm leading-[1.55]">
                    {t(`features.${key}.description`)}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-8">
              <code className="border-line bg-ink-2 text-text-hi rounded-[2px] border px-2 py-1 font-mono text-sm">
                {t("optIn")}
              </code>
            </p>
          </Reveal>
          <Reveal index={1}>
            <div className="border-line grid grid-rows-[auto_1fr] border">
              <div className="bg-ink-2 border-line flex h-10 items-center justify-between border-b px-4">
                <span className="text-text-lo text-meta tracking-meta font-mono">
                  {t("mockup.title")}
                </span>
                <Eyebrow dot="busy">{t("mockup.status")}</Eyebrow>
              </div>
              <div className="bg-code-bg grid gap-px p-px sm:grid-cols-2">
                {PANES.map((pane) => (
                  <div key={pane.pane} className="bg-ink-0 flex min-h-32 flex-col gap-2 p-4">
                    <span className="text-text-lo text-meta tracking-meta flex items-center gap-2 font-mono">
                      <span
                        aria-hidden="true"
                        className="bg-status-ok pulse-dot size-2 rounded-full"
                      />
                      {t(`mockup.${pane.pane}`)}
                    </span>
                    <span className="text-text-mid font-mono text-[13px] leading-[1.55]">
                      {t(`mockup.${pane.status}`)}
                    </span>
                    <span className="text-text-faint mt-auto truncate font-mono text-[13px]">
                      {t(`mockup.${pane.line}`)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <p className="text-text-lo mt-4 text-sm leading-[1.55]">{t("mockup.caption")}</p>
          </Reveal>
        </div>
      </Frame>
    </section>
  )
}
