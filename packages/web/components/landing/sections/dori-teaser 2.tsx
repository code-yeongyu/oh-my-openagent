import type { JSX } from "react"
import Image from "next/image"
import { ArrowUpRight } from "lucide-react"
import { getTranslations } from "next-intl/server"

import { Reveal } from "@/components/landing/motion-wrappers"
import { Eyebrow } from "@/components/ledger/eyebrow"
import { Frame } from "@/components/ledger/frame"
import { Button } from "@/components/ui/button"

export const DORI_URL = "https://sisyphuslabs.ai"

/**
 * DESIGN.md §16 Dori teaser: the last section before the footer. A glimpse of a different
 * product from the same makers: Dori peeks over the page's bottom edge, clipped by the section,
 * and rises a step while the only link is hovered or focused.
 */
export async function DoriTeaserSection(): Promise<JSX.Element> {
  const t = await getTranslations("landing")

  return (
    <section
      data-section="dori-teaser"
      aria-labelledby="dori-teaser-title"
      className="dori-teaser border-line border-t"
    >
      <Frame>
        <div className="grid items-end gap-x-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
          <Reveal className="flex flex-col items-start gap-6 pt-16 pb-10 lg:py-24">
            <Eyebrow rule dot="busy">
              {t("dori.eyebrow")}
            </Eyebrow>
            <h2 id="dori-teaser-title" className="type-title text-text-hi prose-cjk max-w-3xl">
              {t("dori.title")}
            </h2>
            <p className="text-text-mid prose-cjk max-w-xl text-lg leading-[1.6]">
              {t("dori.body")}
            </p>
            <Button variant="link" size="md" asChild>
              <a href={DORI_URL} target="_blank" rel="noopener noreferrer">
                {t("dori.cta")} <ArrowUpRight aria-hidden="true" />
              </a>
            </Button>
          </Reveal>
          <div className="dori-peek-clip mx-auto h-40 w-56 lg:mx-0 lg:h-56 lg:w-80">
            <Image
              unoptimized
              src="/images/dori-mascot.png"
              width={480}
              height={480}
              alt={t("dori.alt")}
              className="dori-peek h-auto w-full"
            />
          </div>
        </div>
      </Frame>
    </section>
  )
}
