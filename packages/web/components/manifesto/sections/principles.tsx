import type { JSX } from "react"
import { getTranslations } from "next-intl/server"
import { LedgerRow } from "@/components/ledger/ledger-row"
import { ManifestoSection } from "@/components/manifesto/manifesto-section"

const PRINCIPLES = [
  { key: "predictable", index: "01" },
  { key: "continuous", index: "02" },
  { key: "delegatable", index: "03" },
] as const

export async function PrinciplesSection(): Promise<JSX.Element> {
  const t = await getTranslations("manifesto")

  return (
    <ManifestoSection data-section="manifesto-principles">
      <div className="[&>*:first-child]:border-t-0">
        {PRINCIPLES.map(({ key, index }) => (
          <LedgerRow key={key} index={index} title={t(`principles.${key}.title`)}>
            <p className="max-w-[68ch] text-base leading-[1.6]">
              {t(`principles.${key}.description`)}
            </p>
          </LedgerRow>
        ))}
      </div>
    </ManifestoSection>
  )
}
