import type { JSX } from "react"
import { getTranslations } from "next-intl/server"

import {
  CATEGORY_ROUTING,
  PRINCIPLE_ICONS,
  PRINCIPLE_KEYS,
  SKILL_INJECTIONS,
} from "@/components/landing/constants"
import { Reveal } from "@/components/landing/motion-wrappers"
import { SectionHeader } from "@/components/landing/section-header"
import { Frame } from "@/components/ledger/frame"
import { LedgerRow } from "@/components/ledger/ledger-row"
import { Chip } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

function Chips({ labels }: { readonly labels: readonly string[] }): JSX.Element {
  return (
    <ul className="flex flex-wrap gap-2">
      {labels.map((label) => (
        <li key={label}>
          <Chip>{label}</Chip>
        </li>
      ))}
    </ul>
  )
}

function RoutingTable(): JSX.Element {
  return (
    <table className="border-line w-full border-collapse text-sm">
      <tbody>
        {CATEGORY_ROUTING.map((row) => (
          <tr key={row.cat} className="border-line border-b last:border-b-0">
            <td className="text-text-lo py-2 pr-4 font-mono text-sm">{row.cat}</td>
            <td className="text-text-mid py-2 text-right font-mono text-sm">{row.model}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Six design decisions as ledger rows, with evidence where evidence exists. */
export async function PrinciplesSection(): Promise<JSX.Element> {
  const t = await getTranslations("landing.principles")

  return (
    <section
      data-section="principles"
      aria-labelledby="principles-title"
      className="border-line border-t py-16 lg:py-24"
    >
      <Frame>
        <Reveal>
          <SectionHeader
            id="principles-title"
            eyebrow={t("eyebrow")}
            title={t("title")}
            intro={t("subtitle")}
          />
        </Reveal>
        <Reveal index={1} className="mt-12">
          {PRINCIPLE_KEYS.map((key, index) => {
            const Icon = PRINCIPLE_ICONS[key]
            return (
              <LedgerRow
                key={key}
                index={`0${index + 1}`}
                title={
                  <span className="flex items-center gap-3">
                    <Icon
                      aria-hidden="true"
                      className="text-text-lo size-5 shrink-0"
                      strokeWidth={1.5}
                    />
                    {t(`${key}.title`)}
                  </span>
                }
                evidence={
                  key === "specialization" ? (
                    <Chips labels={SKILL_INJECTIONS} />
                  ) : key === "categories" ? (
                    <RoutingTable />
                  ) : key === "continuity" ? (
                    <pre className="border-line bg-code-bg text-code-fg overflow-x-auto border p-4 font-mono text-sm leading-[1.55]">
                      {t("boulderEvidence")}
                    </pre>
                  ) : undefined
                }
                className={cn(index === PRINCIPLE_KEYS.length - 1 && "border-b-0")}
              >
                {t(`${key}.description`)}
              </LedgerRow>
            )
          })}
        </Reveal>
      </Frame>
    </section>
  )
}
