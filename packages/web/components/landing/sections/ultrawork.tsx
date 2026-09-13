import type { JSX } from "react"
import { getTranslations } from "next-intl/server"

import { Reveal } from "@/components/landing/motion-wrappers"
import { SectionHeader } from "@/components/landing/section-header"
import { Frame } from "@/components/ledger/frame"

const STEP_KEYS = ["step1", "step2", "step3"] as const

export async function UltraworkSection(): Promise<JSX.Element> {
  const t = await getTranslations("landing")

  return (
    <section
      id="features"
      data-section="ultrawork"
      aria-labelledby="ultrawork-title"
      className="border-line border-t py-16 lg:py-24"
    >
      <Frame>
        <div className="grid gap-10 lg:grid-cols-12 lg:gap-6">
          <Reveal className="lg:col-span-5">
            <SectionHeader
              id="ultrawork-title"
              eyebrow={t("ultrawork.keyword")}
              dot="accent"
              title={t("ultrawork.title")}
              intro={t("ultrawork.body")}
            />
          </Reveal>
          <Reveal index={1} className="lg:col-span-7">
            <div className="border-line bg-ink-1 border">
              <div className="border-line flex items-center gap-3 border-b px-4 py-3 font-mono text-sm">
                <span className="text-accent">›</span>
                <span className="text-text-hi min-w-0 flex-1 truncate">
                  {t("ultrawork.promptPrefix")}{" "}
                  <mark className="bg-accent-16 text-accent-hot rounded-[2px] px-1.5 py-0.5">
                    {t("ultrawork.keyword")}
                  </mark>
                </span>
              </div>
              <ol className="divide-line divide-y">
                {STEP_KEYS.map((key, index) => (
                  <Reveal as="li" key={key} index={index + 2} className="flex gap-4 px-4 py-4">
                    <span
                      aria-hidden="true"
                      className="dot-live mt-2 size-2 shrink-0 rounded-full"
                    />
                    <span className="text-text-mid prose-cjk text-base leading-[1.6]">
                      {t(`ultrawork.${key}`)}
                    </span>
                  </Reveal>
                ))}
              </ol>
            </div>
          </Reveal>
        </div>
      </Frame>
    </section>
  )
}
