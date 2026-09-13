import type { JSX } from "react"
import { getTranslations } from "next-intl/server"

import { Reveal } from "@/components/landing/motion-wrappers"
import { SectionHeader } from "@/components/landing/section-header"
import { CRAFTED_ITEM_COUNT } from "@/components/landing/story-data"
import { Frame } from "@/components/ledger/frame"
import { Button } from "@/components/ui/button"
import { Link } from "@/i18n/routing"

const ITEMS = Array.from({ length: CRAFTED_ITEM_COUNT }, (_, i) => i + 1)

export async function CraftedSection(): Promise<JSX.Element> {
  const t = await getTranslations("landing")

  return (
    <section
      data-section="crafted"
      aria-labelledby="crafted-title"
      className="border-line border-t py-16 lg:py-24"
    >
      <Frame>
        <div className="grid gap-10 lg:grid-cols-12 lg:gap-6">
          <Reveal className="lg:sticky lg:top-24 lg:col-span-5 lg:self-start">
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
          <ol className="divide-line lg:col-span-7 lg:divide-y" data-testid="crafted-list">
            {ITEMS.map((item, index) => (
              <Reveal as="li" key={item} index={index} className="py-6 first:pt-0">
                <h3 className="text-text-hi text-lg font-medium">{t(`crafted.item${item}Name`)}</h3>
                <p className="text-text-mid prose-cjk mt-2 max-w-xl text-base leading-[1.6]">
                  {t(`crafted.item${item}Desc`)}
                </p>
              </Reveal>
            ))}
          </ol>
        </div>
      </Frame>
    </section>
  )
}
