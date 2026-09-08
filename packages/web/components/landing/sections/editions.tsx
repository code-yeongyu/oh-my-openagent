import type { JSX } from "react"
import { getTranslations } from "next-intl/server"

import { InstallCommand } from "@/components/landing/install-command"
import { Reveal } from "@/components/landing/motion-wrappers"
import { SectionHeader } from "@/components/landing/section-header"
import { Frame } from "@/components/ledger/frame"
import { LedgerRow } from "@/components/ledger/ledger-row"
import { Chip } from "@/components/ui/badge"

/** Editions as a ledger: platform / name + description / the install command as evidence. */
export async function EditionsSection(): Promise<JSX.Element> {
  const t = await getTranslations("landing")
  const editions = ["ultimate", "light", "senpi"] as const

  return (
    <section
      data-section="editions"
      aria-labelledby="editions-title"
      className="border-line border-t py-16 lg:py-24"
    >
      <Frame>
        <Reveal>
          <SectionHeader
            id="editions-title"
            eyebrow={t("editions.eyebrow")}
            title={t("editions.title")}
            intro={t("editions.subtitle")}
          />
        </Reveal>
        <Reveal index={1} className="mt-12">
          {editions.map((key, index) => (
            <LedgerRow
              key={key}
              index={`0${index + 1}`}
              title={t(`editions.${key}.name`)}
              evidence={
                <InstallCommand command={t(`editions.${key}.install`)} className="max-w-md" />
              }
            >
              <Chip className="mb-3">{t(`editions.${key}.platform`)}</Chip>
              <p>{t(`editions.${key}.description`)}</p>
            </LedgerRow>
          ))}
        </Reveal>
        <Reveal index={2} className="mt-6 flex flex-wrap gap-2">
          {(["tagAgents", "tagHooks", "tagComponents", "tagBeta"] as const).map((key) => (
            <Chip key={key}>{t(`editions.${key}`)}</Chip>
          ))}
        </Reveal>
      </Frame>
    </section>
  )
}
