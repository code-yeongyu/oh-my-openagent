import type { JSX } from "react"
import { getTranslations } from "next-intl/server"

import { Reveal } from "@/components/landing/motion-wrappers"
import { PLATFORMS } from "@/components/landing/story-data"
import { RotatingWord } from "@/components/landing/story-primitives"
import { Frame } from "@/components/ledger/frame"
import { Chip } from "@/components/ui/badge"

export async function PlatformsSection(): Promise<JSX.Element> {
  const t = await getTranslations("landing")

  return (
    <section
      data-section="platforms"
      aria-labelledby="platforms-title"
      className="border-line border-t py-16 lg:py-24"
    >
      <Frame>
        <Reveal>
          <h2 id="platforms-title" className="type-title text-text-hi prose-cjk">
            {t("platforms.titlePrefix")}{" "}
            <RotatingWord words={PLATFORMS} suffix={t("platforms.titleSuffix")} />
          </h2>
          <p className="text-text-mid prose-cjk mt-6 max-w-2xl text-lg leading-[1.6] md:text-xl">
            {t("platforms.body")}
          </p>
        </Reveal>
        <ul className="mt-12 flex flex-wrap gap-3" data-testid="platform-list">
          {PLATFORMS.map((platform, index) => (
            <Reveal as="li" key={platform} index={index}>
              <Chip className="bg-ink-1 px-3 py-2 text-sm">{platform}</Chip>
            </Reveal>
          ))}
        </ul>
        <Reveal index={PLATFORMS.length}>
          <p className="text-text-lo prose-cjk mt-6 max-w-2xl text-sm leading-[1.6]">
            <sup aria-hidden="true" className="text-accent mr-1">
              *
            </sup>
            {t("platforms.footnote")}
          </p>
        </Reveal>
      </Frame>
    </section>
  )
}
