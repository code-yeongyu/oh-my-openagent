import type { JSX } from "react"
import { getTranslations } from "next-intl/server"

import { REVIEW_KEYS } from "@/components/landing/constants"
import { Reveal } from "@/components/landing/motion-wrappers"
import { SectionHeader } from "@/components/landing/section-header"
import { Frame } from "@/components/ledger/frame"
import { Reel, ReelCell } from "@/components/ledger/reel"

/** Reviews as a Reel (§5): the scroll container owns the scroll, snap-aligned quote cells. */
export async function ReviewsSection(): Promise<JSX.Element> {
  const t = await getTranslations("landing")

  return (
    <section
      data-section="reviews"
      aria-labelledby="reviews-title"
      className="border-line border-t py-16 lg:py-24"
    >
      <Frame>
        <Reveal>
          <SectionHeader
            id="reviews-title"
            eyebrow={t("reviews.eyebrow")}
            title={t("reviews.title")}
          />
        </Reveal>
        <Reveal index={1} className="mt-12">
          <Reel label={t("reviews.title")} aria-labelledby="reviews-title">
            {REVIEW_KEYS.map((key) => (
              <ReelCell key={key}>
                <blockquote className="text-text-hi text-lg leading-[1.6]">
                  {t(`reviews.${key}.text`)}
                </blockquote>
                <p className="text-text-lo text-meta tracking-meta mt-auto pt-6 font-mono">
                  {t(`reviews.${key}.author`)}
                </p>
              </ReelCell>
            ))}
          </Reel>
        </Reveal>
      </Frame>
    </section>
  )
}
