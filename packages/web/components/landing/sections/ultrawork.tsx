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
        <div className="grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-12 lg:gap-6">
          <Reveal className="min-w-0 lg:col-span-5">
            <SectionHeader
              id="ultrawork-title"
              eyebrow={t("ultrawork.keyword")}
              dot="accent"
              title={t("ultrawork.title")}
              intro={t("ultrawork.body")}
            />
          </Reveal>
          <Reveal index={1} className="min-w-0 lg:col-span-7">
            <div className="border-line bg-ink-1 rounded-work overflow-hidden border">
              <div className="border-line flex items-start gap-3 border-b px-5 py-5 font-mono text-base leading-[1.6] sm:px-6">
                <span className="text-accent shrink-0">›</span>
                <span className="text-text-hi prose-cjk min-w-0 flex-1 break-words">
                  {t("ultrawork.promptPrefix")}{" "}
                  <mark className="bg-accent-16 text-accent-hot inline-block rounded-[2px] px-1.5 py-0.5">
                    {t("ultrawork.keyword")}
                  </mark>
                </span>
              </div>
              <ol className="divide-line divide-y">
                {STEP_KEYS.map((key, index) => (
                  <Reveal
                    as="li"
                    key={key}
                    index={index + 2}
                    className="flex gap-4 px-5 py-5 sm:px-6"
                  >
                    <span
                      aria-hidden="true"
                      className="dot-live mt-2 size-2 shrink-0 rounded-full"
                    />
                    <span className="text-text-mid prose-cjk min-w-0 text-base leading-[1.6]">
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
