import type { JSX } from "react"
import { getTranslations } from "next-intl/server"

import { CraftedShowcase } from "@/components/landing/crafted/crafted-showcase"
import type { StageLabels } from "@/components/landing/crafted/stage-scenes"
import { Reveal } from "@/components/landing/motion-wrappers"
import { SectionHeader } from "@/components/landing/section-header"
import { CRAFTED_ITEM_COUNT } from "@/components/landing/story-data"
import { Frame } from "@/components/ledger/frame"
import { Button } from "@/components/ui/button"
import { Link } from "@/i18n/routing"

const ITEMS = Array.from({ length: CRAFTED_ITEM_COUNT }, (_, i) => i + 1)

export async function CraftedSection(): Promise<JSX.Element> {
  const t = await getTranslations("landing")
  const items = ITEMS.map((item) => ({
    name: t(`crafted.item${item}Name`),
    desc: t(`crafted.item${item}Desc`),
  }))
  const labels: StageLabels = {
    roundTrip: t("crafted.stage.roundTrip"),
    oneStep: t("crafted.stage.oneStep"),
    repaired: t("crafted.stage.repaired"),
    splits: t("crafted.stage.splits"),
    parallel: t("crafted.stage.parallel"),
    waiting: t("crafted.stage.waiting"),
    woke: t("crafted.stage.woke"),
    goalProgress: t("crafted.stage.goalProgress"),
    resumes: t("crafted.stage.resumes"),
    saved: t("crafted.stage.saved"),
    reloaded: t("crafted.stage.reloaded"),
    stageLabel: t("crafted.stage.stageLabel"),
  }

  return (
    <section
      data-section="crafted"
      aria-labelledby="crafted-title"
      className="border-line border-t py-16 lg:py-24"
    >
      <Frame>
        <Reveal className="max-w-3xl">
          <SectionHeader
            id="crafted-title"
            eyebrow="crafted"
            title={t("crafted.title")}
            intro={t("crafted.body")}
          />
          <Button variant="link" size="md" className="mt-8" asChild>
            <Link href="/docs">{t("crafted.docs")}</Link>
          </Button>
        </Reveal>
        <div className="mt-12 lg:mt-16">
          <CraftedShowcase items={items} labels={labels} />
        </div>
      </Frame>
    </section>
  )
}
