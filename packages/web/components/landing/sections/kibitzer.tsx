import type { JSX } from "react"
import { getTranslations } from "next-intl/server"

import { Reveal } from "@/components/landing/motion-wrappers"
import { SectionHeader } from "@/components/landing/section-header"
import { KibitzerStage } from "@/components/landing/kibitzer-stage"
import { Frame } from "@/components/ledger/frame"

export async function KibitzerSection(): Promise<JSX.Element> {
  const t = await getTranslations("landing")

  return (
    <section
      data-section="kibitzer"
      aria-labelledby="kibitzer-title"
      className="border-line border-t py-16 lg:py-24"
    >
      <Frame>
        <Reveal>
          <SectionHeader
            id="kibitzer-title"
            eyebrow="Kibitzer"
            dot="busy"
            title={t("kibitzer.title")}
            intro={t("kibitzer.body")}
          />
        </Reveal>
        <Reveal index={1} className="mt-12">
          <KibitzerStage />
        </Reveal>
      </Frame>
    </section>
  )
}
