import type { JSX } from "react"
import { getTranslations } from "next-intl/server"

import { Reveal } from "@/components/landing/motion-wrappers"
import { SectionHeader } from "@/components/landing/section-header"
import { MODEL_PROFILES } from "@/components/landing/story-data"
import { Marquee } from "@/components/landing/story-primitives"
import { Frame } from "@/components/ledger/frame"

const MODEL_FAMILIES = ["Claude", "GPT", "Kimi", "Grok", "GLM", "DeepSeek"] as const

export async function MultiModelSection(): Promise<JSX.Element> {
  const t = await getTranslations("landing")
  const half = Math.ceil(MODEL_PROFILES.length / 2)

  return (
    <section
      data-section="multi-model"
      aria-labelledby="multi-model-title"
      className="border-line border-t py-16 lg:py-24"
    >
      <Frame>
        <Reveal>
          <SectionHeader
            id="multi-model-title"
            eyebrow={MODEL_FAMILIES.join(" · ")}
            title={t("multiModel.title")}
            intro={t("multiModel.body")}
          />
        </Reveal>
        <Reveal index={1} className="mt-12">
          <div className="space-y-3" data-testid="model-marquee">
            <Marquee items={MODEL_PROFILES.slice(0, half)} durationSeconds={36} />
            <Marquee items={MODEL_PROFILES.slice(half)} reverse durationSeconds={44} />
            <p className="eyebrow text-text-lo pt-3">{t("multiModel.caption")}</p>
          </div>
        </Reveal>
      </Frame>
    </section>
  )
}
