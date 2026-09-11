import type { JSX, ReactNode } from "react"
import { getTranslations } from "next-intl/server"

import { ORCHESTRATION_KEYS } from "@/components/landing/constants"
import { Reveal } from "@/components/landing/motion-wrappers"
import { SectionHeader } from "@/components/landing/section-header"
import { Frame } from "@/components/ledger/frame"
import { LedgerRow } from "@/components/ledger/ledger-row"
import { Chip } from "@/components/ui/badge"

function Features({ items }: { readonly items: readonly string[] }): ReactNode {
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item} className="text-text-mid text-sm leading-[1.55]">
          {item}
        </li>
      ))}
    </ul>
  )
}

/** The verified-plan pipeline as a ledger: planner → gap analysis → plan review → executor. */
export async function OrchestrationSection(): Promise<JSX.Element> {
  const t = await getTranslations("landing.orchestration")

  return (
    <section
      data-section="orchestration"
      aria-labelledby="orchestration-title"
      className="border-line border-t py-16 lg:py-24"
    >
      <Frame>
        <Reveal>
          <SectionHeader
            id="orchestration-title"
            eyebrow={t("eyebrow")}
            title={t("title")}
            intro={t("subtitle")}
          />
        </Reveal>
        <Reveal index={1} className="mt-12">
          {ORCHESTRATION_KEYS.map((key, index) => (
            <LedgerRow
              key={key}
              index={`0${index + 1}`}
              title={t(`${key}.name`)}
              evidence={
                <div className="space-y-3">
                  <Chip>{t(`${key}.model`)}</Chip>
                  <Features items={([0, 1] as const).map((i) => t(`${key}.features.${i}`))} />
                </div>
              }
            >
              {t(`${key}.role`)} — {t(`${key}.description`)}
            </LedgerRow>
          ))}
        </Reveal>
      </Frame>
    </section>
  )
}
